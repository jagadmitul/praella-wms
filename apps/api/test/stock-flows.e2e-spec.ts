import type { INestApplication } from '@nestjs/common';
import {
  api,
  createTestApp,
  seedFixture,
  type Fixture,
} from './setup/test-app';

describe('Stock movements, transfers & orders (e2e)', () => {
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
    put: (path: string) =>
      api(app).put(path).set('Authorization', `Bearer ${token}`),
  });

  /** Reads the on-hand and reserved quantity for a (product, warehouse) pair. */
  async function level(
    warehouseId: string,
    productId = fixture.productId,
  ): Promise<{
    quantity: number;
    reservedQuantity: number;
    availableQuantity: number;
  }> {
    const response = await as(fixture.manager.token)
      .get(
        `/api/v1/stock/levels?productId=${productId}&warehouseId=${warehouseId}`,
      )
      .expect(200);

    return (
      response.body.items[0] ?? {
        quantity: 0,
        reservedQuantity: 0,
        availableQuantity: 0,
      }
    );
  }

  describe('movements and adjustments', () => {
    it('increases stock on an inbound movement and records the ledger row', async () => {
      await as(fixture.manager.token)
        .post('/api/v1/stock/movements')
        .send({
          productId: fixture.productId,
          warehouseId: fixture.warehouseA,
          type: 'INBOUND',
          quantity: 25,
          unitCost: 60,
          note: 'Supplier top-up',
        })
        .expect(201);

      expect((await level(fixture.warehouseA)).quantity).toBe(525);

      const movements = await as(fixture.manager.token)
        .get('/api/v1/stock/movements?type=INBOUND')
        .expect(200);

      const latest = movements.body.items[0];
      expect(latest).toMatchObject({
        type: 'INBOUND',
        quantity: 25,
        balanceAfter: 525,
        note: 'Supplier top-up',
      });
      expect(latest.destinationWarehouse.id).toBe(fixture.warehouseA);
      expect(latest.createdBy.fullName).toBe('Fixture Manager');
    });

    it('refuses an outbound movement larger than the stock on hand', async () => {
      const response = await as(fixture.manager.token)
        .post('/api/v1/stock/movements')
        .send({
          productId: fixture.productId,
          warehouseId: fixture.warehouseA,
          type: 'OUTBOUND',
          quantity: 501,
        })
        .expect(409);

      expect(response.body.message).toContain('Insufficient stock');
      expect((await level(fixture.warehouseA)).quantity).toBe(500);
    });

    it('never lets concurrent dispatches drive stock negative', async () => {
      // Ten simultaneous requests for 100 units each against 500 on hand.
      // Row locking must let exactly five succeed.
      const attempts = Array.from({ length: 10 }, () =>
        as(fixture.manager.token).post('/api/v1/stock/movements').send({
          productId: fixture.productId,
          warehouseId: fixture.warehouseA,
          type: 'OUTBOUND',
          quantity: 100,
        }),
      );

      const results = await Promise.all(attempts);
      const succeeded = results.filter(
        (result) => result.status === 201,
      ).length;
      const rejected = results.filter((result) => result.status === 409).length;

      expect(succeeded).toBe(5);
      expect(rejected).toBe(5);
      expect((await level(fixture.warehouseA)).quantity).toBe(0);
    });

    it('requires a reason on a manual adjustment', async () => {
      await as(fixture.manager.token)
        .post('/api/v1/stock/adjustments')
        .send({
          productId: fixture.productId,
          warehouseId: fixture.warehouseA,
          delta: -5,
        })
        .expect(422);
    });

    it('rejects a zero-delta adjustment', async () => {
      await as(fixture.manager.token)
        .post('/api/v1/stock/adjustments')
        .send({
          productId: fixture.productId,
          warehouseId: fixture.warehouseA,
          delta: 0,
          reason: 'Nothing happened',
        })
        .expect(422);
    });

    it('reconciles the ledger with the stock level', async () => {
      await as(fixture.manager.token)
        .post('/api/v1/stock/movements')
        .send({
          productId: fixture.productId,
          warehouseId: fixture.warehouseA,
          type: 'OUTBOUND',
          quantity: 120,
        })
        .expect(201);

      await as(fixture.manager.token)
        .post('/api/v1/stock/adjustments')
        .send({
          productId: fixture.productId,
          warehouseId: fixture.warehouseA,
          delta: -30,
          reason: 'Breakage',
        })
        .expect(201);

      const movements = await as(fixture.manager.token)
        .get(
          `/api/v1/stock/movements?warehouseId=${fixture.warehouseA}&pageSize=100`,
        )
        .expect(200);

      const net = movements.body.items.reduce(
        (total: number, movement: { type: string; quantity: number }) =>
          total +
          (['INBOUND', 'TRANSFER_IN'].includes(movement.type)
            ? movement.quantity
            : -movement.quantity),
        0,
      );

      expect(net).toBe((await level(fixture.warehouseA)).quantity);
      expect(net).toBe(350);
    });
  });

  describe('transfers between warehouses', () => {
    it('moves stock through dispatch and receipt, holding it in transit between', async () => {
      const transfer = await as(fixture.manager.token)
        .post('/api/v1/transfers')
        .send({
          sourceWarehouseId: fixture.warehouseA,
          destinationWarehouseId: fixture.warehouseB,
          items: [{ productId: fixture.productId, quantity: 120 }],
        })
        .expect(201);

      expect(transfer.body.status).toBe('DRAFT');
      expect(transfer.body.code).toMatch(/^TRF-\d{6}$/);

      await as(fixture.manager.token)
        .post(`/api/v1/transfers/${transfer.body.id}/dispatch`)
        .expect(201);

      // Goods have left the source but not yet arrived — correctly absent from both.
      expect((await level(fixture.warehouseA)).quantity).toBe(380);
      expect((await level(fixture.warehouseB)).quantity).toBe(0);

      const received = await as(fixture.manager.token)
        .post(`/api/v1/transfers/${transfer.body.id}/receive`)
        .expect(201);

      expect(received.body.status).toBe('COMPLETED');
      expect((await level(fixture.warehouseB)).quantity).toBe(120);
    });

    it('returns in-transit stock to the source when a transfer is cancelled', async () => {
      const transfer = await as(fixture.manager.token)
        .post('/api/v1/transfers')
        .send({
          sourceWarehouseId: fixture.warehouseA,
          destinationWarehouseId: fixture.warehouseB,
          items: [{ productId: fixture.productId, quantity: 90 }],
        })
        .expect(201);

      await as(fixture.manager.token)
        .post(`/api/v1/transfers/${transfer.body.id}/dispatch`)
        .expect(201);
      expect((await level(fixture.warehouseA)).quantity).toBe(410);

      await as(fixture.manager.token)
        .post(`/api/v1/transfers/${transfer.body.id}/cancel`)
        .expect(201);

      expect((await level(fixture.warehouseA)).quantity).toBe(500);
      expect((await level(fixture.warehouseB)).quantity).toBe(0);
    });

    it('rejects a transfer to the same warehouse', async () => {
      await as(fixture.manager.token)
        .post('/api/v1/transfers')
        .send({
          sourceWarehouseId: fixture.warehouseA,
          destinationWarehouseId: fixture.warehouseA,
          items: [{ productId: fixture.productId, quantity: 1 }],
        })
        .expect(422);
    });

    it('refuses to receive a transfer that has not been dispatched', async () => {
      const transfer = await as(fixture.manager.token)
        .post('/api/v1/transfers')
        .send({
          sourceWarehouseId: fixture.warehouseA,
          destinationWarehouseId: fixture.warehouseB,
          items: [{ productId: fixture.productId, quantity: 5 }],
        })
        .expect(201);

      const response = await as(fixture.manager.token)
        .post(`/api/v1/transfers/${transfer.body.id}/receive`)
        .expect(409);

      expect(response.body.message).toContain('DRAFT');
    });
  });

  describe('purchase orders', () => {
    async function createOrder(quantity = 200) {
      return as(fixture.manager.token)
        .post('/api/v1/purchase-orders')
        .send({
          supplierId: fixture.supplierId,
          warehouseId: fixture.warehouseA,
          items: [{ productId: fixture.productId, quantity, unitCost: 62.5 }],
        })
        .expect(201);
    }

    it('does not change stock until goods are received', async () => {
      const order = await createOrder();

      expect(order.body.status).toBe('DRAFT');
      expect(order.body.totalAmount).toBe('12500.00');
      expect((await level(fixture.warehouseA)).quantity).toBe(500);

      await as(fixture.manager.token)
        .post(`/api/v1/purchase-orders/${order.body.id}/submit`)
        .expect(201);

      const received = await as(fixture.manager.token)
        .post(`/api/v1/purchase-orders/${order.body.id}/receive`)
        .send({})
        .expect(201);

      expect(received.body.status).toBe('RECEIVED');
      expect((await level(fixture.warehouseA)).quantity).toBe(700);
    });

    it('supports partial receipt', async () => {
      const order = await createOrder();
      await as(fixture.manager.token)
        .post(`/api/v1/purchase-orders/${order.body.id}/submit`)
        .expect(201);

      const partial = await as(fixture.manager.token)
        .post(`/api/v1/purchase-orders/${order.body.id}/receive`)
        .send({
          items: [
            { purchaseOrderItemId: order.body.items[0].id, quantity: 80 },
          ],
        })
        .expect(201);

      expect(partial.body.status).toBe('PARTIALLY_RECEIVED');
      expect(partial.body.items[0].outstandingQuantity).toBe(120);
      expect((await level(fixture.warehouseA)).quantity).toBe(580);

      const rest = await as(fixture.manager.token)
        .post(`/api/v1/purchase-orders/${order.body.id}/receive`)
        .send({})
        .expect(201);

      expect(rest.body.status).toBe('RECEIVED');
      expect((await level(fixture.warehouseA)).quantity).toBe(700);
    });

    it('rejects over-receipt', async () => {
      const order = await createOrder();
      await as(fixture.manager.token)
        .post(`/api/v1/purchase-orders/${order.body.id}/submit`)
        .expect(201);

      const response = await as(fixture.manager.token)
        .post(`/api/v1/purchase-orders/${order.body.id}/receive`)
        .send({
          items: [
            { purchaseOrderItemId: order.body.items[0].id, quantity: 500 },
          ],
        })
        .expect(409);

      expect(response.body.message).toContain('only 200 outstanding');
    });

    it('refuses to receive a draft order', async () => {
      const order = await createOrder();

      await as(fixture.manager.token)
        .post(`/api/v1/purchase-orders/${order.body.id}/receive`)
        .send({})
        .expect(409);
    });

    it('mints sequential document codes', async () => {
      const first = await createOrder();
      const second = await createOrder();

      expect(first.body.code).toBe('PO-000001');
      expect(second.body.code).toBe('PO-000002');
    });
  });

  describe('sales orders', () => {
    async function createOrder(quantity = 150) {
      return as(fixture.manager.token)
        .post('/api/v1/sales-orders')
        .send({
          warehouseId: fixture.warehouseA,
          customerName: 'Beta Retail',
          customerEmail: 'buyer@beta.example',
          items: [
            { productId: fixture.productId, quantity, unitPrice: 199.99 },
          ],
        })
        .expect(201);
    }

    it('reserves on allocation and ships on fulfilment', async () => {
      const order = await createOrder();
      expect(order.body.totalAmount).toBe('29998.50');

      await as(fixture.manager.token)
        .post(`/api/v1/sales-orders/${order.body.id}/allocate`)
        .expect(201);

      // Allocation reserves without moving: on hand unchanged, available reduced.
      expect(await level(fixture.warehouseA)).toMatchObject({
        quantity: 500,
        reservedQuantity: 150,
        availableQuantity: 350,
      });

      const fulfilled = await as(fixture.manager.token)
        .post(`/api/v1/sales-orders/${order.body.id}/fulfill`)
        .send({})
        .expect(201);

      expect(fulfilled.body.status).toBe('FULFILLED');
      expect(await level(fixture.warehouseA)).toMatchObject({
        quantity: 350,
        reservedQuantity: 0,
      });
    });

    it('stops a second order promising stock the first has reserved', async () => {
      const first = await createOrder(400);
      await as(fixture.manager.token)
        .post(`/api/v1/sales-orders/${first.body.id}/allocate`)
        .expect(201);

      const second = await createOrder(200);
      const response = await as(fixture.manager.token)
        .post(`/api/v1/sales-orders/${second.body.id}/allocate`)
        .expect(409);

      expect(response.body.message).toContain('only 100 available');
    });

    it('protects reserved stock from an unrelated manual dispatch', async () => {
      const order = await createOrder(450);
      await as(fixture.manager.token)
        .post(`/api/v1/sales-orders/${order.body.id}/allocate`)
        .expect(201);

      // 500 on hand but 450 spoken for — only 50 may leave by other means.
      const response = await as(fixture.manager.token)
        .post('/api/v1/stock/movements')
        .send({
          productId: fixture.productId,
          warehouseId: fixture.warehouseA,
          type: 'OUTBOUND',
          quantity: 100,
        })
        .expect(409);

      expect(response.body.message).toContain('reserved for open orders');
    });

    it('releases the reservation when an order is cancelled', async () => {
      const order = await createOrder(300);
      await as(fixture.manager.token)
        .post(`/api/v1/sales-orders/${order.body.id}/allocate`)
        .expect(201);
      expect((await level(fixture.warehouseA)).reservedQuantity).toBe(300);

      await as(fixture.manager.token)
        .post(`/api/v1/sales-orders/${order.body.id}/cancel`)
        .expect(201);

      expect(await level(fixture.warehouseA)).toMatchObject({
        quantity: 500,
        reservedQuantity: 0,
      });
    });

    it('supports partial fulfilment', async () => {
      const order = await createOrder(200);
      await as(fixture.manager.token)
        .post(`/api/v1/sales-orders/${order.body.id}/allocate`)
        .expect(201);

      const partial = await as(fixture.manager.token)
        .post(`/api/v1/sales-orders/${order.body.id}/fulfill`)
        .send({
          items: [{ salesOrderItemId: order.body.items[0].id, quantity: 75 }],
        })
        .expect(201);

      expect(partial.body.status).toBe('PARTIALLY_FULFILLED');
      expect(await level(fixture.warehouseA)).toMatchObject({
        quantity: 425,
        reservedQuantity: 125,
      });
    });

    it('refuses to fulfil an order that was never allocated', async () => {
      const order = await createOrder();

      await as(fixture.manager.token)
        .post(`/api/v1/sales-orders/${order.body.id}/fulfill`)
        .send({})
        .expect(409);
    });

    it('links fulfilment movements back to the order', async () => {
      const order = await createOrder(40);
      await as(fixture.manager.token)
        .post(`/api/v1/sales-orders/${order.body.id}/allocate`)
        .expect(201);
      await as(fixture.manager.token)
        .post(`/api/v1/sales-orders/${order.body.id}/fulfill`)
        .send({})
        .expect(201);

      const movements = await as(fixture.manager.token)
        .get('/api/v1/stock/movements?type=OUTBOUND')
        .expect(200);

      expect(movements.body.items[0]).toMatchObject({
        referenceType: 'SALES_ORDER',
        referenceCode: order.body.code,
        quantity: 40,
      });
    });
  });
});
