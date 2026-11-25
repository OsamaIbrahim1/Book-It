import { testDatabaseUrl } from './test-db';

// Runs in every test worker before the app is created.
process.env.DATABASE_URL = testDatabaseUrl();
process.env.JWT_ACCESS_SECRET ??= 'e2e-access-secret-e2e-access-secret-0001';
process.env.JWT_REFRESH_SECRET ??= 'e2e-refresh-secret-e2e-refresh-secret-02';
// Dummy Stripe keys: the webhook test signs events locally, so no network call is made.
process.env.STRIPE_SECRET_KEY = 'sk_test_e2e_dummy';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_e2e_dummy';
