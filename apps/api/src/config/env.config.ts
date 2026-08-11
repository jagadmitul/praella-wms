import { z } from 'zod';

/**
 * Environment schema. The application refuses to boot if anything here is
 * missing or malformed, so a misconfigured deployment fails immediately and
 * loudly rather than at the first request that happens to need the value.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4300),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3300')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    REDIS_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: z.coerce.number().int().default(6381),
    REDIS_PASSWORD: z.string().optional(),
    REDIS_DB: z.coerce.number().int().min(0).default(0),
    /** Namespaces BullMQ keys so separate environments never share a queue. */
    QUEUE_PREFIX: z.string().min(1).default('wms'),

    /** Public URL of the dashboard, used to build invite and reset links. */
    APP_URL: z.string().url().default('http://localhost:3300'),
    /**
     * Email transport. `console` logs messages instead of sending them, which
     * keeps the demo self-contained; `smtp` sends for real via any provider
     * that speaks SMTP.
     */
    MAIL_TRANSPORT: z.enum(['console', 'smtp']).default('console'),
    MAIL_FROM: z.string().default('Warehouse OS <no-reply@example.com>'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    /** `json` emits one JSON object per log line; defaults to json in production. */
    LOG_FORMAT: z.enum(['pretty', 'json']).optional(),
    /** Set to an OTLP collector URL to enable distributed tracing. */
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    OTEL_SERVICE_NAME: z.string().default('wms-api'),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
    JWT_REFRESH_TTL: z.coerce.number().int().positive().default(1_209_600),

    THROTTLE_TTL: z.coerce.number().int().positive().default(60),
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(200),

    CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  })
  .refine((env) => env.JWT_ACCESS_SECRET !== env.JWT_REFRESH_SECRET, {
    message: 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different',
    path: ['JWT_REFRESH_SECRET'],
  });

export type AppEnv = z.infer<typeof envSchema>;

/**
 * Validates `process.env` against the schema. Wired into `ConfigModule` as its
 * `validate` hook.
 *
 * @param raw - The raw environment object supplied by Nest.
 * @returns The parsed, typed and defaulted environment.
 * @throws When any variable is missing or invalid, listing every problem at once.
 */
export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  return result.data;
}
