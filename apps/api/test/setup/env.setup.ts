import 'dotenv/config';

/**
 * Runs before each spec file is imported.
 *
 * This has to happen here rather than inside `createTestApp`, because module
 * evaluation reads several of these values the moment a spec imports
 * `AppModule` — `REDIS_ENABLED` decides whether the queue module is loaded at
 * all, and the auth controller reads its throttle limit into a module-level
 * constant.
 *
 * Registered as `setupFilesAfterEnv` so `expect.getState()` is available, which
 * is what lets the rate-limiting spec get a tight limit while every other spec
 * gets a limit high enough not to trip on legitimate traffic.
 */
const testPath = expect.getState().testPath ?? '';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://wms:wms_password@localhost:5437/wms_test?schema=public';

// Integration specs exercise HTTP behaviour, not queue throughput, so Redis is
// off unless the spec name asks for it.
process.env.REDIS_ENABLED = testPath.includes('bulk-jobs') ? 'true' : 'false';

process.env.THROTTLE_LIMIT = testPath.includes('rate-limit') ? '5' : '100000';
process.env.AUTH_THROTTLE_LIMIT = testPath.includes('rate-limit') ? '5' : '100000';

process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET ?? 'test-access-secret-that-is-long-enough-32';
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ?? 'test-refresh-secret-that-is-long-enough-32';
