import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { StockLedgerService } from './stock-ledger.service';

/**
 * Unit coverage for the ledger's guard rails.
 *
 * The happy paths are covered end-to-end against a real database, where the row
 * locking actually means something. What is worth isolating here is the
 * arithmetic and the refusals — the cases where the service must reject a write
 * rather than perform it.
 */
describe('StockLedgerService', () => {
  let service: StockLedgerService;

  /** A minimal transaction-client stand-in recording what the service did. */
  function createTx(level: { quantity: number; reservedQuantity: number }) {
    const updates: Array<Record<string, unknown>> = [];
    const movements: Array<Record<string, unknown>> = [];

    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'level-1', ...level }]),
      stockLevel: {
        update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return Promise.resolve({ id: 'level-1', ...data });
        }),
        upsert: jest.fn(),
      },
      stockMovement: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          movements.push(data);
          return Promise.resolve(data);
        }),
      },
      product: { findFirst: jest.fn() },
    };

    return {
      tx: tx as unknown as Prisma.TransactionClient,
      updates,
      movements,
    };
  }

  const base = {
    organizationId: 'org-1',
    productId: 'product-1',
    warehouseId: 'warehouse-1',
    actorId: 'user-1',
    referenceType: 'MANUAL_ADJUSTMENT' as const,
  };

  beforeEach(() => {
    service = new StockLedgerService();
  });

  describe('direction validation', () => {
    it('rejects an INBOUND movement with a negative delta', async () => {
      const { tx } = createTx({ quantity: 100, reservedQuantity: 0 });

      await expect(
        service.applyMovement(tx, { ...base, type: 'INBOUND', delta: -5 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an OUTBOUND movement with a positive delta', async () => {
      const { tx } = createTx({ quantity: 100, reservedQuantity: 0 });

      await expect(
        service.applyMovement(tx, { ...base, type: 'OUTBOUND', delta: 5 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows an ADJUSTMENT in either direction', async () => {
      const { tx, updates } = createTx({ quantity: 100, reservedQuantity: 0 });

      await service.applyMovement(tx, {
        ...base,
        type: 'ADJUSTMENT',
        delta: -12,
      });
      expect(updates[0]).toMatchObject({ quantity: 88 });

      const positive = createTx({ quantity: 100, reservedQuantity: 0 });
      await service.applyMovement(positive.tx, {
        ...base,
        type: 'ADJUSTMENT',
        delta: 12,
      });
      expect(positive.updates[0]).toMatchObject({ quantity: 112 });
    });

    it('rejects a movement that changes nothing', async () => {
      const { tx } = createTx({ quantity: 100, reservedQuantity: 0 });

      await expect(
        service.applyMovement(tx, { ...base, type: 'ADJUSTMENT', delta: 0 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('stock floors', () => {
    it('refuses to drive stock negative', async () => {
      const { tx } = createTx({ quantity: 10, reservedQuantity: 0 });

      await expect(
        service.applyMovement(tx, { ...base, type: 'OUTBOUND', delta: -11 }),
      ).rejects.toThrow(ConflictException);
    });

    it('allows a movement that lands exactly on zero', async () => {
      const { tx, updates } = createTx({ quantity: 10, reservedQuantity: 0 });

      await service.applyMovement(tx, {
        ...base,
        type: 'OUTBOUND',
        delta: -10,
      });

      expect(updates[0]).toMatchObject({ quantity: 0 });
    });

    it('protects stock reserved by open sales orders', async () => {
      const { tx } = createTx({ quantity: 100, reservedQuantity: 90 });

      // 100 on hand, 90 promised — only 10 may leave by other means.
      await expect(
        service.applyMovement(tx, { ...base, type: 'OUTBOUND', delta: -20 }),
      ).rejects.toThrow(/reserved for open orders/);
    });

    it('lets an order consume its own reservation', async () => {
      const { tx, updates } = createTx({ quantity: 100, reservedQuantity: 90 });

      await service.applyMovement(tx, {
        ...base,
        type: 'OUTBOUND',
        delta: -20,
        reservedDelta: -20,
        respectReservations: false,
        referenceType: 'SALES_ORDER',
      });

      expect(updates[0]).toMatchObject({ quantity: 80, reservedQuantity: 70 });
    });

    it('refuses to release more than is reserved', async () => {
      const { tx } = createTx({ quantity: 100, reservedQuantity: 5 });

      await expect(
        service.applyMovement(tx, {
          ...base,
          type: 'OUTBOUND',
          delta: -10,
          reservedDelta: -10,
          respectReservations: false,
        }),
      ).rejects.toThrow(/more stock than is reserved/);
    });
  });

  describe('ledger rows', () => {
    it('stores an absolute quantity with the direction carried by the type', async () => {
      const { tx, movements } = createTx({
        quantity: 100,
        reservedQuantity: 0,
      });

      await service.applyMovement(tx, {
        ...base,
        type: 'OUTBOUND',
        delta: -30,
        note: 'Counter sale',
      });

      expect(movements[0]).toMatchObject({
        type: 'OUTBOUND',
        quantity: 30,
        balanceAfter: 70,
        note: 'Counter sale',
      });
    });

    it('records the counterpart warehouse on a transfer leg', async () => {
      const { tx, movements } = createTx({
        quantity: 100,
        reservedQuantity: 0,
      });

      await service.applyMovement(tx, {
        ...base,
        type: 'TRANSFER_OUT',
        delta: -25,
        counterpartWarehouseId: 'warehouse-2',
        referenceType: 'STOCK_TRANSFER',
        referenceCode: 'TRF-000001',
      });

      expect(movements[0]).toMatchObject({
        warehouseId: 'warehouse-1',
        counterpartWarehouseId: 'warehouse-2',
        referenceCode: 'TRF-000001',
      });
    });
  });

  describe('reservations', () => {
    it('refuses to reserve more than is available', async () => {
      const { tx } = createTx({ quantity: 100, reservedQuantity: 80 });

      await expect(
        service.adjustReservation(tx, { ...base, reservedDelta: 30 }),
      ).rejects.toThrow(/only 20 available/);
    });

    it('reserves up to the available quantity', async () => {
      const { tx, updates } = createTx({ quantity: 100, reservedQuantity: 80 });

      await service.adjustReservation(tx, { ...base, reservedDelta: 20 });

      expect(updates[0]).toMatchObject({ reservedQuantity: 100 });
    });

    it('writes no ledger row, because reserving moves no goods', async () => {
      const { tx, movements } = createTx({
        quantity: 100,
        reservedQuantity: 0,
      });

      await service.adjustReservation(tx, { ...base, reservedDelta: 10 });

      expect(movements).toHaveLength(0);
    });
  });
});
