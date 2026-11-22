import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role, User } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');

    const role = dto.role === 'PROVIDER' ? Role.PROVIDER : Role.CUSTOMER;
    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name,
        passwordHash: await argon2.hash(dto.password),
        role,
        ...(role === Role.PROVIDER ? { providerProfile: { create: {} } } : {}),
      },
    });

    return { user: this.toPublic(user), ...(await this.issueTokens(user)) };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    const valid = user ? await argon2.verify(user.passwordHash, dto.password) : false;
    // Same message for unknown email and wrong password, so accounts cannot be enumerated.
    if (!user || !valid) throw new UnauthorizedException('Invalid credentials');

    return { user: this.toPublic(user), ...(await this.issueTokens(user)) };
  }

  // Refresh token rotation: every refresh token works once. Reusing an old one
  // means it may have been stolen, so all sessions of that user are revoked.
  async refresh(token: string): Promise<TokenPair> {
    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(token) },
    });
    if (!stored || stored.userId !== payload.sub) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.revokedAt) {
      await this.revokeAll(stored.userId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    // Atomic claim: if two requests race with the same token, only one wins.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      await this.revokeAll(stored.userId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    const user = await this.prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user) throw new UnauthorizedException('Invalid refresh token');
    return this.issueTokens(user);
  }

  async logout(token: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hash(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return this.toPublic(user);
  }

  private async issueTokens(user: Pick<User, 'id' | 'role'>): Promise<TokenPair> {
    const accessTtl = this.config.getOrThrow<number>('ACCESS_TTL_SECONDS');
    const refreshTtl = this.config.getOrThrow<number>('REFRESH_TTL_SECONDS');

    const accessToken = await this.jwt.signAsync(
      { sub: user.id, role: user.role },
      { secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'), expiresIn: accessTtl },
    );
    // jti makes every refresh token unique even when issued in the same second.
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, jti: randomUUID() },
      { secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'), expiresIn: refreshTtl },
    );

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hash(refreshToken),
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
      },
    });

    return { accessToken, refreshToken };
  }

  private revokeAll(userId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private toPublic(user: User) {
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }
}
