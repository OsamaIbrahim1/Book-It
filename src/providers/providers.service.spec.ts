import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ProvidersService } from './providers.service';

describe('ProvidersService', () => {
  let service: ProvidersService;

  const prisma = {
    providerProfile: { findUnique: jest.fn(), update: jest.fn() },
    availabilityRule: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const redis = { bump: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.providerProfile.findUnique.mockResolvedValue({ id: 'p1', userId: 'u1' });
    prisma.availabilityRule.findMany.mockResolvedValue([]);
    prisma.$transaction.mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProvidersService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();
    service = moduleRef.get(ProvidersService);
  });

  describe('setMyAvailability', () => {
    it('rejects overlapping windows on the same day', async () => {
      await expect(
        service.setMyAvailability('u1', {
          rules: [
            { dayOfWeek: 1, startMinute: 540, endMinute: 720 },
            { dayOfWeek: 1, startMinute: 700, endMinute: 900 },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a window that ends before it starts', async () => {
      await expect(
        service.setMyAvailability('u1', { rules: [{ dayOfWeek: 1, startMinute: 600, endMinute: 600 }] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows touching windows and different days', async () => {
      await service.setMyAvailability('u1', {
        rules: [
          { dayOfWeek: 1, startMinute: 540, endMinute: 720 },
          { dayOfWeek: 1, startMinute: 720, endMinute: 900 },
          { dayOfWeek: 2, startMinute: 540, endMinute: 900 },
        ],
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('refuses users without a provider profile', async () => {
      prisma.providerProfile.findUnique.mockResolvedValue(null);
      await expect(service.setMyAvailability('u1', { rules: [] })).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('updateMine', () => {
    it('rejects an invalid time zone', async () => {
      await expect(service.updateMine('u1', { timezone: 'Mars/Olympus' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.providerProfile.update).not.toHaveBeenCalled();
    });

    it('saves a valid profile and clears the search cache', async () => {
      prisma.providerProfile.update.mockResolvedValue({
        id: 'p1',
        bio: 'Hi',
        city: 'Giza',
        timezone: 'Africa/Cairo',
        user: { name: 'Sam' },
      });
      const result = await service.updateMine('u1', { city: 'Giza', timezone: 'Africa/Cairo' });
      expect(result.city).toBe('Giza');
      expect(redis.bump).toHaveBeenCalledTimes(1);
    });
  });
});
