import type { INestApplication } from '@nestjs/common';
import { api, createTestApp, resetDatabase } from './setup/test-app';

describe('Rate limiting (e2e)', () => {
  let throttledApp: INestApplication;

  beforeAll(async () => {
    // The only spec that keeps the real ThrottlerGuard in place.
    throttledApp = await createTestApp({ throttle: true });
    await resetDatabase(throttledApp);
  });

  afterAll(async () => {
    await throttledApp.close();
  });

  it('returns 429 once the sign-in attempt limit is exceeded', async () => {
    const attempt = () =>
      api(throttledApp)
        .post('/api/v1/auth/sign-in')
        .send({ email: 'nobody@example.com', password: 'WrongPassw0rd!' });

    const statuses: number[] = [];
    for (let index = 0; index < 14; index += 1) {
      statuses.push((await attempt()).status);
    }

    expect(statuses.filter((status) => status === 401).length).toBeGreaterThan(0);
    expect(statuses).toContain(429);
  });
});
