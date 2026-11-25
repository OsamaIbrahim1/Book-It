import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  BOOKINGS_QUEUE,
  JOB_EXPIRE,
  JOB_REMINDER,
  JOB_SWEEP,
  REMINDER_HOURS_BEFORE,
} from './bookings.constants';

const REDIS_TIMEOUT_MS = 2000;

// Thin wrapper over the queue. Scheduling a job must never break a request:
// every call has a timeout and swallows errors (the sweeper and lazy expiry are the safety net).
@Injectable()
export class BookingJobsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BookingJobsService.name);
  private queueDown = false;

  constructor(@InjectQueue(BOOKINGS_QUEUE) private readonly queue: Queue) {
    // Without a listener, a Redis outage would crash the process with an unhandled 'error' event.
    this.queue.on('error', (err) => {
      if (!this.queueDown) this.logger.warn(`Queue unavailable: ${err.message}`);
      this.queueDown = true;
    });
  }

  onApplicationBootstrap() {
    // Not awaited on purpose: the API must start even if Redis is down.
    void this.safe('register sweeper', () =>
      this.queue.upsertJobScheduler(
        'sweep-expired-scheduler',
        { every: 60_000 },
        { name: JOB_SWEEP, data: {} },
      ),
    );
  }

  // Expire a PENDING booking when its hold runs out (+1s so the clock check in the job passes).
  scheduleExpiry(bookingId: string, expiresAt: Date) {
    return this.add(JOB_EXPIRE, `expire-${bookingId}`, bookingId, expiresAt.getTime() - Date.now() + 1000);
  }

  scheduleReminder(bookingId: string, startsAt: Date) {
    const runAt = startsAt.getTime() - REMINDER_HOURS_BEFORE * 3_600_000;
    if (runAt <= Date.now()) return Promise.resolve(); // too late for a 24h reminder
    return this.add(JOB_REMINDER, `reminder-${bookingId}`, bookingId, runAt - Date.now());
  }

  cancelExpiry(bookingId: string) {
    return this.remove(`expire-${bookingId}`);
  }

  async cancelBooking(bookingId: string) {
    await this.remove(`expire-${bookingId}`);
    await this.remove(`reminder-${bookingId}`);
  }

  private add(name: string, jobId: string, bookingId: string, delay: number) {
    return this.safe(`add ${name}`, () =>
      this.queue.add(
        name,
        { bookingId },
        {
          jobId, // BullMQ custom ids cannot contain ':'
          delay: Math.max(0, delay),
          removeOnComplete: true,
          removeOnFail: 100,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      ),
    );
  }

  private remove(jobId: string) {
    return this.safe(`remove ${jobId}`, async () => {
      const job = await this.queue.getJob(jobId);
      await job?.remove();
    });
  }

  private async safe(label: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await Promise.race([
        fn(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Redis timeout')), REDIS_TIMEOUT_MS).unref(),
        ),
      ]);
    } catch (err) {
      this.logger.warn(`Queue call failed (${label}): ${(err as Error).message}`);
    }
  }
}
