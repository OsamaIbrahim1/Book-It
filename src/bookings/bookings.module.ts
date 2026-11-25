import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { BookingJobsModule } from './booking-jobs.module';
import { BookingsController } from './bookings.controller';
import { BookingsProcessor } from './bookings.processor';
import { BookingsService } from './bookings.service';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [BookingJobsModule, PaymentsModule],
  controllers: [BookingsController],
  providers: [BookingsService, BookingsProcessor, NotificationsService],
  exports: [BookingsService],
})
export class BookingsModule {}
