import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { testDatabaseUrl } from './test-db';

// Runs once before all e2e tests: creates the test database if missing and applies every migration,
// including the booking_no_overlap exclusion constraint.
export default async function globalSetup() {
  const url = testDatabaseUrl();
  const name = new URL(url).pathname.slice(1);
  if (!/^[a-z0-9_]+$/i.test(name)) throw new Error(`Unsafe test database name: ${name}`);

  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } catch (err) {
    if (!/already exists/i.test(String(err))) throw err;
  } finally {
    await admin.$disconnect();
  }

  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
