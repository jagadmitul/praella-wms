/**
 * Generates `openapi.json` from the compiled Nest metadata.
 *
 * Builds the Nest application without listening on a port, applies the same
 * prefix and versioning `main.ts` does, and writes the resulting document to
 * disk. Committing the output makes an undocumented API change show up as a
 * diff in review rather than as a surprise for whoever integrates against it.
 *
 * It lives under `src/` rather than `scripts/` because Nest's dependency
 * injection reads `emitDecoratorMetadata`, which esbuild-based runners such as
 * tsx do not emit — so this has to go through the same `nest build` the server
 * does.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';
import { buildOpenApiConfig } from './openapi.config';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
  });
  app.setGlobalPrefix('api', {
    exclude: ['health', 'health/ready', 'metrics'],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  const document = cleanupOpenApiDoc(
    SwaggerModule.createDocument(app, buildOpenApiConfig()),
  );

  const target = join(__dirname, '..', 'openapi.json');
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();

  const operations = Object.values(document.paths ?? {}).flatMap((path) =>
    Object.keys(path as object).filter((key) =>
      ['get', 'post', 'put', 'patch', 'delete'].includes(key),
    ),
  ).length;
  process.stdout.write(
    `openapi.json written — ${operations} operations, ${
      Object.keys(document.components?.schemas ?? {}).length
    } schemas\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${String(error instanceof Error ? error.stack : error)}\n`,
  );
  process.exit(1);
});
