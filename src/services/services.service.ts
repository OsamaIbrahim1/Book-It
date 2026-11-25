import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CreateServiceDto, SearchServicesDto, ServiceSort, UpdateServiceDto } from './dto/service.dto';

// Cache namespace for search results. Any change to services or provider details bumps it.
export const SERVICES_CACHE = 'services:list';
const SEARCH_TTL_SECONDS = 60;

const SERVICE_SELECT = {
  id: true,
  title: true,
  description: true,
  priceCents: true,
  currency: true,
  durationMin: true,
  active: true,
  createdAt: true,
  provider: {
    select: { id: true, city: true, timezone: true, user: { select: { name: true } } },
  },
} satisfies Prisma.ServiceSelect;

type ServiceRow = Prisma.ServiceGetPayload<{ select: typeof SERVICE_SELECT }>;

// Flattens the DB row so the API never exposes the provider's user record (email, etc.).
function toView(row: ServiceRow) {
  const { provider, ...rest } = row;
  return {
    ...rest,
    provider: {
      id: provider.id,
      name: provider.user.name,
      city: provider.city,
      timezone: provider.timezone,
    },
  };
}

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async search(dto: SearchServicesDto) {
    if (dto.minPrice !== undefined && dto.maxPrice !== undefined && dto.minPrice > dto.maxPrice) {
      throw new BadRequestException('minPrice cannot be greater than maxPrice');
    }

    // Normalized and in a fixed key order, so equal searches share one cache entry.
    const params = {
      q: dto.q?.trim() || null,
      city: dto.city?.trim() || null,
      minPrice: dto.minPrice ?? null,
      maxPrice: dto.maxPrice ?? null,
      providerId: dto.providerId ?? null,
      sort: dto.sort,
      page: dto.page,
      limit: dto.limit,
    };

    return this.redis.cached(SERVICES_CACHE, params, SEARCH_TTL_SECONDS, async () => {
      const where: Prisma.ServiceWhereInput = { active: true };
      if (params.q) {
        where.OR = [
          { title: { contains: params.q, mode: 'insensitive' } },
          { description: { contains: params.q, mode: 'insensitive' } },
        ];
      }
      if (params.city) where.provider = { city: { contains: params.city, mode: 'insensitive' } };
      if (params.providerId) where.providerId = params.providerId;
      if (params.minPrice !== null || params.maxPrice !== null) {
        where.priceCents = {
          ...(params.minPrice !== null ? { gte: params.minPrice } : {}),
          ...(params.maxPrice !== null ? { lte: params.maxPrice } : {}),
        };
      }

      // id as a tiebreaker keeps pagination stable when sort values are equal.
      const orderBy: Prisma.ServiceOrderByWithRelationInput[] =
        params.sort === ServiceSort.PRICE_ASC
          ? [{ priceCents: 'asc' }, { id: 'asc' }]
          : params.sort === ServiceSort.PRICE_DESC
            ? [{ priceCents: 'desc' }, { id: 'asc' }]
            : [{ createdAt: 'desc' }, { id: 'asc' }];

      const [total, rows] = await this.prisma.$transaction([
        this.prisma.service.count({ where }),
        this.prisma.service.findMany({
          where,
          orderBy,
          skip: (params.page - 1) * params.limit,
          take: params.limit,
          select: SERVICE_SELECT,
        }),
      ]);

      return {
        items: rows.map(toView),
        page: params.page,
        limit: params.limit,
        total,
        totalPages: Math.ceil(total / params.limit),
      };
    });
  }

  async getOne(id: string) {
    const row = await this.prisma.service.findFirst({
      where: { id, active: true },
      select: SERVICE_SELECT,
    });
    if (!row) throw new NotFoundException('Service not found');
    return toView(row);
  }

  async create(userId: string, dto: CreateServiceDto) {
    const profile = await this.profileOf(userId);
    const row = await this.prisma.service.create({
      data: {
        providerId: profile.id,
        title: dto.title,
        description: dto.description,
        priceCents: dto.priceCents,
        durationMin: dto.durationMin,
        currency: dto.currency,
      },
      select: SERVICE_SELECT,
    });
    await this.redis.bump(SERVICES_CACHE);
    return toView(row);
  }

  async update(userId: string, id: string, dto: UpdateServiceDto) {
    await this.assertOwner(userId, id);
    const row = await this.prisma.service.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        priceCents: dto.priceCents,
        durationMin: dto.durationMin,
        currency: dto.currency,
        active: dto.active,
      },
      select: SERVICE_SELECT,
    });
    await this.redis.bump(SERVICES_CACHE);
    return toView(row);
  }

  // Soft delete: bookings keep pointing at the service, so the row must stay.
  async remove(userId: string, id: string): Promise<void> {
    await this.assertOwner(userId, id);
    await this.prisma.service.update({ where: { id }, data: { active: false } });
    await this.redis.bump(SERVICES_CACHE);
  }

  private async profileOf(userId: string) {
    const profile = await this.prisma.providerProfile.findUnique({ where: { userId } });
    if (!profile) throw new ForbiddenException('Provider profile required');
    return profile;
  }

  private async assertOwner(userId: string, serviceId: string) {
    const profile = await this.profileOf(userId);
    const service = await this.prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) throw new NotFoundException('Service not found');
    if (service.providerId !== profile.id) {
      throw new ForbiddenException('You can only change your own services');
    }
  }
}
