export interface Env {
  NODE_ENV: string;
  PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  ACCESS_TTL_SECONDS: number;
  REFRESH_TTL_SECONDS: number;
  CORS_ORIGINS: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  FRONTEND_URL: string;
}

function required(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function numberOr(raw: Record<string, unknown>, key: string, fallback: number): number {
  const value = raw[key];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${key} must be a positive number`);
  }
  return parsed;
}

// Fails fast at startup instead of crashing later on the first request.
export function validateEnv(raw: Record<string, unknown>): Env {
  const accessSecret = required(raw, 'JWT_ACCESS_SECRET');
  const refreshSecret = required(raw, 'JWT_REFRESH_SECRET');
  if (accessSecret.length < 32 || refreshSecret.length < 32) {
    throw new Error('JWT secrets must be at least 32 characters long');
  }
  if (accessSecret === refreshSecret) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
  }
  return {
    NODE_ENV: typeof raw.NODE_ENV === 'string' ? raw.NODE_ENV : 'development',
    PORT: numberOr(raw, 'PORT', 3000),
    DATABASE_URL: required(raw, 'DATABASE_URL'),
    // Redis is optional at runtime: if it is down, the API still works without caching.
    REDIS_URL:
      typeof raw.REDIS_URL === 'string' && raw.REDIS_URL.length > 0
        ? raw.REDIS_URL
        : 'redis://localhost:6379',
    JWT_ACCESS_SECRET: accessSecret,
    JWT_REFRESH_SECRET: refreshSecret,
    ACCESS_TTL_SECONDS: numberOr(raw, 'ACCESS_TTL_SECONDS', 900),
    REFRESH_TTL_SECONDS: numberOr(raw, 'REFRESH_TTL_SECONDS', 1209600),
    CORS_ORIGINS: typeof raw.CORS_ORIGINS === 'string' ? raw.CORS_ORIGINS : '',
    // Stripe is optional: without keys, checkout and webhook answer 503 and everything else works.
    STRIPE_SECRET_KEY: typeof raw.STRIPE_SECRET_KEY === 'string' ? raw.STRIPE_SECRET_KEY : '',
    STRIPE_WEBHOOK_SECRET: typeof raw.STRIPE_WEBHOOK_SECRET === 'string' ? raw.STRIPE_WEBHOOK_SECRET : '',
    FRONTEND_URL:
      typeof raw.FRONTEND_URL === 'string' && raw.FRONTEND_URL.length > 0
        ? raw.FRONTEND_URL
        : 'http://localhost:3001',
  };
}
