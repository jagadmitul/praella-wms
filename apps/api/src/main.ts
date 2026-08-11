import 'reflect-metadata';
import { Logger, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { buildOpenApiConfig } from './openapi.config';
import compression from 'compression';
import express from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { startTracing } from './observability/tracing';
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
  // Instrumentation has to be registered before the modules it patches are
  // constructed, so this runs first. It is a no-op unless an OTLP endpoint is
  // configured.
  const tracing = await startTracing();

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
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-organization-id',
      'x-request-id',
    ],
    exposedHeaders: ['x-request-id'],
  });

  app.setGlobalPrefix('api', {
    exclude: ['health', 'health/ready', 'metrics'],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();

  const swaggerConfig = buildOpenApiConfig();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, cleanupOpenApiDoc(document), {
    swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha' },
    customSiteTitle: 'WMS API Reference',
  });

  const port = configService.getOrThrow<number>('PORT');
  await app.listen(port, '0.0.0.0');

  logger.log(`API listening on http://localhost:${port}/api/v1`);
  logger.log(`Prometheus metrics at http://localhost:${port}/metrics`);

  if (tracing) {
    logger.log('OpenTelemetry tracing enabled');
    // Flush buffered spans on shutdown; without this the last few seconds of
    // traces are lost exactly when something has gone wrong.
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      process.on(signal, () => {
        void tracing.shutdown().finally(() => process.exit(0));
      });
    }
  }
  logger.log(`Swagger UI available at http://localhost:${port}/docs`);
}

void bootstrap();
