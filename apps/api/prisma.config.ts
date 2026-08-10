import 'dotenv/config';
import path from 'node:path';
import { defineConfig, env } from 'prisma/config';

/**
 * Prisma 7 moved project configuration out of `package.json` and into this
 * file. It is read by the Prisma CLI only (migrate, generate, studio, seed) —
 * the runtime client is constructed with a `pg` driver adapter in
 * `src/prisma/prisma.service.ts`.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
