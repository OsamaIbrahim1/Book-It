import { Body, Controller, Headers, HttpCode, Post, RawBodyRequest, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import type { Request } from 'express';
import { AuthUser, CurrentUser, Public, Roles } from '../common/decorators';
import { CheckoutResponseDto, CreateCheckoutDto, WebhookResponseDto } from './dto/payment.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @ApiBearerAuth()
  @Roles(Role.CUSTOMER)
  @Post('checkout')
  @ApiOperation({
    summary: 'Start paying for a PENDING booking',
    description: 'Returns a Stripe Checkout URL. The booking is confirmed by the webhook after payment, not by this call.',
  })
  @ApiCreatedResponse({ type: CheckoutResponseDto })
  @ApiNotFoundResponse({ description: 'Booking not found or not yours' })
  @ApiConflictResponse({ description: 'Booking is not PENDING or its hold expired' })
  @ApiServiceUnavailableResponse({ description: 'Stripe keys are not configured' })
  checkout(@CurrentUser() user: AuthUser, @Body() dto: CreateCheckoutDto) {
    return this.payments.createCheckout(user.id, dto.bookingId);
  }

  // Called by Stripe, not by users: public, signature-checked, and exempt from rate limiting.
  @Public()
  @SkipThrottle()
  @Post('webhook')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Stripe webhook',
    description:
      'Verifies the Stripe-Signature header, then handles each event id once. `checkout.session.completed` confirms the booking; a payment that arrives after the hold ended is refunded automatically.',
  })
  @ApiHeader({ name: 'stripe-signature', required: true })
  @ApiOkResponse({ type: WebhookResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid signature' })
  webhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    return this.payments.handleWebhook(req.rawBody, signature);
  }
}
