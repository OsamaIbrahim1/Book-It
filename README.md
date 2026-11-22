# BookIt

Booking marketplace API. Customers book time slots with service providers (technicians, tutors, barbers) and pay online.

**Status:** foundation (week 1). Auth, RBAC, schema, Docker and CI are done. Services, availability, bookings and Stripe are next.

## Stack

NestJS 11, TypeScript (strict), PostgreSQL 16, Prisma 6, JWT (access + rotating refresh tokens), argon2, Swagger, Jest, Docker, GitHub Actions. Redis is in docker-compose for rate-limit storage, caching and BullMQ jobs in the next weeks.

## Run locally

```bash
cp .env.example .env            # then set real JWT secrets
docker compose up -d db redis   # Postgres and Redis only
npm install
npx prisma migrate dev --name init   # creates prisma/migrations (commit this folder)
npm run prisma:seed             # demo users
npm run start:dev
```

- API docs: http://localhost:3000/docs
- Health check: http://localhost:3000/health
- Demo accounts (password `Passw0rd!`): `admin@bookit.dev`, `provider@bookit.dev`, `customer@bookit.dev`

Run everything in containers (needs `prisma/migrations` to exist, so run the migrate step above once first):

```bash
docker compose up --build
```

## Tests

```bash
npm test
npm run test:cov
```

## Auth design

- Passwords hashed with argon2.
- Access token: 15 minutes. Refresh token: 14 days, stored only as a SHA-256 hash.
- Refresh tokens rotate: each one works once. Replaying a used token revokes all sessions of that user.
- Routes are protected by default; `@Public()` opens a route, `@Roles(...)` restricts it.
- Admins can never be created through the public API.
- Login returns the same error for unknown email and wrong password.
- Rate limit: 100 requests/minute globally, 10/minute on auth endpoints.

## Roadmap

- [x] Week 1: project setup, Docker, CI, schema, auth with refresh rotation, RBAC, tests
- [ ] Week 2: providers, services, availability, slot generation, search with Redis caching
- [ ] Week 3: bookings with double-booking protection, Stripe checkout and idempotent webhook, BullMQ jobs
- [ ] Week 4: Next.js frontend, admin, deployment

## Trade-offs

- Prisma cannot express partial unique indexes, so double-booking protection will be a hand-written SQL migration (see the comment in `prisma/schema.prisma`).
- The role is read from the access token, so a role change takes effect after the token expires (15 minutes).
