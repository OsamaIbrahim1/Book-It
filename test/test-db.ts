import { config } from 'dotenv';

// Loads .env without overriding variables that are already set (CI sets them directly).
config();

// End-to-end tests run against their own database, so they can wipe tables freely
// without touching development data. Override with TEST_DATABASE_URL if needed.
export function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL is not set (copy .env.example to .env)');
  const url = new URL(base);
  url.pathname = '/bookit_test';
  return url.toString();
}
