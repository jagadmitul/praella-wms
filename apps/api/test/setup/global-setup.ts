import 'dotenv/config';
import { execSync } from 'node:child_process';
import { Client } from 'pg';

/**
 * Prepares an isolated database for the integration suite.
 *
 * The tests run against a dedicated `wms_test` database rather than the
 * development one, so running `pnpm test:e2e` can never wipe the demo data a
 * reviewer is looking at in the browser. The database is created if missing and
 * brought up to the latest migration on every run.
 */
export default async function globalSetup(): Promise<void> {
  const testDatabaseUrl =
    process.env.TEST_DATABASE_URL ??
    'postgresql://wms:wms_password@localhost:5437/wms_test?schema=public';

  const url = new URL(testDatabaseUrl);
  const databaseName = url.pathname.replace(/^\//, '');

  const adminUrl = new URL(testDatabaseUrl);
  adminUrl.pathname = '/postgres';
  adminUrl.search = '';

  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();

  const existing = await admin.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [databaseName],
  );

  if (existing.rowCount === 0) {
    // Identifier cannot be parameterised; it comes from our own env, and is
    // quoted to keep the statement well-formed regardless.
    await admin.query(`CREATE DATABASE "${databaseName.replace(/"/g, '""')}"`);
    console.log(`\n[e2e] Created test database "${databaseName}"`);
  }

  await admin.end();

  execSync('pnpm exec prisma migrate deploy', {
    cwd: `${__dirname}/../..`,
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    stdio: 'pipe',
  });

  // Every spec reads DATABASE_URL, so point the whole suite at the test schema.
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.NODE_ENV = 'test';
}
