import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus, Prisma, Role } from '@prisma/client';
import { AuthUser } from '../common/decorators';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { generateSlots, localDateOf } from '../providers/slots.util';
import { auditBooking } from './audit';
import { BookingJobsService } from './booking-jobs.service';
import { HOLD_MINUTES, MAX_DAYS_AHEAD } from './bookings.constants';
import { CreateBookingDto, ListBookingsDto } from './dto/booking.dto';

const BOOKING_SELECT = {
  id: true,
  status: true,
  startsAt: true,
  endsAt: true,
  expiresAt: true,
  createdAt: true,
  customerId: true,
  providerId: true,
  serviceId: true,
  customer: { select: { name: true } },
  provider: { select: { userId: true, user: { select: { name: true } } } },
  service: { select: { title: true, priceCents: true, currency: true } },
} satisfies Prisma.BookingSelect;

type BookingRow = Prisma.BookingGetPayload<{ select: typeof BOOKING_SELECT }>;

// True when Postgres rejected the insert because of the booking_no_overlap exclusion constraint.
export function isOverlapViolation(err: unknown): boolean {
  const text = `${(err as { message?: string })?.message ?? ''} ${(err as { code?: string })?.code ?? ''}`;
  return text.includes('booking_no_overlap') || text.includes('23P01');
}

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: BookingJobsService,
    private readonly payments: PaymentsService,
  ) {}

  async create(customerId: string, dto: CreateBookingDto) {
    const startsAt = new Date(dto.startsAt);
    const now = new Date();
    if (startsAt.getTime() <= now.getTime()) {
      throw new BadRequestException('startsAt must be in the future');
    }
    if (startsAt.getTime() > now.getTime() + MAX_DAYS_AHEAD * 86_400_000) {
      throw new BadRequestException(`startsAt is too far ahead (maximum ${MAX_DAYS_AHEAD} days)`);
    }

    const service = await this.prisma.service.findFirst({
      where: { id: dto.serviceId, active: true },
      include: { provider: { include: { availability: true } } },
    });
    if (!service) throw new NotFoundException('Service not found');
    const provider = service.provider;
    if (provider.userId === customerId) {
      throw new BadRequestException('You cannot book your own service');
    }

    // 1) The requested time must be a real slot of the provider's schedule.
    const date = localDateOf(startsAt, provider.timezone);
    const schedule = generateSlots({
      date,
      timezone: provider.timezone,
      durationMin: service.durationMin,
      rules: provider.availability,
      busy: [],
      now,
    });
    const slot = schedule.find((s) => s.start.getTime() === startsAt.getTime());
    if (!slot) throw new BadRequestException('startsAt is not an available slot of this provider');

    const expiresAt = new Date(now.getTime() + HOLD_MINUTES * 60_000);

    // 2) Check and insert while holding a lock on the provider row, so two requests
    //    for the same provider run one after the other.
    const booking = await this.prisma
      .$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "ProviderProfile" WHERE id = ${provider.id} FOR UPDATE`;

        // Free the slots of holds that already ran out.
        await tx.booking.updateMany({
          where: { providerId: provider.id, status: BookingStatus.PENDING, expiresAt: { lte: now } },
          data: { status: BookingStatus.EXPIRED },
        });

        const clash = await tx.booking.findFirst({
          where: {
            providerId: provider.id,
            status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
            startsAt: { lt: slot.end },
            endsAt: { gt: slot.start },
          },
          select: { id: true },
        });
        if (clash) throw new ConflictException('This slot is no longer available');

        const created = await tx.booking.create({
          data: {
            customerId,
            providerId: provider.id,
            serviceId: service.id,
            startsAt: slot.start,
            endsAt: slot.end,
            status: BookingStatus.PENDING,
            expiresAt,
          },
          select: BOOKING_SELECT,
        });
        await auditBooking(tx, created.id, 'CREATED', customerId, { serviceId: service.id });
        return created;
      })
      // 3) If the code above is ever bypassed or buggy, the database constraint still says no.
      .catch((err: unknown) => {
        if (isOverlapViolation(err)) throw new ConflictException('This slot is no longer available');
        throw err;
      });

    await this.jobs.scheduleExpiry(booking.id, expiresAt);
    return this.toView(booking);
  }

  async list(user: AuthUser, dto: ListBookingsDto) {
    const where: Prisma.BookingWhereInput = {};
    if (user.role === Role.CUSTOMER) where.customerId = user.id;
    else if (user.role === Role.PROVIDER) where.provider = { userId: user.id };
    if (dto.status) where.status = dto.status;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.booking.count({ where }),
      this.prisma.booking.findMany({
        where,
        orderBy: { startsAt: 'desc' },
        skip: (dto.page - 1) * dto.limit,
        take: dto.limit,
        select: BOOKING_SELECT,
      }),
    ]);
    return { items: rows.map((r) => this.toView(r)), total, page: dto.page, limit: dto.limit };
  }

  async getOne(user: AuthUser, id: string) {
    const booking = await this.findOrFail(id);
    this.assertParticipant(user, booking);
    return this.toView(booking);
  }

  async cancel(user: AuthUser, id: string) {
    const booking = await this.findOrFail(id);
    this.assertParticipant(user, booking);

    if (booking.status !== BookingStatus.PENDING && booking.status !== BookingStatus.CONFIRMED) {
      throw new ConflictException(`A ${booking.status} booking cannot be cancelled`);
    }
    if (user.role === Role.CUSTOMER && booking.startsAt.getTime() <= Date.now()) {
      throw new BadRequestException('A booking that already started cannot be cancelled');
    }

    // The status condition makes this safe against a concurrent confirm/expire.
    const result = await this.prisma.booking.updateMany({
      where: { id, status: booking.status },
      data: { status: BookingStatus.CANCELLED },
    });
    if (result.count === 0) throw new ConflictException('Booking changed, please retry');
    await auditBooking(this.prisma, id, 'CANCELLED', user.id, { previous: booking.status });
    await this.jobs.cancelBooking(id);

    // Refund policy: see PaymentsService.refundOnCancellation. A failed refund must not hide
    // the cancellation, so it is logged and written to the audit trail for follow-up.
    try {
      await this.payments.refundOnCancellation({ id, startsAt: booking.startsAt }, user.id, user.role);
    } catch (err) {
      this.logger.error(`Refund failed for booking ${id}: ${(err as Error).message}`);
      await auditBooking(this.prisma, id, 'REFUND_FAILED', user.id, { error: (err as Error).message });
    }
    return this.getOne(user, id);
  }

  // Manual override for admins (the Stripe webhook normally confirms paid bookings).
  async confirm(user: AuthUser, id: string) {
    const booking = await this.findOrFail(id);
    if (booking.status !== BookingStatus.PENDING) {
      throw new ConflictException(`Only a PENDING booking can be confirmed (it is ${booking.status})`);
    }
    const result = await this.prisma.booking.updateMany({
      where: { id, status: BookingStatus.PENDING, expiresAt: { gt: new Date() } },
      data: { status: BookingStatus.CONFIRMED, expiresAt: null },
    });
    if (result.count === 0) throw new ConflictException('The hold on this booking has expired');
    await auditBooking(this.prisma, id, 'CONFIRMED', user.id);
    await this.jobs.cancelExpiry(id);
    await this.jobs.scheduleReminder(id, booking.startsAt);
    return this.getOne(user, id);
  }

  async complete(user: AuthUser, id: string) {
    const booking = await this.findOrFail(id);
    this.assertParticipant(user, booking);
    if (user.role === Role.CUSTOMER) throw new ForbiddenException('Only the provider can complete a booking');
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new ConflictException(`Only a CONFIRMED booking can be completed (it is ${booking.status})`);
    }
    if (booking.startsAt.getTime() > Date.now()) {
      throw new BadRequestException('The booking has not started yet');
    }
    const result = await this.prisma.booking.updateMany({
      where: { id, status: BookingStatus.CONFIRMED },
      data: { status: BookingStatus.COMPLETED },
    });
    if (result.count === 0) throw new ConflictException('Booking changed, please retry');
    await auditBooking(this.prisma, id, 'COMPLETED', user.id);
    return this.getOne(user, id);
  }

  private async findOrFail(id: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id }, select: BOOKING_SELECT });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  // Customer: own bookings. Provider: bookings of their services. Admin: all.
  private assertParticipant(user: AuthUser, booking: BookingRow) {
    if (user.role === Role.ADMIN) return;
    const allowed =
      (user.role === Role.CUSTOMER && booking.customerId === user.id) ||
      (user.role === Role.PROVIDER && booking.provider.userId === user.id);
    // 404 instead of 403 so ids of other people's bookings are not revealed.
    if (!allowed) throw new NotFoundException('Booking not found');
  }

  private toView(b: BookingRow) {
    // A PENDING booking past its hold is already free; show it as EXPIRED even before the job runs.
    const expired =
      b.status === BookingStatus.PENDING && b.expiresAt !== null && b.expiresAt.getTime() <= Date.now();
    return {
      id: b.id,
      status: expired ? BookingStatus.EXPIRED : b.status,
      startsAt: b.startsAt.toISOString(),
      endsAt: b.endsAt.toISOString(),
      expiresAt: b.expiresAt ? b.expiresAt.toISOString() : null,
      createdAt: b.createdAt.toISOString(),
      serviceId: b.serviceId,
      serviceTitle: b.service.title,
      priceCents: b.service.priceCents,
      currency: b.service.currency,
      providerId: b.providerId,
      providerName: b.provider.user.name,
      customerId: b.customerId,
      customerName: b.customer.name,
    };
  }
}
