import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

// Demo accounts for local development and the live demo. Change the password in production.
const DEMO_PASSWORD = 'Passw0rd!';

async function main() {
  const passwordHash = await argon2.hash(DEMO_PASSWORD);

  await prisma.user.upsert({
    where: { email: 'admin@bookit.dev' },
    update: {},
    create: { email: 'admin@bookit.dev', name: 'Admin', passwordHash, role: Role.ADMIN },
  });

  await prisma.user.upsert({
    where: { email: 'customer@bookit.dev' },
    update: {},
    create: { email: 'customer@bookit.dev', name: 'Demo Customer', passwordHash, role: Role.CUSTOMER },
  });

  await prisma.user.upsert({
    where: { email: 'provider@bookit.dev' },
    update: {},
    create: {
      email: 'provider@bookit.dev',
      name: 'Demo Provider',
      passwordHash,
      role: Role.PROVIDER,
      providerProfile: {
        create: {
          bio: 'Experienced home technician.',
          city: 'Cairo',
          services: {
            create: [
              { title: 'AC maintenance', priceCents: 2500, durationMin: 60 },
              { title: 'Electrical inspection', priceCents: 4000, durationMin: 90 },
            ],
          },
          // Sunday to Thursday, 09:00-17:00
          availability: {
            create: [0, 1, 2, 3, 4].map((dayOfWeek) => ({
              dayOfWeek,
              startMinute: 9 * 60,
              endMinute: 17 * 60,
            })),
          },
        },
      },
    },
  });

  console.log('Seed complete. Demo password:', DEMO_PASSWORD);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
