import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateCheckoutDto {
  @ApiProperty({ format: 'uuid', description: 'A PENDING booking of yours.' })
  @IsUUID()
  bookingId!: string;
}

export class CheckoutResponseDto {
  @ApiProperty({ description: 'Redirect the customer here to pay.', example: 'https://checkout.stripe.com/c/pay/cs_test_...' })
  url!: string;

  @ApiProperty({ example: 'cs_test_a1b2c3' })
  sessionId!: string;
}

export class WebhookResponseDto {
  @ApiProperty({ example: true })
  received!: boolean;

  @ApiProperty({ example: false, description: 'true when this event id was already processed.' })
  duplicate!: boolean;
}
