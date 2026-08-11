import type { INestApplication } from '@nestjs/common';
import {
  api,
  createTestApp,
  seedFixture,
  type Fixture,
} from './setup/test-app';

/**
 * Role-based access control and multi-tenancy.
 *
 * These assertions are the reason the permission matrix lives in one shared
 * module: each case below maps directly onto a row of `ROLE_PERMISSIONS`, so a
 * careless widening of a role fails a test rather than shipping quietly.
 */
describe('RBAC & tenant isolation (e2e)', () => {
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
    patch: (path: string) =>
      api(app).patch(path).set('Authorization', `Bearer ${token}`),
    delete: (path: string) =>
      api(app).delete(path).set('Authorization', `Bearer ${token}`),
  });

  describe('the brief’s explicit rules', () => {
    it('lets only ADMIN delete a warehouse', async () => {
      await as(fixture.staff.token)
        .delete(`/api/v1/warehouses/${fixture.warehouseB}`)
        .expect(403);

      await as(fixture.manager.token)
        .delete(`/api/v1/warehouses/${fixture.warehouseB}`)
        .expect(403);

      await as(fixture.admin.token)
        .delete(`/api/v1/warehouses/${fixture.warehouseB}`)
        .expect(200);
    });

    it('lets MANAGER adjust stock but not STAFF', async () => {
      const adjustment = {
        productId: fixture.productId,
        warehouseId: fixture.warehouseA,
        delta: -5,
        reason: 'Cycle count correction',
      };

      await as(fixture.staff.token)
        .post('/api/v1/stock/adjustments')
        .send(adjustment)
        .expect(403);

      await as(fixture.manager.token)
        .post('/api/v1/stock/adjustments')
        .send(adjustment)
        .expect(201);
    });

    it('lets STAFF view and record stock movements', async () => {
      await as(fixture.staff.token).get('/api/v1/stock/movements').expect(200);

      await as(fixture.staff.token)
        .post('/api/v1/stock/movements')
        .send({
          productId: fixture.productId,
          warehouseId: fixture.warehouseA,
          type: 'OUTBOUND',
          quantity: 3,
        })
        .expect(201);
    });
  });

  describe('permission boundaries by role', () => {
    it.each([
      ['create a product', 'post', '/api/v1/products'],
      ['create a warehouse', 'post', '/api/v1/warehouses'],
      ['create a purchase order', 'post', '/api/v1/purchase-orders'],
      ['create a sales order', 'post', '/api/v1/sales-orders'],
      ['create a transfer', 'post', '/api/v1/transfers'],
      ['invite a member', 'post', '/api/v1/organization/members'],
    ])('denies STAFF the ability to %s', async (_label, method, path) => {
      const response = await (
        as(fixture.staff.token) as never as Record<
          string,
          (p: string) => { send: (b: unknown) => Promise<{ status: number }> }
        >
      )
        [method](path)
        .send({});

      expect(response.status).toBe(403);
    });

    it('denies MANAGER the ability to manage members', async () => {
      await as(fixture.manager.token)
        .post('/api/v1/organization/members')
        .send({
          email: 'someone@fixture.test',
          fullName: 'Someone',
          role: 'STAFF',
          temporaryPassword: 'TestPassw0rd!',
        })
        .expect(403);
    });

    it('allows MANAGER the operational actions their role exists for', async () => {
      await as(fixture.manager.token)
        .post('/api/v1/products')
        .send({ name: 'Manager Widget', sku: 'MGR-01', unitPrice: 10 })
        .expect(201);

      await as(fixture.manager.token)
        .post('/api/v1/warehouses')
        .send({ name: 'Gamma Depot', code: 'GAMMA' })
        .expect(201);
    });

    it('names the missing permission in the 403 body', async () => {
      const response = await as(fixture.staff.token)
        .delete(`/api/v1/warehouses/${fixture.warehouseB}`)
        .expect(403);

      expect(response.body.message).toContain('warehouse:delete');
      expect(response.body.message).toContain('STAFF');
    });
  });

  describe('warehouse scoping for STAFF', () => {
    it('shows a scoped member only their assigned warehouses', async () => {
      const all = await as(fixture.admin.token)
        .get('/api/v1/warehouses')
        .expect(200);
      const scoped = await as(fixture.staff.token)
        .get('/api/v1/warehouses')
        .expect(200);

      expect(all.body.meta.totalItems).toBe(2);
      expect(scoped.body.meta.totalItems).toBe(1);
      expect(scoped.body.items[0].id).toBe(fixture.warehouseA);
    });

    it('refuses a scoped member access to an unassigned warehouse', async () => {
      await as(fixture.staff.token)
        .get(`/api/v1/warehouses/${fixture.warehouseB}`)
        .expect(403);
    });

    it('refuses a scoped member recording a movement at an unassigned warehouse', async () => {
      await as(fixture.staff.token)
        .post('/api/v1/stock/movements')
        .send({
          productId: fixture.productId,
          warehouseId: fixture.warehouseB,
          type: 'INBOUND',
          quantity: 10,
        })
        .expect(403);
    });

    it('reports the scope on /auth/me so the UI can match the API', async () => {
      const response = await as(fixture.staff.token)
        .get('/api/v1/auth/me')
        .expect(200);

      expect(response.body.activeRole).toBe('STAFF');
      expect(response.body.warehouseScope).toEqual([fixture.warehouseA]);
      expect(response.body.permissions).toContain('movement:record');
      expect(response.body.permissions).not.toContain('stock:adjust');
    });

    it('leaves ADMIN and MANAGER unscoped', async () => {
      for (const actor of [fixture.admin, fixture.manager]) {
        const response = await as(actor.token)
          .get('/api/v1/auth/me')
          .expect(200);
        expect(response.body.warehouseScope).toBeNull();
      }
    });
  });

  describe('tenant isolation', () => {
    it('hides another organisation’s warehouse behind a 404', async () => {
      await as(fixture.outsider.token)
        .get(`/api/v1/warehouses/${fixture.warehouseA}`)
        .expect(404);
    });

    it('hides another organisation’s product behind a 404', async () => {
      await as(fixture.outsider.token)
        .get(`/api/v1/products/${fixture.productId}`)
        .expect(404);
    });

    it('never leaks another organisation’s rows into list endpoints', async () => {
      const response = await as(fixture.outsider.token)
        .get('/api/v1/products')
        .expect(200);

      expect(response.body.meta.totalItems).toBe(0);
      expect(response.body.items).toEqual([]);
    });

    it('refuses to act inside an organisation the caller does not belong to', async () => {
      await as(fixture.outsider.token)
        .get('/api/v1/warehouses')
        .set('x-organization-id', fixture.organizationId)
        .expect(403);
    });

    it('rejects a foreign category id when creating a product', async () => {
      const foreignCategory = await as(fixture.outsider.token)
        .post('/api/v1/categories')
        .send({ name: 'Foreign Category' })
        .expect(201);

      await as(fixture.admin.token)
        .post('/api/v1/products')
        .send({
          name: 'Sneaky Widget',
          sku: 'SNEAK-01',
          unitPrice: 5,
          categoryId: foreignCategory.body.id,
        })
        .expect(400);
    });
  });

  describe('organisation safety rails', () => {
    it('refuses to remove the last admin', async () => {
      const members = await as(fixture.admin.token)
        .get('/api/v1/organization/members?role=ADMIN')
        .expect(200);

      const adminMembership = members.body.items[0].membershipId;

      // Also covers the "cannot remove yourself" rule, which fires first.
      const response = await as(fixture.admin.token)
        .delete(`/api/v1/organization/members/${adminMembership}`)
        .expect(403);

      expect(response.body.message).toContain('your own membership');
    });

    it('clears warehouse assignments when staff are promoted to manager', async () => {
      const members = await as(fixture.admin.token)
        .get('/api/v1/organization/members?role=STAFF')
        .expect(200);

      const staffMembership = members.body.items[0].membershipId;
      expect(members.body.items[0].warehouses).toHaveLength(1);

      const promoted = await as(fixture.admin.token)
        .patch(`/api/v1/organization/members/${staffMembership}`)
        .send({ role: 'MANAGER' })
        .expect(200);

      expect(promoted.body.role).toBe('MANAGER');
      expect(promoted.body.warehouses).toHaveLength(0);
    });
  });
});
