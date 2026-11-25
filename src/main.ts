import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: Stripe signs the exact bytes it sends, so the webhook needs the unparsed body.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);

  app.use(helmet());
  app.enableCors({
    origin: config
      .get<string>('CORS_ORIGINS', '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();

  const swagger = new DocumentBuilder()
    .setTitle('BookIt API')
    .setDescription(
      [
        'Booking marketplace API: customers book time slots with service providers.',
        '',
        '**How to try it:** call `POST /auth/login` (demo: `provider@bookit.dev` / `Passw0rd!`), copy the `accessToken`, press **Authorize** and paste it.',
        '',
        'Machine-readable spec for Postman or code generators: `/docs-json`.',
      ].join('\n'),
    )
    .setVersion('0.3.0')
    .addBearerAuth()
    .addTag('auth', 'Registration, login and token rotation')
    .addTag('providers', 'Provider profiles, weekly availability and free slots')
    .addTag('services', 'Search and manage bookable services')
    .addTag('bookings', 'Book slots, cancel, confirm and complete')
    .addTag('payments', 'Stripe Checkout and the payment webhook')
    .addTag('health', 'Liveness and database check')
    .build();

  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger), {
    // Keeps the token after a page refresh while testing.
    swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha' },
  });

  await app.listen(config.getOrThrow<number>('PORT'));
}

bootstrap();
