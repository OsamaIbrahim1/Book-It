export interface Env {
  NODE_ENV: string;
  PORT: number;
  DATABASE_URL: string;
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  ACCESS_TTL_SECONDS: number;
  REFRESH_TTL_SECONDS: number;
  CORS_ORIGINS: string;
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
    JWT_ACCESS_SECRET: accessSecret,
    JWT_REFRESH_SECRET: refreshSecret,
    ACCESS_TTL_SECONDS: numberOr(raw, 'ACCESS_TTL_SECONDS', 900),
    REFRESH_TTL_SECONDS: numberOr(raw, 'REFRESH_TTL_SECONDS', 1209600),
    CORS_ORIGINS: typeof raw.CORS_ORIGINS === 'string' ? raw.CORS_ORIGINS : '',
  };
}
