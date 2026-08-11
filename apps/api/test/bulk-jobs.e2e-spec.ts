import type { INestApplication } from '@nestjs/common';
import {
  api,
  createTestApp,
  seedFixture,
  type Fixture,
} from './setup/test-app';

/**
 * Background queue coverage.
 *
 * This is the one spec that runs with Redis enabled — `env.setup.ts` switches
 * `REDIS_ENABLED` on for any file whose name contains "bulk-jobs". It needs the
 * Redis from `docker compose up`; without it the suite fails loudly rather than
 * silently skipping, because a queue that never drains is exactly the kind of
 * thing a test should catch.
 */
describe('Bulk stock jobs (e2e)', () => {
  let app: INestApplication;
  let fixture: Fixture;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    fixture = await seedFixture(app);
  });

  afterAll(async () => {
    await app.close();
  });

  const as = (token: string) => ({
    get: (path: string) =>
      api(app).get(path).set('Authorization', `Bearer ${token}`),
    post: (path: string) =>
      api(app).post(path).set('Authorization', `Bearer ${token}`),
  });

  /** Polls a job until it leaves the queued/processing states. */
  async function waitForCompletion(jobId: string, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const response = await as(fixture.manager.token)
        .get(`/api/v1/jobs/${jobId}`)
        .expect(200);

      if (!['QUEUED', 'PROCESSING'].includes(response.body.status)) {
        return response.body;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error(`Job ${jobId} did not finish within ${timeoutMs}ms`);
  }

  it('accepts the request immediately and applies the lines in the background', async () => {
    const queued = await as(fixture.manager.token)
      .post('/api/v1/jobs/bulk-stock-adjustments')
      .send({
        lines: Array.from({ length: 25 }, () => ({
          sku: fixture.productSku,
          warehouseCode: 'ALPHA',
          delta: 4,
          reason: 'Cycle count',
        })),
      })
      .expect(202);

    expect(queued.body).toMatchObject({
      status: 'QUEUED',
      totalLines: 25,
      processedLines: 0,
    });

    const finished = await waitForCompletion(queued.body.id);

    expect(finished.status).toBe('COMPLETED');
    expect(finished.processedLines).toBe(25);
    expect(finished.failedLines).toBe(0);

    const levels = await as(fixture.manager.token)
      .get(`/api/v1/stock/levels?productId=${fixture.productId}`)
      .expect(200);

    // 500 opening + (25 × 4)
    expect(levels.body.items[0].quantity).toBe(600);
  });

  it('fails only the bad lines and reports each one', async () => {
    const queued = await as(fixture.manager.token)
      .post('/api/v1/jobs/bulk-stock-adjustments')
      .send({
        lines: [
          { sku: fixture.productSku, warehouseCode: 'ALPHA', delta: 10 },
          { sku: 'DOES-NOT-EXIST', warehouseCode: 'ALPHA', delta: 5 },
          {
            sku: fixture.productSku,
            warehouseCode: 'NO-SUCH-WAREHOUSE',
            delta: 5,
          },
          { sku: fixture.productSku, warehouseCode: 'ALPHA', delta: -100_000 },
        ],
      })
      .expect(202);

    const finished = await waitForCompletion(queued.body.id);

    expect(finished.status).toBe('COMPLETED_WITH_ERRORS');
    expect(finished.processedLines).toBe(1);
    expect(finished.failedLines).toBe(3);

    const messages = finished.errors.map(
      (error: { message: string }) => error.message,
    );
    expect(messages[0]).toContain('Unknown SKU');
    expect(messages[1]).toContain('Unknown warehouse code');
    expect(messages[2]).toContain('Insufficient stock');

    // The one good line still applied.
    const levels = await as(fixture.manager.token)
      .get(`/api/v1/stock/levels?productId=${fixture.productId}`)
      .expect(200);
    expect(levels.body.items[0].quantity).toBe(510);
  });

  it('denies STAFF the ability to queue bulk adjustments', async () => {
    await as(fixture.staff.token)
      .post('/api/v1/jobs/bulk-stock-adjustments')
      .send({
        lines: [{ sku: fixture.productSku, warehouseCode: 'ALPHA', delta: 1 }],
      })
      .expect(403);
  });

  it('rejects an empty job', async () => {
    await as(fixture.manager.token)
      .post('/api/v1/jobs/bulk-stock-adjustments')
      .send({ lines: [] })
      .expect(422);
  });
});
