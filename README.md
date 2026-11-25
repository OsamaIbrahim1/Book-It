# BookIt

Booking marketplace. Customers book time slots with service providers (technicians, tutors, barbers) and pay online with Stripe.

**Status:** API complete (auth, RBAC, availability and slots, bookings with double-booking protection, Stripe payments, background jobs) and a Next.js frontend for customers and providers. Deployment is next.

## Highlights

- **No double bookings:** a row lock per provider inside a transaction, plus a PostgreSQL exclusion constraint as a last line of defense.
- **Idempotent Stripe webhook:** signature check on the raw body, event ids stored and handled in one transaction, late payments refunded automatically.
- **Time zones done right:** availability is wall-clock time in the provider's zone, slots are UTC, daylight saving is covered by tests.
- **Resilient background work:** BullMQ jobs expire unpaid holds and send reminders; if Redis is down the API keeps working.
- **Secure auth:** argon2, short-lived JWT access tokens, rotating refresh tokens with reuse detection.
- **67 unit tests** and CI (lint, test, build) for the API and the web app.

## Stack

- **API (this folder):** NestJS 11, TypeScript (strict), PostgreSQL 16, Prisma 6, Redis, BullMQ, Stripe, JWT, argon2, Swagger/OpenAPI, Jest.
- **Web (`web/`):** Next.js (App Router), React, TypeScript.
- **Tooling:** Docker, docker-compose, GitHub Actions.

```
web/ (Next.js, :3001)  ->  API (NestJS, :3000)  ->  PostgreSQL  (bookings, users, payments)
                                  |--> Redis  (cache, BullMQ queue)
                                  |--> Stripe (Checkout) --webhook--> API
```

## Run locally

```bash
cp .env.example .env            # Windows: copy .env.example .env  (then set real JWT secrets)
docker compose up -d db redis   # Postgres and Redis only
npm install
npx prisma migrate dev          # applies prisma/migrations
npm run prisma:seed             # demo users, services and availability
npm run start:dev
```

- API docs (Swagger UI): http://localhost:3000/docs
- OpenAPI JSON (Postman import): http://localhost:3000/docs-json
- Health check: http://localhost:3000/health
- Demo accounts (password `Passw0rd!`): `admin@bookit.dev`, `provider@bookit.dev`, `customer@bookit.dev`

## Run the web app

```bash
cd web
npm install
copy .env.example .env.local     # macOS/Linux: cp
npm run dev                      # http://localhost:3001
```

See [web/README.md](web/README.md). For payments, also run `stripe listen --events checkout.session.completed --forward-to localhost:3000/payments/webhook` and set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in `.env`.

## Try it in Swagger

1. `POST /auth/login` with `provider@bookit.dev` / `Passw0rd!`, copy `accessToken`, press **Authorize**, paste it.
2. `GET /services` (public) and copy a service `id` and its `provider.id`.
3. `GET /providers/{providerId}/slots?date=YYYY-MM-DD&serviceId=...` for a Sunday to Thursday date to see free slots.
4. As the provider: `PUT /providers/me/availability` to change working hours, `POST /services` to add a service.

## Endpoints

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | /auth/register, /auth/login, /auth/refresh, /auth/logout | public | Accounts and token rotation |
| GET | /auth/me | any user | Current user |
| GET | /services | public | Search: `q`, `city`, `minPrice`, `maxPrice`, `providerId`, `sort`, `page`, `limit` |
| GET | /services/:id | public | One active service |
| POST, PATCH, DELETE | /services, /services/:id | provider (owner) | Manage own services (DELETE deactivates) |
| GET | /providers/:id | public | Profile with active services |
| GET | /providers/:id/slots | public | Free slots for one day and one service |
| GET, PATCH | /providers/me | provider | Own profile (bio, city, time zone) |
| GET, PUT | /providers/me/availability | provider | Weekly working hours |
| POST | /bookings | customer | Book a slot (PENDING, held 30 minutes) |
| GET | /bookings, /bookings/:id | participants, admin | Role-aware list and detail |
| PATCH | /bookings/:id/cancel | participants, admin | Cancel PENDING or CONFIRMED |
| PATCH | /bookings/:id/confirm | admin | Manual override (Stripe webhook normally confirms) |
| POST | /payments/checkout | customer | Stripe Checkout URL for a PENDING booking |
| POST | /payments/webhook | Stripe (signature) | Confirms paid bookings, idempotent |
| PATCH | /bookings/:id/complete | provider, admin | Complete after the start time |

## Design notes

- **Auth:** argon2 hashes; refresh tokens stored as SHA-256 hashes, rotate on every use, and reuse of an old one revokes all sessions of that user. Routes are protected by default, `@Public()` opens one, `@Roles()` restricts one.
- **Time zones:** availability is wall-clock time in the provider's IANA time zone; slots are returned as UTC ISO strings. Conversion handles daylight saving and is covered by unit tests.
- **Slots:** generated on demand from weekly rules and the service duration, minus past times and existing bookings (confirmed, or pending and not expired).
- **Caching:** search results are cached in Redis for 60 seconds under a versioned key; any change to a service or provider profile bumps the version, which invalidates everything at once. If Redis is down, the API logs one warning and keeps working without cache.
- **Soft delete:** deleting a service only deactivates it, so existing bookings keep their reference.
- **Ownership:** a provider can only change their own services (403 otherwise).

- **No double booking, three layers:** (1) the requested time must equal a generated schedule slot; (2) inside a transaction the provider row is locked with `SELECT ... FOR UPDATE`, stale holds are expired, overlaps are re-checked, then the booking is inserted; (3) a PostgreSQL exclusion constraint (`booking_no_overlap`, `btree_gist` + `tsrange`, half-open ranges) rejects overlapping PENDING/CONFIRMED bookings of one provider even if the code is bypassed. Conflicts return 409.
- **Holds and jobs (BullMQ):** an unpaid booking holds its slot for 30 minutes. A delayed job expires it, a repeatable sweeper (every 60 s) catches lost jobs, and a reminder is queued 24 hours before a confirmed booking. Queue calls never fail a request: if Redis is down the API still works, and expired holds are also ignored when slots are computed.
- **Status changes are conditional updates** (`WHERE status = ...`), so racing cancel/confirm/expire requests cannot corrupt a booking. Every change is written to `AuditLog`.

- **Payments (Stripe Checkout):** the API never trusts the browser redirect. The customer pays on Stripe's page and the `checkout.session.completed` webhook confirms the booking. The webhook checks the signature on the raw body, records the event id and handles the event in one transaction (a replayed event id hits the primary key and is ignored; a failure rolls back so Stripe retries). A payment that arrives after the hold ended is refunded automatically. Refund calls use an idempotency key.
- **Refund policy:** provider or admin cancels: always refunded. Customer cancels 24 hours or more before the start: refunded. Later: not refunded. Without Stripe keys, checkout and webhook return 503 and the rest of the API works.

## Tests

```bash
npm test
npm run test:cov
```

## Roadmap

- [x] Week 1: setup, Docker, CI, schema, auth with refresh rotation, RBAC
- [x] Week 2: providers, availability, slot generation, service search with Redis cache, full Swagger docs
- [x] Week 3A: bookings, double-booking protection (lock + DB constraint), BullMQ expiry and reminders
- [x] Week 3B: Stripe checkout, idempotent webhook, refunds
- [x] Week 4: Next.js frontend (customer booking and payment, provider dashboard)
- [ ] Week 5: deployment, screenshots and demo video

## Trade-offs

- Prisma cannot express exclusion constraints, so double-booking protection is a hand-written SQL migration (`prisma/migrations/*_booking_no_overlap`).
- The role is read from the access token, so a role change takes effect after the token expires (15 minutes).
- Slots are not cached on purpose: they change with every booking and must be accurate.
