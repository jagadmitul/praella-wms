import { DocumentBuilder } from '@nestjs/swagger';

/**
 * Builds the OpenAPI document metadata.
 *
 * Extracted from `main.ts` so the spec-dump script can produce byte-identical
 * output without booting a server — which is what lets CI diff the committed
 * `openapi.json` against the code and fail on an undocumented change.
 *
 * @returns The OpenAPI base document shared by the live `/docs` route and the
 *   generated spec file.
 */
export function buildOpenApiConfig() {
  return new DocumentBuilder()
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
}
