import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { BookingsService } from './bookings.service';
import {
  BookingResponseDto,
  CreateBookingDto,
  ListBookingsDto,
  PaginatedBookingsDto,
} from './dto/booking.dto';

@ApiTags('bookings')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Roles(Role.CUSTOMER)
  @Post()
  @ApiOperation({
    summary: 'Book a slot (customer only)',
    description:
      'Creates a PENDING booking that holds the slot for 30 minutes. Unpaid holds expire automatically. ' +
      'Two simultaneous requests for the same slot: one gets 201, the other 409.',
  })
  @ApiCreatedResponse({ type: BookingResponseDto })
  @ApiBadRequestResponse({ description: 'Not an available slot, in the past, or too far ahead' })
  @ApiNotFoundResponse({ description: 'Service not found' })
  @ApiConflictResponse({ description: 'The slot was just taken' })
  @ApiForbiddenResponse({ description: 'Only customers can book' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBookingDto) {
    return this.bookings.create(user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List bookings',
    description: 'Customers see their own, providers see bookings of their services, admins see all.',
  })
  @ApiOkResponse({ type: PaginatedBookingsDto })
  list(@CurrentUser() user: AuthUser, @Query() dto: ListBookingsDto) {
    return this.bookings.list(user, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one booking (participants and admins)' })
  @ApiOkResponse({ type: BookingResponseDto })
  @ApiNotFoundResponse({ description: 'Not found, or not yours' })
  getOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.getOne(user, id);
  }

  @Patch(':id/cancel')
  @ApiOperation({
    summary: 'Cancel a PENDING or CONFIRMED booking',
    description:
      'A paid booking is refunded in full when the provider or an admin cancels, or when the customer cancels at least 24 hours before the start. Later customer cancellations are not refunded.',
  })
  @ApiOkResponse({ type: BookingResponseDto })
  @ApiConflictResponse({ description: 'The booking is not in a cancellable state' })
  @ApiNotFoundResponse({ description: 'Not found, or not yours' })
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.cancel(user, id);
  }

  @Roles(Role.ADMIN)
  @Patch(':id/confirm')
  @ApiOperation({
    summary: 'Confirm a booking manually (admin only)',
    description: 'Normally the Stripe webhook confirms paid bookings; this is a manual override.',
  })
  @ApiOkResponse({ type: BookingResponseDto })
  @ApiConflictResponse({ description: 'Not PENDING, or the hold expired' })
  confirm(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.confirm(user, id);
  }

  @Roles(Role.PROVIDER, Role.ADMIN)
  @Patch(':id/complete')
  @ApiOperation({ summary: 'Mark a CONFIRMED booking as completed after it started' })
  @ApiOkResponse({ type: BookingResponseDto })
  @ApiConflictResponse({ description: 'The booking is not CONFIRMED' })
  @ApiBadRequestResponse({ description: 'The booking has not started yet' })
  complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.complete(user, id);
  }
}
