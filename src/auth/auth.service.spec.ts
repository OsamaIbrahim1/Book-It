import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

const CONFIG: Record<string, string | number> = {
  JWT_ACCESS_SECRET: 'test-access-secret-test-access-secret-1',
  JWT_REFRESH_SECRET: 'test-refresh-secret-test-refresh-secret-1',
  ACCESS_TTL_SECONDS: 900,
  REFRESH_TTL_SECONDS: 3600,
};

describe('AuthService', () => {
  let service: AuthService;
  let jwt: JwtService;

  const prisma = {
    user: { findUnique: jest.fn(), create: jest.fn() },
    refreshToken: { create: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { getOrThrow: (key: string) => CONFIG[key] } },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
    jwt = moduleRef.get(JwtService);
  });

  it('rejects registration when the email already exists', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    await expect(
      service.register({ email: 'a@b.com', password: 'Passw0rd!', name: 'Ann' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('never creates an admin through registration', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockImplementation(({ data }) => Promise.resolve({ id: 'u1', ...data }));
    // The DTO validator blocks ADMIN, but the service must not trust it either.
    await service.register({ email: 'a@b.com', password: 'Passw0rd!', name: 'Ann', role: 'ADMIN' as any });
    expect(prisma.user.create.mock.calls[0][0].data.role).toBe('CUSTOMER');
  });

  it('logs in with the right password and returns both tokens', async () => {
    const passwordHash = await argon2.hash('Passw0rd!');
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
      name: 'Ann',
      role: 'CUSTOMER',
      passwordHash,
    });
    const result = await service.login({ email: 'A@B.com', password: 'Passw0rd!' });
    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result.user)).not.toContain('passwordHash');
  });

  it('rejects a wrong password and an unknown email with the same error', async () => {
    const passwordHash = await argon2.hash('Passw0rd!');
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'u1', role: 'CUSTOMER', passwordHash });
    const wrongPassword = service.login({ email: 'a@b.com', password: 'nope-nope' });
    await expect(wrongPassword).rejects.toThrow('Invalid credentials');

    prisma.user.findUnique.mockResolvedValueOnce(null);
    const unknownEmail = service.login({ email: 'x@y.com', password: 'Passw0rd!' });
    await expect(unknownEmail).rejects.toThrow('Invalid credentials');
  });

  it('revokes every session when a used refresh token is replayed', async () => {
    const token = await jwt.signAsync(
      { sub: 'u1', jti: 'abc' },
      { secret: CONFIG.JWT_REFRESH_SECRET as string, expiresIn: 3600 },
    );
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      revokedAt: new Date(),
    });

    await expect(service.refresh(token)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('rotates a valid refresh token', async () => {
    const token = await jwt.signAsync(
      { sub: 'u1', jti: 'abc' },
      { secret: CONFIG.JWT_REFRESH_SECRET as string, expiresIn: 3600 },
    );
    prisma.refreshToken.findUnique.mockResolvedValue({ id: 't1', userId: 'u1', revokedAt: null });
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'CUSTOMER' });

    const pair = await service.refresh(token);
    expect(pair.refreshToken).not.toBe(token);
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a refresh token signed with the wrong secret', async () => {
    const forged = await jwt.signAsync({ sub: 'u1' }, { secret: 'x'.repeat(40), expiresIn: 3600 });
    await expect(service.refresh(forged)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.refreshToken.findUnique).not.toHaveBeenCalled();
  });
});
