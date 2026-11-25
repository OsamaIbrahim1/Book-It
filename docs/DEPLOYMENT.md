# Deployment

Free-tier setup used for the live demo. Free tiers change, so check each provider's current limits.

| Part | Where | Notes |
|---|---|---|
| Web (Next.js) | Vercel, root directory `web` | `NEXT_PUBLIC_API_URL` = the API URL |
| API (NestJS) | Render web service (Docker) | Free instances spin down after 15 minutes idle; the first request can take about a minute |
| PostgreSQL | Neon | Use the **direct** (non-pooled) connection string so `prisma migrate deploy` works. The `booking_no_overlap` migration needs the `btree_gist` extension |
| Redis | Render Key Value | In-memory only: queued jobs are lost on restart, which is safe here because the 60 second sweeper and lazy expiry free stale holds |
| Payments | Stripe test mode | Webhook endpoint `https://<api>/payments/webhook`, event `checkout.session.completed` |

## API environment variables (Render)

```
NODE_ENV=production
DATABASE_URL=<Neon direct connection string>
REDIS_URL=<Render Key Value internal URL>
JWT_ACCESS_SECRET=<random, 32+ chars>
JWT_REFRESH_SECRET=<random, different, 32+ chars>
CORS_ORIGINS=https://<your-web>.vercel.app
FRONTEND_URL=https://<your-web>.vercel.app
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...   # from the Stripe dashboard webhook, not the CLI
```

Render sets `PORT` itself. The container runs `prisma migrate deploy` on every start, then the API.
Health check path: `/health`.

## Steps

1. Neon: create a project, copy the direct connection string.
2. Render: create a Key Value instance (free), then a Web Service from this repo with runtime **Docker**, health check `/health`, and the variables above.
3. Seed demo accounts once from your machine: set `DATABASE_URL` to the Neon string, then `npx prisma db seed`.
4. Vercel: import the repo, set **Root Directory** to `web`, set `NEXT_PUBLIC_API_URL` to the Render URL.
5. Put the Vercel URL into `CORS_ORIGINS` and `FRONTEND_URL` on Render and redeploy.
6. Stripe dashboard (test mode): add the webhook endpoint, copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
7. Test: log in as `customer@bookit.dev`, book a slot, pay with `4242 4242 4242 4242`, and watch it become `CONFIRMED`.
