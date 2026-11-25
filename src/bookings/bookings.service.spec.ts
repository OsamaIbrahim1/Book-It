import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BookingStatus, Role } from '@prisma/client';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { BookingJobsService } from './booking-jobs.service';
import { BookingsService, isOverlapViolation } from './bookings.service';

// A Sunday about two weeks ahead, 09:00 in Riyadh (UTC+3, no daylight saving) = 06:00 UTC.
function futureSundaySlot(): string {
  const d = new Date(Date.now() + 14 * 86_400_000);
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7));
  d.setUTCHours(6, 0, 0, 0);
  return d.toISOString();
}

describe('BookingsService', () => {
  let service: BookingsService;

  const tx = {
    $queryRaw: jest.fn(),
    booking: { updateMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    service: { findFirst: jest.fn() },
    booking: { findUnique: jest.fn(), updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const jobs = {
    scheduleExpiry: jest.fn(),
    scheduleReminder: jest.fn(),
    cancelExpiry: jest.fn(),
    cancelBooking: jest.fn(),
  };

  const payments = { refundOnCancellation: jest.fn() };

  const startsAt = futureSundaySlot();
  const dbService = {
    id: 's1',
    durationMin: 60,
    provider: {
      id: 'p1',
      userId: 'provider-user',
      timezone: 'Asia/Riyadh',
      availability: [{ dayOfWeek: 0, startMinute: 540, endMinute: 1020 }],
    },
  };
  const createdRow = {
    id: 'b1',
    status: BookingStatus.PENDING,
    startsAt: new Date(startsAt),
    endsAt: new Date(new Date(startsAt).getTime() + 3_600_000),
    expiresAt: new Date(Date.now() + 1_800_000),
    createdAt: new Date(),
    customerId: 'c1',
    providerId: 'p1',
    serviceId: 's1',
    customer: { name: 'Cust' },
    provider: { userId: 'provider-user', user: { name: 'Prov' } },
    service: { title: 'Haircut', priceCents: 2500, currency: 'usd' },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.service.findFirst.mockResolvedValue(dbService);
    prisma.$transaction.mockImplementation((arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: typeof tx) => unknown)(tx) : Promise.all(arg as unknown[]),
    );
    tx.booking.findFirst.mockResolvedValue(null);
    tx.booking.create.mockResolvedValue(createdRow);

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: BookingJobsService, useValue: jobs },
        { provide: PaymentsService, useValue: payments },
      ],
    }).compile();
    service = moduleRef.get(BookingsService);
  });

  describe('create', () => {
    it('books a valid slot, locks the provider and schedules expiry', async () => {
      const result = await service.create('c1', { serviceId: 's1', startsAt });
      expect(result.status).toBe(BookingStatus.PENDING);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.booking.create).toHaveBeenCalledTimes(1);
      expect(jobs.scheduleExpiry).toHaveBeenCalledWith('b1', expect.any(Date));
    });

    it('rejects a time that is not on the provider schedule', async () => {
      const offGrid = new Date(new Date(startsAt).getTime() + 15 * 60_000).toISOString();
      await expect(service.create('c1', { serviceId: 's1', startsAt: offGrid })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a start time in the past', async () => {
      await expect(
        service.create('c1', { serviceId: 's1', startsAt: '2020-01-05T06:00:00.000Z' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects booking your own service', async () => {
      await expect(service.create('provider-user', { serviceId: 's1', startsAt })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('returns 404 for an unknown service', async () => {
      prisma.service.findFirst.mockResolvedValue(null);
      await expect(service.create('c1', { serviceId: 's1', startsAt })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns 409 when an overlapping booking exists', async () => {
      tx.booking.findFirst.mockResolvedValue({ id: 'other' });
      await expect(service.create('c1', { serviceId: 's1', startsAt })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(tx.booking.create).not.toHaveBeenCalled();
      expect(jobs.scheduleExpiry).not.toHaveBeenCalled();
    });

    it('maps a database exclusion-constraint violation to 409', async () => {
      tx.booking.create.mockRejectedValue(
        new Error('conflicting key value violates exclusion constraint "booking_no_overlap"'),
      );
      await expect(service.create('c1', { serviceId: 's1', startsAt })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('cancel / confirm / complete', () => {
    const customer = { id: 'c1', role: Role.CUSTOMER };

    it('hides other customers bookings behind a 404', async () => {
      prisma.booking.findUnique.mockResolvedValue(createdRow);
      await expect(service.getOne({ id: 'someone-else', role: Role.CUSTOMER }, 'b1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('cancels a pending booking and removes its jobs', async () => {
      prisma.booking.findUnique.mockResolvedValue(createdRow);
      prisma.booking.updateMany.mockResolvedValue({ count: 1 });
      await service.cancel(customer, 'b1');
      expect(prisma.booking.updateMany).toHaveBeenCalledWith({
        where: { id: 'b1', status: BookingStatus.PENDING },
        data: { status: BookingStatus.CANCELLED },
      });
      expect(jobs.cancelBooking).toHaveBeenCalledWith('b1');
      expect(payments.refundOnCancellation).toHaveBeenCalledWith(
        { id: 'b1', startsAt: createdRow.startsAt },
        'c1',
        Role.CUSTOMER,
      );
    });

    it('still cancels when the refund call fails', async () => {
      prisma.booking.findUnique.mockResolvedValue(createdRow);
      prisma.booking.updateMany.mockResolvedValue({ count: 1 });
      payments.refundOnCancellation.mockRejectedValue(new Error('stripe down'));
      await expect(service.cancel(customer, 'b1')).resolves.toBeDefined();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'REFUND_FAILED' }) }),
      );
    });

    it('refuses to cancel a booking that is already cancelled', async () => {
      prisma.booking.findUnique.mockResolvedValue({ ...createdRow, status: BookingStatus.CANCELLED });
      await expect(service.cancel(customer, 'b1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses to confirm when the hold has expired', async () => {
      prisma.booking.findUnique.mockResolvedValue(createdRow);
      prisma.booking.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.confirm({ id: 'a1', role: Role.ADMIN }, 'b1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('does not let a customer complete a booking', async () => {
      prisma.booking.findUnique.mockResolvedValue({ ...createdRow, status: BookingStatus.CONFIRMED });
      await expect(service.complete(customer, 'b1')).rejects.toThrow();
    });
  });

  it('shows a stale PENDING booking as EXPIRED before the job runs', async () => {
    prisma.booking.findUnique.mockResolvedValue({ ...createdRow, expiresAt: new Date(Date.now() - 1000) });
    const view = await service.getOne({ id: 'c1', role: Role.CUSTOMER }, 'b1');
    expect(view.status).toBe(BookingStatus.EXPIRED);
  });

  describe('isOverlapViolation', () => {
    it('detects the constraint name and the Postgres code', () => {
      expect(isOverlapViolation(new Error('violates "booking_no_overlap"'))).toBe(true);
      expect(isOverlapViolation({ message: 'x', code: '23P01' })).toBe(true);
      expect(isOverlapViolation(new Error('other'))).toBe(false);
    });
  });
});
