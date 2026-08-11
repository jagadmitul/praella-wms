import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

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
    // Read directly rather than via Prisma's `env()` helper, which throws the
    // moment the config file is loaded if the variable is unset. `prisma
    // generate` needs no database at all, so that turned a missing
    // DATABASE_URL into a failed `pnpm install` (the postinstall hook) and a
    // failed Docker build. Commands that genuinely need a connection still
    // fail, just later and with a clearer message.
    url: process.env.DATABASE_URL ?? '',
  },
});
