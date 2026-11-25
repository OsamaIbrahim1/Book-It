import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { BookingStatus, PaymentStatus, PrismaClient, Role } from '@prisma/client';
import Stripe from 'stripe';
import request from 'supertest';
import { isOverlapViolation } from '../src/bookings/bookings.service';
import { createApp, resetDatabase } from './helpers';

// Real HTTP, real PostgreSQL (database "bookit_test"), real constraint. Only Stripe's network is avoided.
describe('Bookings (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const jwt = new JwtService({});

  let serviceId: string;
  let providerId: string;
  let customers: { id: string; token: string }[] = [];

  // A day 3 days ahead (UTC). The provider works 09:00-17:00 UTC every day with 60 minute slots.
  const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const slot = (hour: number) => `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`;

  const token = (id: string, role: Role) =>
    jwt.sign({ sub: id, role }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: 600 });

  const book = (customer: number, startsAt: string) =>
    request(app.getHttpServer())
      .post('/bookings')
      .set('Authorization', `Bearer ${customers[customer].token}`)
      .send({ serviceId, startsAt });

  beforeAll(async () => {
    app = await createApp();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);

    const provider = await prisma.user.create({
      data: {
        email: 'provider@e2e.test',
        name: 'Provider',
        passwordHash: 'x',
        role: Role.PROVIDER,
        providerProfile: {
          create: {
            timezone: 'UTC',
            availability: {
              create: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startMinute: 540, endMinute: 1020 })),
            },
            services: { create: [{ title: 'Haircut', priceCents: 2500, durationMin: 60 }] },
          },
        },
      },
      include: { providerProfile: { include: { services: true } } },
    });
    providerId = provider.providerProfile!.id;
    serviceId = provider.providerProfile!.services[0].id;

    customers = await Promise.all(
      Array.from({ length: 10 }, async (_, i) => {
        const user = await prisma.user.create({
          data: { email: `customer${i}@e2e.test`, name: `Customer ${i}`, passwordHash: 'x', role: Role.CUSTOMER },
        });
        return { id: user.id, token: token(user.id, Role.CUSTOMER) };
      }),
    );
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('lets exactly one of 10 simultaneous requests book the same slot', async () => {
    const results = await Promise.all(customers.map((_, i) => book(i, slot(9))));

    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(9);

    const active = await prisma.booking.count({
      where: { providerId, status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] } },
    });
    expect(active).toBe(1);
  });

  it('allows back-to-back slots and hides the booked one from the slot list', async () => {
    expect((await book(0, slot(9))).status).toBe(201);
    expect((await book(1, slot(10))).status).toBe(201);

    const res = await request(app.getHttpServer()).get(
      `/providers/${providerId}/slots?date=${day}&serviceId=${serviceId}`,
    );
    const starts = (res.body.slots as { startsAt: string }[]).map((s) => s.startsAt);
    expect(starts).not.toContain(slot(9));
    expect(starts).not.toContain(slot(10));
    expect(starts).toContain(slot(11));
  });

  it('rejects a time that is not on the provider schedule', async () => {
    const res = await book(0, `${day}T09:30:00.000Z`);
    expect(res.status).toBe(400);
  });

  it('the database itself refuses overlapping bookings (exclusion constraint)', async () => {
    const start = new Date(slot(13));
    const base = { providerId, serviceId, customerId: customers[0].id };
    await prisma.booking.create({
      data: { ...base, startsAt: start, endsAt: new Date(start.getTime() + 3_600_000), status: BookingStatus.CONFIRMED },
    });

    const overlapping = prisma.booking.create({
      data: {
        ...base,
        startsAt: new Date(start.getTime() + 30 * 60_000),
        endsAt: new Date(start.getTime() + 90 * 60_000),
        status: BookingStatus.PENDING,
      },
    });
    const error = await overlapping.then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).not.toBeNull();
    expect(isOverlapViolation(error)).toBe(true);

    // A cancelled booking does not block the time.
    const cancelled = prisma.booking.create({
      data: { ...base, startsAt: start, endsAt: new Date(start.getTime() + 3_600_000), status: BookingStatus.CANCELLED },
    });
    await expect(cancelled).resolves.toBeDefined();
  });

  it('frees the slot when an unpaid hold has expired', async () => {
    const first = await book(0, slot(9));
    expect(first.status).toBe(201);
    await prisma.booking.update({ where: { id: first.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const second = await book(1, slot(9));
    expect(second.status).toBe(201);
    expect((await prisma.booking.findUnique({ where: { id: first.body.id } }))?.status).toBe(BookingStatus.EXPIRED);
  });

  it('frees the slot when the customer cancels, and hides bookings from other customers', async () => {
    const created = await book(0, slot(9));
    const id = created.body.id as string;

    const stranger = await request(app.getHttpServer())
      .get(`/bookings/${id}`)
      .set('Authorization', `Bearer ${customers[1].token}`);
    expect(stranger.status).toBe(404);

    const cancel = await request(app.getHttpServer())
      .patch(`/bookings/${id}/cancel`)
      .set('Authorization', `Bearer ${customers[0].token}`);
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('CANCELLED');

    expect((await book(1, slot(9))).status).toBe(201);
  });

  describe('Stripe webhook', () => {
    const stripe = new Stripe('sk_test_e2e_dummy');
    const secret = 'whsec_e2e_dummy';

    const send = (payload: string, signature?: string) =>
      request(app.getHttpServer())
        .post('/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature ?? stripe.webhooks.generateTestHeaderString({ payload, secret }))
        .send(payload);

    const eventFor = (bookingId: string) =>
      JSON.stringify({
        id: 'evt_e2e_1',
        object: 'event',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_e2e_1',
            object: 'checkout.session',
            payment_status: 'paid',
            payment_intent: 'pi_e2e_1',
            metadata: { bookingId },
          },
        },
      });

    it('confirms the booking once, and ignores a replayed event', async () => {
      const created = await book(0, slot(9));
      const bookingId = created.body.id as string;
      await prisma.payment.create({
        data: { bookingId, stripeSessionId: 'cs_e2e_1', amountCents: 2500, currency: 'usd' },
      });
      const payload = eventFor(bookingId);

      const first = await send(payload);
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ received: true, duplicate: false });
      expect((await prisma.booking.findUnique({ where: { id: bookingId } }))?.status).toBe(BookingStatus.CONFIRMED);
      expect((await prisma.payment.findUnique({ where: { bookingId } }))?.status).toBe(PaymentStatus.PAID);

      const replay = await send(payload);
      expect(replay.status).toBe(200);
      expect(replay.body).toEqual({ received: true, duplicate: true });
      expect(await prisma.stripeEvent.count()).toBe(1);
    });

    it('rejects a forged signature and changes nothing', async () => {
      const created = await book(0, slot(9));
      const bookingId = created.body.id as string;
      await prisma.payment.create({
        data: { bookingId, stripeSessionId: 'cs_e2e_1', amountCents: 2500, currency: 'usd' },
      });

      const res = await send(eventFor(bookingId), 't=1,v1=deadbeef');
      expect(res.status).toBe(400);
      expect((await prisma.booking.findUnique({ where: { id: bookingId } }))?.status).toBe(BookingStatus.PENDING);
    });
  });
});
