import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { BookingStatus, PaymentStatus, Prisma, Role } from '@prisma/client';
import { BookingJobsService } from '../bookings/booking-jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from './payments.service';
import { STRIPE_CLIENT } from './stripe.provider';

const HOUR = 3_600_000;

describe('PaymentsService', () => {
  let service: PaymentsService;

  const tx = {
    stripeEvent: { create: jest.fn() },
    booking: { findUnique: jest.fn(), update: jest.fn() },
    payment: { findUnique: jest.fn(), update: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    booking: { findUnique: jest.fn() },
    payment: { findUnique: jest.fn(), update: jest.fn(), upsert: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const stripe = {
    webhooks: { constructEvent: jest.fn() },
    checkout: { sessions: { create: jest.fn() } },
    refunds: { create: jest.fn() },
  };
  const jobs = { cancelExpiry: jest.fn(), scheduleReminder: jest.fn() };
  const config = { get: jest.fn((key: string, fallback?: string) => (key === 'STRIPE_WEBHOOK_SECRET' ? 'whsec_x' : (fallback ?? ''))) };

  const startsAt = new Date(Date.now() + 5 * 24 * HOUR);
  const completedEvent = {
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_1', payment_status: 'paid', payment_intent: 'pi_1', metadata: { bookingId: 'b1' } } },
  };

  async function build(stripeClient: unknown) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: BookingJobsService, useValue: jobs },
        { provide: ConfigService, useValue: config },
        { provide: STRIPE_CLIENT, useValue: stripeClient },
      ],
    }).compile();
    return moduleRef.get(PaymentsService);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    tx.stripeEvent.create.mockReset();
    prisma.$transaction.mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx));
    stripe.webhooks.constructEvent.mockReturnValue(completedEvent);
    tx.booking.findUnique.mockResolvedValue({ id: 'b1', status: BookingStatus.PENDING, startsAt });
    tx.payment.findUnique.mockResolvedValue({ id: 'pay1', bookingId: 'b1' });
    service = await build(stripe);
  });

  describe('createCheckout', () => {
    const booking = {
      id: 'b1',
      customerId: 'c1',
      status: BookingStatus.PENDING,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      service: { title: 'Haircut', priceCents: 2500, currency: 'usd' },
    };

    it('creates a Stripe session and records the payment', async () => {
      prisma.booking.findUnique.mockResolvedValue(booking);
      stripe.checkout.sessions.create.mockResolvedValue({ id: 'cs_1', url: 'https://pay.test/cs_1' });
      const result = await service.createCheckout('c1', 'b1');
      expect(result).toEqual({ url: 'https://pay.test/cs_1', sessionId: 'cs_1' });
      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { bookingId: 'b1' }, mode: 'payment' }),
      );
      expect(prisma.payment.upsert).toHaveBeenCalledTimes(1);
    });

    it("does not reveal other customers' bookings", async () => {
      prisma.booking.findUnique.mockResolvedValue({ ...booking, customerId: 'someone-else' });
      await expect(service.createCheckout('c1', 'b1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to pay for a booking that is not PENDING or whose hold ended', async () => {
      prisma.booking.findUnique.mockResolvedValue({ ...booking, status: BookingStatus.CANCELLED });
      await expect(service.createCheckout('c1', 'b1')).rejects.toBeInstanceOf(ConflictException);
      prisma.booking.findUnique.mockResolvedValue({ ...booking, expiresAt: new Date(Date.now() - 1000) });
      await expect(service.createCheckout('c1', 'b1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('answers 503 when Stripe is not configured', async () => {
      const noStripe = await build(null);
      await expect(noStripe.createCheckout('c1', 'b1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('handleWebhook', () => {
    const body = Buffer.from('{}');

    it('rejects a bad signature', async () => {
      stripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('bad sig');
      });
      await expect(service.handleWebhook(body, 'sig')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a request without body or signature', async () => {
      await expect(service.handleWebhook(undefined, 'sig')).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.handleWebhook(body, undefined)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('confirms the booking, marks the payment PAID and schedules the reminder', async () => {
      const result = await service.handleWebhook(body, 'sig');
      expect(result).toEqual({ received: true, duplicate: false });
      expect(tx.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay1' },
        data: { status: PaymentStatus.PAID, stripePaymentIntentId: 'pi_1' },
      });
      expect(tx.booking.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { status: BookingStatus.CONFIRMED, expiresAt: null },
      });
      expect(jobs.cancelExpiry).toHaveBeenCalledWith('b1');
      expect(jobs.scheduleReminder).toHaveBeenCalledWith('b1', startsAt);
      expect(stripe.refunds.create).not.toHaveBeenCalled();
    });

    it('ignores an event id it has already processed (idempotency)', async () => {
      tx.stripeEvent.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }),
      );
      const result = await service.handleWebhook(body, 'sig');
      expect(result).toEqual({ received: true, duplicate: true });
      expect(tx.booking.update).not.toHaveBeenCalled();
      expect(jobs.scheduleReminder).not.toHaveBeenCalled();
    });

    it('lets other database errors through so Stripe retries', async () => {
      tx.stripeEvent.create.mockRejectedValue(new Error('db down'));
      await expect(service.handleWebhook(body, 'sig')).rejects.toThrow('db down');
    });

    it('refunds automatically when the payment arrives after the hold ended', async () => {
      tx.booking.findUnique.mockResolvedValue({ id: 'b1', status: BookingStatus.EXPIRED, startsAt });
      await service.handleWebhook(body, 'sig');
      expect(stripe.refunds.create).toHaveBeenCalledWith(
        { payment_intent: 'pi_1' },
        { idempotencyKey: 'refund-pay1' },
      );
      expect(tx.booking.update).not.toHaveBeenCalled();
      expect(jobs.scheduleReminder).not.toHaveBeenCalled();
    });

    it('does nothing for an unpaid session', async () => {
      stripe.webhooks.constructEvent.mockReturnValue({
        ...completedEvent,
        data: { object: { ...completedEvent.data.object, payment_status: 'unpaid' } },
      });
      await service.handleWebhook(body, 'sig');
      expect(tx.booking.update).not.toHaveBeenCalled();
    });
  });

  describe('refundOnCancellation', () => {
    const paid = { id: 'pay1', status: PaymentStatus.PAID, stripePaymentIntentId: 'pi_1' };

    it('refunds a customer who cancels at least 24 hours ahead', async () => {
      prisma.payment.findUnique.mockResolvedValue(paid);
      const result = await service.refundOnCancellation({ id: 'b1', startsAt }, 'c1', Role.CUSTOMER);
      expect(result.refunded).toBe(true);
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay1' },
        data: { status: PaymentStatus.REFUNDED },
      });
    });

    it('does not refund a customer who cancels inside the last 24 hours', async () => {
      prisma.payment.findUnique.mockResolvedValue(paid);
      const soon = new Date(Date.now() + 3 * HOUR);
      const result = await service.refundOnCancellation({ id: 'b1', startsAt: soon }, 'c1', Role.CUSTOMER);
      expect(result.refunded).toBe(false);
      expect(stripe.refunds.create).not.toHaveBeenCalled();
    });

    it('always refunds when the provider cancels, even at the last minute', async () => {
      prisma.payment.findUnique.mockResolvedValue(paid);
      const soon = new Date(Date.now() + HOUR);
      const result = await service.refundOnCancellation({ id: 'b1', startsAt: soon }, 'p1', Role.PROVIDER);
      expect(result.refunded).toBe(true);
    });

    it('does nothing when nothing was paid', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);
      expect((await service.refundOnCancellation({ id: 'b1', startsAt }, 'c1', Role.CUSTOMER)).refunded).toBe(false);
      prisma.payment.findUnique.mockResolvedValue({ ...paid, status: PaymentStatus.REQUIRES_PAYMENT });
      expect((await service.refundOnCancellation({ id: 'b1', startsAt }, 'c1', Role.CUSTOMER)).refunded).toBe(false);
    });
  });
});
