import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class UpdateProviderDto {
  @ApiPropertyOptional({ example: 'Experienced home technician.', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  bio?: string;

  @ApiPropertyOptional({ example: 'Cairo', maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional({
    example: 'Africa/Cairo',
    description: 'IANA time zone. Availability windows are wall-clock times in this zone.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}

export class AvailabilityRuleDto {
  @ApiProperty({ minimum: 0, maximum: 6, example: 0, description: '0 = Sunday ... 6 = Saturday' })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @ApiProperty({ minimum: 0, maximum: 1439, example: 540, description: 'Minutes since midnight (540 = 09:00)' })
  @IsInt()
  @Min(0)
  @Max(1439)
  startMinute!: number;

  @ApiProperty({ minimum: 1, maximum: 1440, example: 1020, description: 'Minutes since midnight (1020 = 17:00)' })
  @IsInt()
  @Min(1)
  @Max(1440)
  endMinute!: number;
}

export class SetAvailabilityDto {
  @ApiProperty({
    type: [AvailabilityRuleDto],
    description: 'Replaces the whole weekly schedule. Windows on the same day must not overlap.',
  })
  @IsArray()
  @ArrayMaxSize(42)
  @ValidateNested({ each: true })
  @Type(() => AvailabilityRuleDto)
  rules!: AvailabilityRuleDto[];
}

export class SlotsQueryDto {
  @ApiProperty({ example: '2026-11-25', description: 'Local date in the provider time zone (YYYY-MM-DD).' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be in YYYY-MM-DD format' })
  date!: string;

  @ApiProperty({ description: 'Service to book. Its duration decides the slot length.' })
  @IsUUID()
  serviceId!: string;
}

// ---- Response shapes (documentation only) ----

export class ProviderProfileDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Demo Provider' }) name!: string;
  @ApiProperty({ type: String, nullable: true }) bio!: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'Cairo' }) city!: string | null;
  @ApiProperty({ example: 'Africa/Cairo' }) timezone!: string;
}

export class ProviderServiceDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty() priceCents!: number;
  @ApiProperty() currency!: string;
  @ApiProperty() durationMin!: number;
}

export class PublicProviderDto extends ProviderProfileDto {
  @ApiProperty({ type: [ProviderServiceDto] }) services!: ProviderServiceDto[];
}

export class SlotDto {
  @ApiProperty({ type: String, format: 'date-time', example: '2026-11-25T07:00:00.000Z' }) startsAt!: string;
  @ApiProperty({ type: String, format: 'date-time', example: '2026-11-25T08:00:00.000Z' }) endsAt!: string;
}

export class SlotsResponseDto {
  @ApiProperty({ example: '2026-11-25' }) date!: string;
  @ApiProperty({ example: 'Africa/Cairo' }) timezone!: string;
  @ApiProperty() serviceId!: string;
  @ApiProperty({ example: 60 }) durationMin!: number;
  @ApiProperty({ type: [SlotDto], description: 'All times are UTC ISO strings.' }) slots!: SlotDto[];
}
