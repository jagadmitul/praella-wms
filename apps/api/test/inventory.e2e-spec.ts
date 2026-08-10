import type { INestApplication } from '@nestjs/common';
import { api, createTestApp, seedFixture, type Fixture } from './setup/test-app';

describe('Warehouses, catalogue & replenishment (e2e)', () => {
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
    get: (path: string) => api(app).get(path).set('Authorization', `Bearer ${token}`),
    post: (path: string) => api(app).post(path).set('Authorization', `Bearer ${token}`),
    patch: (path: string) => api(app).patch(path).set('Authorization', `Bearer ${token}`),
    put: (path: string) => api(app).put(path).set('Authorization', `Bearer ${token}`),
    delete: (path: string) =>
      api(app).delete(path).set('Authorization', `Bearer ${token}`),
  });

  describe('warehouses', () => {
    it('creates, reads and updates a warehouse', async () => {
      const created = await as(fixture.admin.token)
        .post('/api/v1/warehouses')
        .send({ name: 'Delta Depot', code: 'delta', city: 'Pune' })
        .expect(201);

      // Codes are normalised to uppercase so `delta` and `DELTA` cannot coexist.
      expect(created.body.code).toBe('DELTA');

      const updated = await as(fixture.admin.token)
        .patch(`/api/v1/warehouses/${created.body.id}`)
        .send({ name: 'Delta Distribution Centre' })
        .expect(200);

      expect(updated.body.name).toBe('Delta Distribution Centre');
      expect(updated.body.code).toBe('DELTA');
    });

    it('rejects a duplicate warehouse code with 409', async () => {
      await as(fixture.admin.token)
        .post('/api/v1/warehouses')
        .send({ name: 'Duplicate', code: 'ALPHA' })
        .expect(409);
    });

    it('hard-deletes an empty warehouse', async () => {
      const response = await as(fixture.admin.token)
        .delete(`/api/v1/warehouses/${fixture.warehouseB}`)
        .expect(200);

      expect(response.body).toMatchObject({ deleted: true, archived: false });
      await as(fixture.admin.token)
        .get(`/api/v1/warehouses/${fixture.warehouseB}`)
        .expect(404);
    });

    it('archives rather than deletes a warehouse that holds stock history', async () => {
      // warehouseA received opening stock in the fixture.
      const response = await as(fixture.admin.token)
        .delete(`/api/v1/warehouses/${fixture.warehouseA}`)
        .expect(200);

      expect(response.body).toMatchObject({ deleted: false, archived: true });
      expect(response.body.message).toContain('archived');

      const stillThere = await as(fixture.admin.token)
        .get(`/api/v1/warehouses/${fixture.warehouseA}`)
        .expect(200);

      expect(stillThere.body.isActive).toBe(false);

      // The ledger survived, which is the whole point of archiving.
      const movements = await as(fixture.admin.token)
        .get(`/api/v1/stock/movements?warehouseId=${fixture.warehouseA}`)
        .expect(200);

      expect(movements.body.meta.totalItems).toBeGreaterThan(0);
    });

    it('reports stock statistics alongside each warehouse', async () => {
      const response = await as(fixture.admin.token)
        .get('/api/v1/warehouses')
        .expect(200);

      const alpha = response.body.items.find(
        (warehouse: { id: string }) => warehouse.id === fixture.warehouseA,
      );

      expect(alpha.stats).toMatchObject({ productCount: 1, totalUnits: 500 });
    });
  });

  describe('products', () => {
    it('normalises the SKU and rejects duplicates', async () => {
      const created = await as(fixture.manager.token)
        .post('/api/v1/products')
        .send({ name: 'Lower Widget', sku: 'lower-01', unitPrice: 12.34 })
        .expect(201);

      expect(created.body.sku).toBe('LOWER-01');
      expect(created.body.unitPrice).toBe('12.34');

      await as(fixture.manager.token)
        .post('/api/v1/products')
        .send({ name: 'Clash', sku: 'LOWER-01', unitPrice: 1 })
        .expect(409);
    });

    it('rejects a price with more than two decimal places', async () => {
      const response = await as(fixture.manager.token)
        .post('/api/v1/products')
        .send({ name: 'Odd Price', sku: 'ODD-01', unitPrice: 1.005 })
        .expect(422);

      expect(response.body.details[0].path).toBe('unitPrice');
    });

    it('paginates, searches and sorts', async () => {
      for (let index = 0; index < 12; index += 1) {
        await as(fixture.manager.token)
          .post('/api/v1/products')
          .send({
            name: `Bulk Item ${index}`,
            sku: `BULK-${String(index).padStart(2, '0')}`,
            unitPrice: 10 + index,
          })
          .expect(201);
      }

      const page = await as(fixture.manager.token)
        .get('/api/v1/products?page=2&pageSize=5&sortBy=sku&sortDir=asc')
        .expect(200);

      expect(page.body.items).toHaveLength(5);
      expect(page.body.meta).toMatchObject({
        page: 2,
        pageSize: 5,
        totalItems: 13,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true,
      });

      const search = await as(fixture.manager.token)
        .get('/api/v1/products?search=BULK-07')
        .expect(200);

      expect(search.body.meta.totalItems).toBe(1);
      expect(search.body.items[0].sku).toBe('BULK-07');
    });

    it('caps an oversized page size instead of honouring it', async () => {
      const response = await as(fixture.manager.token)
        .get('/api/v1/products?pageSize=100000')
        .expect(422);

      expect(response.body.details[0].path).toBe('pageSize');
    });

    it('archives a product that has movement history', async () => {
      const response = await as(fixture.manager.token)
        .delete(`/api/v1/products/${fixture.productId}`)
        .expect(200);

      expect(response.body).toMatchObject({ deleted: false, archived: true });
    });

    it('hard-deletes a product that has never moved', async () => {
      const created = await as(fixture.manager.token)
        .post('/api/v1/products')
        .send({ name: 'Never Used', sku: 'NEVER-01', unitPrice: 1 })
        .expect(201);

      const response = await as(fixture.manager.token)
        .delete(`/api/v1/products/${created.body.id}`)
        .expect(200);

      expect(response.body).toMatchObject({ deleted: true, archived: false });
    });
  });

  describe('categories and suppliers', () => {
    it('refuses to delete a category that still has products', async () => {
      const response = await as(fixture.manager.token)
        .delete(`/api/v1/categories/${fixture.categoryId}`)
        .expect(409);

      expect(response.body.message).toContain('1 product');
    });

    it('deletes a category once nothing references it', async () => {
      const spare = await as(fixture.manager.token)
        .post('/api/v1/categories')
        .send({ name: 'Spare Category' })
        .expect(201);

      await as(fixture.manager.token)
        .delete(`/api/v1/categories/${spare.body.id}`)
        .expect(204);
    });

    it('validates a supplier email', async () => {
      await as(fixture.manager.token)
        .post('/api/v1/suppliers')
        .send({ name: 'Bad Email Ltd', email: 'not-an-email' })
        .expect(422);
    });
  });

  describe('replenishment rules', () => {
    it('flags a product once stock falls to the threshold', async () => {
      await as(fixture.manager.token)
        .put('/api/v1/stock/replenishment-rules')
        .send({
          productId: fixture.productId,
          warehouseId: fixture.warehouseA,
          reorderPoint: 100,
          reorderQuantity: 250,
        })
        .expect(200);

      // 500 on hand, threshold 100 — nothing to flag yet.
      const before = await as(fixture.manager.token)
        .get('/api/v1/stock/low-stock')
        .expect(200);
      expect(before.body).toHaveLength(0);

      await as(fixture.manager.token)
        .post('/api/v1/stock/adjustments')
        .send({
          productId: fixture.productId,
          warehouseId: fixture.warehouseA,
          delta: -420,
          reason: 'Damaged in flood',
        })
        .expect(201);

      const after = await as(fixture.manager.token)
        .get('/api/v1/stock/low-stock')
        .expect(200);

      expect(after.body).toHaveLength(1);
      expect(after.body[0]).toMatchObject({
        sku: fixture.productSku,
        quantity: 80,
        reorderPoint: 100,
        shortfall: 20,
        suggestedOrderQuantity: 250,
      });
    });

    it('exposes the flag on the product view too', async () => {
      await as(fixture.manager.token)
        .put('/api/v1/stock/replenishment-rules')
        .send({
          productId: fixture.productId,
          warehouseId: fixture.warehouseA,
          reorderPoint: 600,
          reorderQuantity: 100,
        })
        .expect(200);

      const product = await as(fixture.manager.token)
        .get(`/api/v1/products/${fixture.productId}`)
        .expect(200);

      expect(product.body.isBelowThreshold).toBe(true);
      expect(product.body.stockByWarehouse[0].isBelowThreshold).toBe(true);
    });

    it('ignores a threshold of zero, which means "not tracked"', async () => {
      await as(fixture.manager.token)
        .put('/api/v1/stock/replenishment-rules')
        .send({
          productId: fixture.productId,
          warehouseId: fixture.warehouseA,
          reorderPoint: 0,
          reorderQuantity: 0,
        })
        .expect(200);

      const lowStock = await as(fixture.manager.token)
        .get('/api/v1/stock/low-stock')
        .expect(200);

      expect(lowStock.body).toHaveLength(0);
    });
  });

  describe('dashboard', () => {
    it('summarises the organisation', async () => {
      const response = await as(fixture.admin.token)
        .get('/api/v1/reports/dashboard')
        .expect(200);

      expect(response.body).toMatchObject({
        warehouseCount: 2,
        productCount: 1,
        totalUnits: 500,
        // 500 units × 100.50
        inventoryValue: '50250.00',
      });
      expect(response.body.movementTrend).toHaveLength(14);
      expect(response.body.recentMovements.length).toBeGreaterThan(0);
    });

    it('scopes the summary to a staff member’s warehouses', async () => {
      const response = await as(fixture.staff.token)
        .get('/api/v1/reports/dashboard')
        .expect(200);

      expect(response.body.warehouseCount).toBe(1);
    });
  });

  describe('health', () => {
    it('answers the liveness probe without authentication', async () => {
      const response = await api(app).get('/health').expect(200);
      expect(response.body.status).toBe('ok');
    });

    it('reports dependency status on the readiness probe', async () => {
      const response = await api(app).get('/health/ready').expect(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.info.database.status).toBe('up');
    });
  });
});
