import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  // Admins are never created through the public API.
  @IsOptional()
  @IsIn(['CUSTOMER', 'PROVIDER'])
  role?: 'CUSTOMER' | 'PROVIDER';
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MaxLength(128)
  password!: string;
}

export class RefreshDto {
  @IsString()
  refreshToken!: string;
}
