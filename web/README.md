# BookIt web

Next.js (App Router) + TypeScript frontend for the BookIt API.

## Run

```bash
npm install
copy .env.example .env.local     # Windows (use cp on macOS/Linux)
npm run dev                       # http://localhost:3001
```

The API must run on `NEXT_PUBLIC_API_URL` (default `http://localhost:3000`) and its `CORS_ORIGINS` must include `http://localhost:3001`.

## Pages

| Path | What it does |
|---|---|
| `/` | Search services (text, city, pagination) |
| `/services/:id` | Pick a date and time, book, then go to Stripe |
| `/bookings` | Your bookings, pay or cancel |
| `/bookings/:id` | One booking; after paying it polls until the webhook confirms |
| `/login`, `/register` | Accounts |

## Notes

- Access tokens refresh automatically on a 401; parallel requests share one refresh call because refresh tokens work only once.
- The Stripe redirect is not trusted: the booking page waits for the status to become `CONFIRMED`.
- Tokens are kept in `localStorage` to keep the demo simple. For production, use httpOnly cookies set by the API.
