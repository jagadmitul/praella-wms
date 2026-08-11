import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateWarehouseInput,
  Paginated,
  UpdateWarehouseInput,
  WarehouseQuery,
  WarehouseView,
} from '@wms/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { AuditService } from '../common/services/audit.service';
import {
  buildOrderBy,
  paginate,
  toPrismaPage,
} from '../common/utils/pagination.util';
import {
  assertWarehouseAccess,
  warehouseScopeFilter,
} from '../common/utils/warehouse-scope.util';
import type { OrgContext } from '../common/types/request-context';
import type { Prisma } from '../generated/prisma/client';

const SORTABLE_FIELDS = ['name', 'code', 'createdAt', 'updatedAt'] as const;

/** Outcome of a delete request, which may archive instead of removing. */
export interface WarehouseDeletionResult {
  deleted: boolean;
  archived: boolean;
  message: string;
}

@Injectable()
export class WarehousesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Lists warehouses visible to the caller, with per-warehouse stock stats.
   *
   * @param orgContext - Resolved organisation context.
   * @param query - Pagination, search and filter options.
   * @returns A page of warehouses.
   */
  async list(
    orgContext: OrgContext,
    query: WarehouseQuery,
  ): Promise<Paginated<WarehouseView>> {
    const where: Prisma.WarehouseWhereInput = {
      organizationId: orgContext.organizationId,
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
              { city: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const scope = warehouseScopeFilter(orgContext);
    if (scope) {
      where.id = scope;
    }

    const [rows, totalItems] = await Promise.all([
      this.prisma.warehouse.findMany({
        where,
        ...toPrismaPage(query),
        orderBy: buildOrderBy(
          query.sortBy,
          query.sortDir,
          SORTABLE_FIELDS,
          'name',
        ),
        include: {
          stockLevels: { select: { quantity: true, reorderPoint: true } },
        },
      }),
      this.prisma.warehouse.count({ where }),
    ]);

    return paginate(
      rows.map((row) => WarehousesService.toView(row)),
      totalItems,
      query,
    );
  }

  /**
   * Loads a single warehouse the caller is allowed to see.
   *
   * @param orgContext - Resolved organisation context.
   * @param id - Warehouse identifier.
   * @returns The warehouse.
   * @throws NotFoundException when it does not exist in this organisation.
   */
  async findOne(orgContext: OrgContext, id: string): Promise<WarehouseView> {
    assertWarehouseAccess(orgContext, id);

    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id, organizationId: orgContext.organizationId },
      include: {
        stockLevels: { select: { quantity: true, reorderPoint: true } },
      },
    });

    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }

    return WarehousesService.toView(warehouse);
  }

  /**
   * Creates a warehouse.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User performing the action.
   * @param input - Validated warehouse payload.
   * @returns The created warehouse.
   */
  async create(
    orgContext: OrgContext,
    actorId: string,
    input: CreateWarehouseInput,
  ): Promise<WarehouseView> {
    const warehouse = await this.prisma.warehouse.create({
      data: { ...input, organizationId: orgContext.organizationId },
      include: {
        stockLevels: { select: { quantity: true, reorderPoint: true } },
      },
    });

    await this.afterMutation(
      orgContext,
      actorId,
      'warehouse.created',
      warehouse.id,
      {
        code: warehouse.code,
        name: warehouse.name,
      },
    );

    return WarehousesService.toView(warehouse);
  }

  /**
   * Updates a warehouse.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User performing the action.
   * @param id - Warehouse identifier.
   * @param input - Fields to change.
   * @returns The updated warehouse.
   */
  async update(
    orgContext: OrgContext,
    actorId: string,
    id: string,
    input: UpdateWarehouseInput,
  ): Promise<WarehouseView> {
    await this.assertExists(orgContext, id);

    const warehouse = await this.prisma.warehouse.update({
      where: { id },
      data: input,
      include: {
        stockLevels: { select: { quantity: true, reorderPoint: true } },
      },
    });

    await this.afterMutation(orgContext, actorId, 'warehouse.updated', id, {
      changed: Object.keys(input),
    });

    return WarehousesService.toView(warehouse);
  }

  /**
   * Deletes a warehouse, or archives it when it carries history.
   *
   * A warehouse that has ever held stock is referenced by the immutable
   * movement ledger, so removing the row would either orphan or destroy audit
   * history. Archiving keeps the books intact while taking the site out of
   * circulation; only a genuinely unused warehouse is deleted outright.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User performing the action.
   * @param id - Warehouse identifier.
   * @returns Whether the row was deleted or archived, and why.
   */
  async remove(
    orgContext: OrgContext,
    actorId: string,
    id: string,
  ): Promise<WarehouseDeletionResult> {
    const warehouse = await this.assertExists(orgContext, id);

    const [movements, openOrders, stockOnHand] = await Promise.all([
      this.prisma.stockMovement.count({ where: { warehouseId: id } }),
      this.prisma.purchaseOrder.count({
        where: {
          warehouseId: id,
          status: { notIn: ['RECEIVED', 'CANCELLED'] },
        },
      }),
      this.prisma.stockLevel.aggregate({
        where: { warehouseId: id },
        _sum: { quantity: true },
      }),
    ]);

    const units = stockOnHand._sum.quantity ?? 0;

    if (movements === 0 && openOrders === 0 && units === 0) {
      await this.prisma.warehouse.delete({ where: { id } });
      await this.afterMutation(orgContext, actorId, 'warehouse.deleted', id, {
        code: warehouse.code,
      });

      return {
        deleted: true,
        archived: false,
        message: `Warehouse "${warehouse.name}" was permanently deleted.`,
      };
    }

    await this.prisma.warehouse.update({
      where: { id },
      data: { isActive: false },
    });
    await this.afterMutation(orgContext, actorId, 'warehouse.archived', id, {
      code: warehouse.code,
      movements,
      unitsOnHand: units,
    });

    return {
      deleted: false,
      archived: true,
      message: `Warehouse "${warehouse.name}" has ${movements} movement(s) of recorded history and ${units} unit(s) on hand, so it was archived rather than deleted. Its stock ledger is preserved.`,
    };
  }

  /**
   * Replaces the set of staff assigned to a warehouse.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User performing the action.
   * @param id - Warehouse identifier.
   * @param membershipIds - Memberships that should have access.
   */
  async assignMembers(
    orgContext: OrgContext,
    actorId: string,
    id: string,
    membershipIds: string[],
  ): Promise<{ assigned: number }> {
    await this.assertExists(orgContext, id);

    // Only memberships inside this organisation may be assigned, otherwise a
    // caller could hand a stranger access by guessing a membership id.
    const valid = await this.prisma.membership.findMany({
      where: {
        id: { in: membershipIds },
        organizationId: orgContext.organizationId,
      },
      select: { id: true },
    });

    await this.prisma.$transaction([
      this.prisma.warehouseMember.deleteMany({ where: { warehouseId: id } }),
      this.prisma.warehouseMember.createMany({
        data: valid.map((membership) => ({
          warehouseId: id,
          membershipId: membership.id,
        })),
        skipDuplicates: true,
      }),
    ]);

    await this.afterMutation(
      orgContext,
      actorId,
      'warehouse.members_assigned',
      id,
      {
        membershipIds: valid.map((membership) => membership.id),
      },
    );

    return { assigned: valid.length };
  }

  /** Confirms the warehouse exists in the caller's organisation and is in scope. */
  private async assertExists(
    orgContext: OrgContext,
    id: string,
  ): Promise<{ id: string; name: string; code: string }> {
    assertWarehouseAccess(orgContext, id);

    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id, organizationId: orgContext.organizationId },
      select: { id: true, name: true, code: true },
    });

    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }

    return warehouse;
  }

  /** Records the audit entry and drops the organisation's cached aggregates. */
  private async afterMutation(
    orgContext: OrgContext,
    actorId: string,
    action: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await Promise.all([
      this.auditService.record({
        organizationId: orgContext.organizationId,
        actorId,
        action,
        entityType: 'Warehouse',
        entityId,
        metadata: metadata as never,
      }),
      this.cacheService.invalidateOrganization(orgContext.organizationId),
    ]);
  }

  /** Maps a Prisma row plus its stock levels into the API view model. */
  private static toView(
    warehouse: Prisma.WarehouseGetPayload<{
      include: {
        stockLevels: { select: { quantity: true; reorderPoint: true } };
      };
    }>,
  ): WarehouseView {
    const levels = warehouse.stockLevels;

    return {
      id: warehouse.id,
      name: warehouse.name,
      code: warehouse.code,
      isActive: warehouse.isActive,
      addressLine1: warehouse.addressLine1,
      addressLine2: warehouse.addressLine2,
      city: warehouse.city,
      state: warehouse.state,
      country: warehouse.country,
      postalCode: warehouse.postalCode,
      notes: warehouse.notes,
      createdAt: warehouse.createdAt.toISOString(),
      updatedAt: warehouse.updatedAt.toISOString(),
      stats: {
        productCount: levels.length,
        totalUnits: levels.reduce((total, level) => total + level.quantity, 0),
        lowStockCount: levels.filter(
          (level) =>
            level.reorderPoint > 0 && level.quantity <= level.reorderPoint,
        ).length,
      },
    };
  }
}
