import 'reflect-metadata';
import { Logger, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import compression from 'compression';
import express from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { JsonLogger } from './observability/json-logger';
import { currentRequestId } from './observability/request-context';

/**
 * Boots the HTTP server.
 *
 * The API is versioned via a URI prefix (`/api/v1`) from day one. Retrofitting
 * versioning onto an integration surface that ERP and ecommerce systems already
 * call is far more expensive than carrying the prefix from the start.
 */
async function bootstrap(): Promise<void> {
  // Log lines carry the request's correlation id without any call site
  // needing to pass it.
  JsonLogger.bindRequestContext(currentRequestId);

  const app = await NestFactory.create(AppModule, {
    bufferLogs: false,
    logger: new JsonLogger(),
  });
  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.use(helmet());
  app.use(compression());
  // CSV imports arrive as a raw body rather than multipart: it keeps the API
  // curl-friendly and avoids a file-upload dependency for a text format.
  app.use(express.text({ type: 'text/csv', limit: '20mb' }));

  app.enableCors({
    origin: configService.getOrThrow<string[]>('CORS_ORIGINS'),
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-organization-id', 'x-request-id'],
    exposedHeaders: ['x-request-id'],
  });

  app.setGlobalPrefix('api', { exclude: ['health', 'health/ready', 'metrics'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Warehouse & Inventory Management API')
    .setDescription(
      [
        'REST API for a multi-tenant warehouse and inventory management system.',
        '',
        '**Authentication** — call `POST /api/v1/auth/sign-in`, then send the access token as `Authorization: Bearer <token>`.',
        '',
        '**Organisation context** — every tenant-scoped route resolves the organisation from the `x-organization-id` header. It may be omitted when the user belongs to exactly one organisation.',
        '',
        '**Errors** — every failure returns the same body shape: `{ statusCode, error, message, details?, path, timestamp, requestId }`.',
      ].join('\n'),
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .addGlobalParameters({
      name: 'x-organization-id',
      in: 'header',
      required: false,
      schema: { type: 'string' },
      description: 'Organisation to act within.',
    })
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, cleanupOpenApiDoc(document), {
    swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha' },
    customSiteTitle: 'WMS API Reference',
  });

  const port = configService.getOrThrow<number>('PORT');
  await app.listen(port, '0.0.0.0');

  logger.log(`API listening on http://localhost:${port}/api/v1`);
  logger.log(`Prometheus metrics at http://localhost:${port}/metrics`);
  logger.log(`Swagger UI available at http://localhost:${port}/docs`);
}

void bootstrap();
