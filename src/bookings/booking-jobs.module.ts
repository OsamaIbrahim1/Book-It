import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { BookingJobsService } from './booking-jobs.service';
import { BOOKINGS_QUEUE } from './bookings.constants';

// The queue lives in its own module so that both bookings and payments can schedule jobs
// without importing each other.
@Module({
  imports: [BullModule.registerQueue({ name: BOOKINGS_QUEUE })],
  providers: [BookingJobsService],
  exports: [BookingJobsService],
})
export class BookingJobsModule {}
