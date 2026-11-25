import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'ann@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Passw0rd!', minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @ApiProperty({ example: 'Ann Smith', minLength: 2, maxLength: 80 })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  // Admins are never created through the public API.
  @ApiPropertyOptional({
    enum: ['CUSTOMER', 'PROVIDER'],
    default: 'CUSTOMER',
    description: 'Providers get a provider profile automatically. ADMIN cannot be requested.',
  })
  @IsOptional()
  @IsIn(['CUSTOMER', 'PROVIDER'])
  role?: 'CUSTOMER' | 'PROVIDER';
}

export class LoginDto {
  @ApiProperty({ example: 'customer@bookit.dev' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Passw0rd!' })
  @IsString()
  @MaxLength(128)
  password!: string;
}

export class RefreshDto {
  @ApiProperty({ description: 'The refresh token from login or the previous refresh. It works once.' })
  @IsString()
  refreshToken!: string;
}

// ---- Response shapes (documentation only) ----

export class UserDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'customer@bookit.dev' }) email!: string;
  @ApiProperty({ example: 'Demo Customer' }) name!: string;
  @ApiProperty({ enum: Role }) role!: Role;
}

export class TokenPairDto {
  @ApiProperty({ description: 'Short-lived JWT (15 minutes). Send as Authorization: Bearer <token>.' })
  accessToken!: string;

  @ApiProperty({ description: 'Long-lived rotating token (14 days). Use once on POST /auth/refresh.' })
  refreshToken!: string;
}

export class AuthResponseDto extends TokenPairDto {
  @ApiProperty({ type: UserDto }) user!: UserDto;
}
