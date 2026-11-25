import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BookingStatus, PaymentStatus, Prisma, Role } from '@prisma/client';
import Stripe from 'stripe';
import { auditBooking } from '../bookings/audit';
import { BookingJobsService } from '../bookings/booking-jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { STRIPE_CLIENT } from './stripe.provider';

// Customers get a full refund when they cancel at least this long before the start.
export const FREE_CANCEL_HOURS = 24;
// Stripe Checkout sessions must live at least 30 minutes.
const CHECKOUT_MINUTES = 31;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: BookingJobsService,
    private readonly config: ConfigService,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe | null,
  ) {}

  async createCheckout(customerId: string, bookingId: string) {
    const stripe = this.requireStripe();
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { service: true },
    });
    if (!booking || booking.customerId !== customerId) throw new NotFoundException('Booking not found');
    if (booking.status !== BookingStatus.PENDING) {
      throw new ConflictException(`Only a PENDING booking can be paid (it is ${booking.status})`);
    }
    if (booking.expiresAt && booking.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException('The hold on this booking has expired, please book again');
    }

    const frontend = this.config.get<string>('FRONTEND_URL', 'http://localhost:3001');
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: booking.id,
      metadata: { bookingId: booking.id },
      payment_intent_data: { metadata: { bookingId: booking.id } },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: booking.service.currency,
            unit_amount: booking.service.priceCents,
            product_data: { name: booking.service.title },
          },
        },
      ],
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_MINUTES * 60,
      success_url: `${frontend}/bookings/${booking.id}?paid=1`,
      cancel_url: `${frontend}/bookings/${booking.id}?cancelled=1`,
    });
    if (!session.url) throw new ServiceUnavailableException('Stripe did not return a checkout URL');

    await this.prisma.payment.upsert({
      where: { bookingId: booking.id },
      create: {
        bookingId: booking.id,
        stripeSessionId: session.id,
        amountCents: booking.service.priceCents,
        currency: booking.service.currency,
      },
      // A new attempt replaces the previous unpaid session.
      update: { stripeSessionId: session.id, amountCents: booking.service.priceCents },
    });
    return { url: session.url, sessionId: session.id };
  }

  // Verifies the signature, then handles each Stripe event id at most once.
  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined) {
    const stripe = this.requireStripe();
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET', '');
    if (!secret) throw new ServiceUnavailableException('Webhook secret is not configured');
    if (!rawBody || !signature) throw new BadRequestException('Missing body or Stripe-Signature header');

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      throw new BadRequestException('Invalid Stripe signature');
    }

    let confirmedBooking: { id: string; startsAt: Date } | null = null;
    try {
      // Recording the event id and handling it happen in one transaction: if handling fails,
      // nothing is recorded and Stripe's retry processes the event again.
      confirmedBooking = await this.prisma.$transaction(
        async (tx) => {
          await tx.stripeEvent.create({ data: { id: event.id } });
          if (event.type === 'checkout.session.completed') {
            return this.onCheckoutCompleted(tx, stripe, event.data.object);
          }
          return null;
        },
        { timeout: 20_000 },
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { received: true, duplicate: true };
      }
      throw err;
    }

    if (confirmedBooking) {
      await this.jobs.cancelExpiry(confirmedBooking.id);
      await this.jobs.scheduleReminder(confirmedBooking.id, confirmedBooking.startsAt);
    }
    return { received: true, duplicate: false };
  }

  private async onCheckoutCompleted(
    tx: Prisma.TransactionClient,
    stripe: Stripe,
    session: Stripe.Checkout.Session,
  ): Promise<{ id: string; startsAt: Date } | null> {
    if (session.payment_status !== 'paid') return null;
    const bookingId = session.metadata?.bookingId;
    if (!bookingId) return null;

    const paymentIntent =
      typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null);

    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, status: true, startsAt: true },
    });
    const payment = await tx.payment.findUnique({ where: { bookingId } });
    if (!booking || !payment) {
      this.logger.warn(`Paid session ${session.id} has no matching booking/payment`);
      return null;
    }

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.PAID, stripePaymentIntentId: paymentIntent },
    });

    if (booking.status === BookingStatus.PENDING) {
      await tx.booking.update({
        where: { id: bookingId },
        data: { status: BookingStatus.CONFIRMED, expiresAt: null },
      });
      await auditBooking(tx, bookingId, 'CONFIRMED', null, { by: 'stripe', sessionId: session.id });
      return { id: booking.id, startsAt: booking.startsAt };
    }

    // The customer paid after the hold ended (or after cancelling): give the money back.
    if (paymentIntent) {
      await stripe.refunds.create({ payment_intent: paymentIntent }, { idempotencyKey: `refund-${payment.id}` });
      await tx.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.REFUNDED } });
    }
    await auditBooking(tx, bookingId, 'LATE_PAYMENT_REFUNDED', null, { status: booking.status });
    return null;
  }

  // Called after a booking is cancelled. Customers cancelling inside the last 24 hours
  // forfeit the payment; cancellations by the provider or an admin are always refunded.
  async refundOnCancellation(booking: { id: string; startsAt: Date }, actorId: string, actorRole: Role) {
    const payment = await this.prisma.payment.findUnique({ where: { bookingId: booking.id } });
    if (!payment || payment.status !== PaymentStatus.PAID || !payment.stripePaymentIntentId) {
      return { refunded: false as const };
    }
    const hoursLeft = (booking.startsAt.getTime() - Date.now()) / 3_600_000;
    if (actorRole === Role.CUSTOMER && hoursLeft < FREE_CANCEL_HOURS) {
      await auditBooking(this.prisma, booking.id, 'NO_REFUND', actorId, { hoursLeft: Math.round(hoursLeft) });
      return { refunded: false as const };
    }

    const stripe = this.requireStripe();
    await stripe.refunds.create(
      { payment_intent: payment.stripePaymentIntentId },
      { idempotencyKey: `refund-${payment.id}` },
    );
    await this.prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.REFUNDED } });
    await auditBooking(this.prisma, booking.id, 'REFUNDED', actorId);
    return { refunded: true as const };
  }

  private requireStripe(): Stripe {
    if (!this.stripe) throw new ServiceUnavailableException('Payments are not configured on this server');
    return this.stripe;
  }
}
