import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BookingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SERVICES_CACHE } from '../services/services.service';
import { SetAvailabilityDto, SlotsQueryDto, UpdateProviderDto } from './dto/provider.dto';
import { generateSlots, isValidTimezone, parseDate, zonedToUtc } from './slots.util';

const MAX_DAYS_AHEAD = 90;

@Injectable()
export class ProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getMine(userId: string) {
    const profile = await this.prisma.providerProfile.findUnique({
      where: { userId },
      include: { user: { select: { name: true } } },
    });
    if (!profile) throw new ForbiddenException('Provider profile required');
    return this.toProfile(profile);
  }

  async updateMine(userId: string, dto: UpdateProviderDto) {
    await this.profileOf(userId);
    if (dto.timezone !== undefined && !isValidTimezone(dto.timezone)) {
      throw new BadRequestException('timezone must be a valid IANA time zone, e.g. Africa/Cairo');
    }
    const profile = await this.prisma.providerProfile.update({
      where: { userId },
      data: { bio: dto.bio, city: dto.city, timezone: dto.timezone },
      include: { user: { select: { name: true } } },
    });
    // City and name are part of cached search results.
    await this.redis.bump(SERVICES_CACHE);
    return this.toProfile(profile);
  }

  async getPublic(id: string) {
    const profile = await this.prisma.providerProfile.findUnique({
      where: { id },
      select: {
        id: true,
        bio: true,
        city: true,
        timezone: true,
        user: { select: { name: true } },
        services: {
          where: { active: true },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            title: true,
            description: true,
            priceCents: true,
            currency: true,
            durationMin: true,
          },
        },
      },
    });
    if (!profile) throw new NotFoundException('Provider not found');
    const { user, ...rest } = profile;
    return { ...rest, name: user.name };
  }

  async getMyAvailability(userId: string) {
    const profile = await this.profileOf(userId);
    const rules = await this.prisma.availabilityRule.findMany({
      where: { providerId: profile.id },
      orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
      select: { dayOfWeek: true, startMinute: true, endMinute: true },
    });
    return { rules };
  }

  // Replaces the whole weekly schedule in one transaction.
  async setMyAvailability(userId: string, dto: SetAvailabilityDto) {
    const profile = await this.profileOf(userId);

    const byDay = new Map<number, { startMinute: number; endMinute: number }[]>();
    for (const rule of dto.rules) {
      if (rule.startMinute >= rule.endMinute) {
        throw new BadRequestException('endMinute must be greater than startMinute');
      }
      const list = byDay.get(rule.dayOfWeek) ?? [];
      list.push({ startMinute: rule.startMinute, endMinute: rule.endMinute });
      byDay.set(rule.dayOfWeek, list);
    }
    for (const [day, list] of byDay) {
      list.sort((a, b) => a.startMinute - b.startMinute);
      for (let i = 1; i < list.length; i++) {
        if (list[i].startMinute < list[i - 1].endMinute) {
          throw new BadRequestException(`Overlapping availability windows on day ${day}`);
        }
      }
    }

    await this.prisma.$transaction([
      this.prisma.availabilityRule.deleteMany({ where: { providerId: profile.id } }),
      this.prisma.availabilityRule.createMany({
        data: dto.rules.map((r) => ({
          providerId: profile.id,
          dayOfWeek: r.dayOfWeek,
          startMinute: r.startMinute,
          endMinute: r.endMinute,
        })),
      }),
    ]);
    return this.getMyAvailability(userId);
  }

  async slots(providerId: string, query: SlotsQueryDto) {
    const parsed = parseDate(query.date);
    if (!parsed) throw new BadRequestException('date must be a valid date in YYYY-MM-DD format');

    const provider = await this.prisma.providerProfile.findUnique({
      where: { id: providerId },
      include: { availability: true },
    });
    if (!provider) throw new NotFoundException('Provider not found');

    const service = await this.prisma.service.findFirst({
      where: { id: query.serviceId, providerId, active: true },
    });
    if (!service) throw new NotFoundException('Service not found for this provider');

    const now = new Date();
    const { y, m, d } = parsed;
    const dayStart = zonedToUtc(y, m, d, 0, provider.timezone);
    const dayEnd = zonedToUtc(y, m, d, 1440, provider.timezone);
    if (dayStart.getTime() > now.getTime() + MAX_DAYS_AHEAD * 86_400_000) {
      throw new BadRequestException(`date is too far ahead (maximum ${MAX_DAYS_AHEAD} days)`);
    }

    // Confirmed bookings always block time. Pending ones block it only until they expire.
    const busyRows = await this.prisma.booking.findMany({
      where: {
        providerId,
        startsAt: { lt: dayEnd },
        endsAt: { gt: dayStart },
        OR: [
          { status: BookingStatus.CONFIRMED },
          {
            status: BookingStatus.PENDING,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        ],
      },
      select: { startsAt: true, endsAt: true },
    });

    const slots = generateSlots({
      date: query.date,
      timezone: provider.timezone,
      durationMin: service.durationMin,
      rules: provider.availability,
      busy: busyRows.map((b) => ({ start: b.startsAt, end: b.endsAt })),
      now,
    });

    return {
      date: query.date,
      timezone: provider.timezone,
      serviceId: service.id,
      durationMin: service.durationMin,
      slots: slots.map((s) => ({ startsAt: s.start.toISOString(), endsAt: s.end.toISOString() })),
    };
  }

  private async profileOf(userId: string) {
    const profile = await this.prisma.providerProfile.findUnique({ where: { userId } });
    if (!profile) throw new ForbiddenException('Provider profile required');
    return profile;
  }

  private toProfile(profile: {
    id: string;
    bio: string | null;
    city: string | null;
    timezone: string;
    user: { name: string };
  }) {
    return {
      id: profile.id,
      name: profile.user.name,
      bio: profile.bio,
      city: profile.city,
      timezone: profile.timezone,
    };
  }
}
