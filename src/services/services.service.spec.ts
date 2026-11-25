import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SearchServicesDto, ServiceSort } from './dto/service.dto';
import { SERVICES_CACHE, ServicesService } from './services.service';

const row = {
  id: 's1',
  title: 'AC maintenance',
  description: null,
  priceCents: 2500,
  currency: 'usd',
  durationMin: 60,
  active: true,
  createdAt: new Date('2026-11-20T10:00:00Z'),
  provider: { id: 'p1', city: 'Cairo', timezone: 'Africa/Cairo', user: { name: 'Sam' } },
};

describe('ServicesService', () => {
  let service: ServicesService;

  const prisma = {
    providerProfile: { findUnique: jest.fn() },
    service: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const redis = { cached: jest.fn(), bump: jest.fn() };

  const search = (overrides: Partial<SearchServicesDto> = {}) =>
    ({ sort: ServiceSort.NEWEST, page: 1, limit: 20, ...overrides }) as SearchServicesDto;

  beforeEach(async () => {
    jest.resetAllMocks();
    // Cache miss: always run the loader.
    redis.cached.mockImplementation((_ns, _params, _ttl, loader) => loader());

    const moduleRef = await Test.createTestingModule({
      providers: [
        ServicesService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();
    service = moduleRef.get(ServicesService);
  });

  describe('create', () => {
    it('refuses users without a provider profile', async () => {
      prisma.providerProfile.findUnique.mockResolvedValue(null);
      await expect(
        service.create('u1', { title: 'AC', priceCents: 2500, durationMin: 60 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.service.create).not.toHaveBeenCalled();
    });

    it('stores the service for the caller and clears the search cache', async () => {
      prisma.providerProfile.findUnique.mockResolvedValue({ id: 'p1' });
      prisma.service.create.mockResolvedValue(row);

      const result = await service.create('u1', { title: 'AC maintenance', priceCents: 2500, durationMin: 60 });

      expect(prisma.service.create.mock.calls[0][0].data.providerId).toBe('p1');
      expect(redis.bump).toHaveBeenCalledWith(SERVICES_CACHE);
      expect(result.provider).toEqual({ id: 'p1', name: 'Sam', city: 'Cairo', timezone: 'Africa/Cairo' });
    });
  });

  describe('update / remove', () => {
    it('returns 404 for an unknown service', async () => {
      prisma.providerProfile.findUnique.mockResolvedValue({ id: 'p1' });
      prisma.service.findUnique.mockResolvedValue(null);
      await expect(service.update('u1', 's1', { title: 'New' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it("refuses to change another provider's service", async () => {
      prisma.providerProfile.findUnique.mockResolvedValue({ id: 'p1' });
      prisma.service.findUnique.mockResolvedValue({ id: 's1', providerId: 'p2' });
      await expect(service.update('u1', 's1', { title: 'New' })).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.service.update).not.toHaveBeenCalled();
    });

    it('deactivates instead of deleting and clears the cache', async () => {
      prisma.providerProfile.findUnique.mockResolvedValue({ id: 'p1' });
      prisma.service.findUnique.mockResolvedValue({ id: 's1', providerId: 'p1' });
      prisma.service.update.mockResolvedValue({});

      await service.remove('u1', 's1');

      expect(prisma.service.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { active: false } });
      expect(redis.bump).toHaveBeenCalledWith(SERVICES_CACHE);
    });
  });

  describe('search', () => {
    it('rejects an inverted price range before touching cache or database', async () => {
      await expect(service.search(search({ minPrice: 5000, maxPrice: 1000 }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(redis.cached).not.toHaveBeenCalled();
    });

    it('filters, paginates and reports totals', async () => {
      prisma.$transaction.mockResolvedValue([45, [row]]);

      const result = await service.search(search({ q: ' ac ', city: 'cai', page: 2, limit: 20 }));

      const args = prisma.service.findMany.mock.calls[0][0];
      expect(args.skip).toBe(20);
      expect(args.take).toBe(20);
      expect(args.where.active).toBe(true);
      expect(args.where.OR).toHaveLength(2);
      expect(args.where.OR[0].title.contains).toBe('ac'); // trimmed
      expect(args.where.provider.city.contains).toBe('cai');
      expect(result.total).toBe(45);
      expect(result.totalPages).toBe(3);
      expect(result.items).toHaveLength(1);
    });

    it('uses the same cache key for equal searches', async () => {
      prisma.$transaction.mockResolvedValue([0, []]);
      await service.search(search({ q: 'ac' }));
      await service.search(search({ q: ' ac ' }));
      const [first, second] = redis.cached.mock.calls;
      expect(first[1]).toEqual(second[1]);
    });

    it('sorts by price with a stable tiebreaker', async () => {
      prisma.$transaction.mockResolvedValue([0, []]);
      await service.search(search({ sort: ServiceSort.PRICE_ASC }));
      expect(prisma.service.findMany.mock.calls[0][0].orderBy).toEqual([{ priceCents: 'asc' }, { id: 'asc' }]);
    });
  });
});
