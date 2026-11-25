import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp, resetDatabase } from './helpers';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const credentials = { email: 'osama@e2e.test', password: 'Passw0rd!x', name: 'Osama' };

  beforeAll(async () => {
    await resetDatabase(prisma);
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('registers, logs in, reads /auth/me, and rejects a protected route without a token', async () => {
    const register = await request(app.getHttpServer()).post('/auth/register').send(credentials);
    expect(register.status).toBe(201);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: credentials.email, password: credentials.password });
    expect(login.status).toBe(200);

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(credentials.email);

    expect((await request(app.getHttpServer()).get('/auth/me')).status).toBe(401);
    expect((await request(app.getHttpServer()).post('/auth/login').send({ email: credentials.email, password: 'wrong-pass' })).status).toBe(401);
  });

  it('rotates refresh tokens and revokes every session when an old one is reused', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: credentials.email, password: credentials.password });
    const oldRefresh = login.body.refreshToken as string;

    const rotated = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: oldRefresh });
    expect(rotated.status).toBe(200);
    const newRefresh = rotated.body.refreshToken as string;
    expect(newRefresh).not.toBe(oldRefresh);

    // Reusing the old token looks like theft: it fails and kills the new token too.
    expect((await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: oldRefresh })).status).toBe(401);
    expect((await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: newRefresh })).status).toBe(401);
  });
});
