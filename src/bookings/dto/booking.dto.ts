import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsISO8601, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class CreateBookingDto {
  @ApiProperty({ format: 'uuid', description: 'The service to book.' })
  @IsUUID()
  serviceId!: string;

  @ApiProperty({
    example: '2026-12-06T07:00:00.000Z',
    description: 'Slot start, ISO 8601. Must be one of the values returned by GET /providers/:id/slots.',
  })
  @IsISO8601({ strict: true })
  startsAt!: string;
}

export class ListBookingsDto {
  @ApiPropertyOptional({ enum: BookingStatus })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}

export class BookingResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: BookingStatus }) status!: BookingStatus;
  @ApiProperty({ example: '2026-12-06T07:00:00.000Z' }) startsAt!: string;
  @ApiProperty({ example: '2026-12-06T08:00:00.000Z' }) endsAt!: string;
  @ApiProperty({ nullable: true, description: 'When an unpaid PENDING booking releases its slot.' })
  expiresAt!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ format: 'uuid' }) serviceId!: string;
  @ApiProperty() serviceTitle!: string;
  @ApiProperty({ description: 'Price in the smallest currency unit.' }) priceCents!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({ format: 'uuid' }) providerId!: string;
  @ApiProperty() providerName!: string;
  @ApiProperty({ format: 'uuid' }) customerId!: string;
  @ApiProperty() customerName!: string;
}

export class PaginatedBookingsDto {
  @ApiProperty({ type: [BookingResponseDto] }) items!: BookingResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
