import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const CURRENCIES = ['usd', 'eur', 'egp', 'sar', 'aed'] as const;

export class CreateServiceDto {
  @ApiProperty({ example: 'AC maintenance', minLength: 3, maxLength: 100 })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  title!: string;

  @ApiPropertyOptional({ example: 'Cleaning, gas check and filter replacement.', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ example: 2500, description: 'Price in the smallest currency unit (cents).' })
  @IsInt()
  @Min(100)
  @Max(10_000_000)
  priceCents!: number;

  @ApiProperty({ example: 60, description: 'Duration in minutes (15 to 480).' })
  @IsInt()
  @Min(15)
  @Max(480)
  durationMin!: number;

  @ApiPropertyOptional({ enum: CURRENCIES, default: 'usd' })
  @IsOptional()
  @IsIn(CURRENCIES)
  currency?: (typeof CURRENCIES)[number];
}

export class UpdateServiceDto extends PartialType(CreateServiceDto) {
  @ApiPropertyOptional({ description: 'false hides the service from search and booking.' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export enum ServiceSort {
  NEWEST = 'newest',
  PRICE_ASC = 'price_asc',
  PRICE_DESC = 'price_desc',
}

export class SearchServicesDto {
  @ApiPropertyOptional({ description: 'Search in title and description.', example: 'ac' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Provider city (partial match).', example: 'Cairo' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional({ description: 'Minimum price in cents.', example: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ description: 'Maximum price in cents.', example: 5000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ description: 'Only services of this provider profile id.' })
  @IsOptional()
  @IsUUID()
  providerId?: string;

  @ApiPropertyOptional({ enum: ServiceSort, default: ServiceSort.NEWEST })
  @IsOptional()
  @IsEnum(ServiceSort)
  sort: ServiceSort = ServiceSort.NEWEST;

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

// ---- Response shapes (documentation only; controllers return plain objects) ----

export class ServiceProviderDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Demo Provider' }) name!: string;
  @ApiProperty({ type: String, nullable: true, example: 'Cairo' }) city!: string | null;
  @ApiProperty({ example: 'Africa/Cairo' }) timezone!: string;
}

export class ServiceResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'AC maintenance' }) title!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ example: 2500 }) priceCents!: number;
  @ApiProperty({ example: 'usd' }) currency!: string;
  @ApiProperty({ example: 60 }) durationMin!: number;
  @ApiProperty() active!: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: ServiceProviderDto }) provider!: ServiceProviderDto;
}

export class PaginatedServicesDto {
  @ApiProperty({ type: [ServiceResponseDto] }) items!: ServiceResponseDto[];
  @ApiProperty({ example: 1 }) page!: number;
  @ApiProperty({ example: 20 }) limit!: number;
  @ApiProperty({ example: 42 }) total!: number;
  @ApiProperty({ example: 3 }) totalPages!: number;
}
