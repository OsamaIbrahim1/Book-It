import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { BookingStatus } from '@prisma/client';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { auditBooking } from './audit';
import { BOOKINGS_QUEUE, JOB_EXPIRE, JOB_REMINDER, JOB_SWEEP } from './bookings.constants';
import { NotificationsService } from './notifications.service';

@Processor(BOOKINGS_QUEUE)
export class BookingsProcessor extends WorkerHost {
  private readonly logger = new Logger(BookingsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async process(job: Job<{ bookingId?: string }>): Promise<void> {
    switch (job.name) {
      case JOB_EXPIRE:
        if (job.data.bookingId) await this.expireOne(job.data.bookingId);
        return;
      case JOB_SWEEP:
        await this.sweep();
        return;
      case JOB_REMINDER:
        if (job.data.bookingId) await this.remind(job.data.bookingId);
        return;
      default:
        this.logger.warn(`Unknown job: ${job.name}`);
    }
  }

  // Only a still-PENDING booking whose hold has run out is expired. A paid or cancelled one is left alone.
  private async expireOne(bookingId: string) {
    const result = await this.prisma.booking.updateMany({
      where: { id: bookingId, status: BookingStatus.PENDING, expiresAt: { lte: new Date() } },
      data: { status: BookingStatus.EXPIRED },
    });
    if (result.count > 0) {
      await auditBooking(this.prisma, bookingId, 'EXPIRED', null, { reason: 'hold ran out' });
      this.logger.log(`Booking ${bookingId} expired`);
    }
  }

  // Safety net for lost jobs: expires every stale PENDING booking.
  private async sweep() {
    const result = await this.prisma.booking.updateMany({
      where: { status: BookingStatus.PENDING, expiresAt: { lte: new Date() } },
      data: { status: BookingStatus.EXPIRED },
    });
    if (result.count > 0) this.logger.log(`Sweeper expired ${result.count} stale booking(s)`);
  }

  private async remind(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        status: true,
        startsAt: true,
        customer: { select: { name: true, email: true } },
        service: { select: { title: true } },
      },
    });
    if (!booking || booking.status !== BookingStatus.CONFIRMED) return;

    this.notifications.send({
      to: booking.customer.email,
      subject: `Reminder: ${booking.service.title} tomorrow`,
      body: `Hi ${booking.customer.name}, your booking starts at ${booking.startsAt.toISOString()}.`,
    });
  }
}
