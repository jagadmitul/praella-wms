import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  BulkResult,
  BulkUpdateProductsInput,
  CreateProductInput,
  Paginated,
  ProductQuery,
  ProductView,
  UpdateProductInput,
} from '@wms/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { AuditService } from '../common/services/audit.service';
import {
  buildOrderBy,
  paginate,
  toPrismaPage,
} from '../common/utils/pagination.util';
import { toMoneyString } from '../common/utils/decimal.util';
import { warehouseScopeFilter } from '../common/utils/warehouse-scope.util';
import { belowThresholdFilter } from '../stock/stock.service';
import { runBulk } from '../common/services/bulk.util';
import type { OrgContext } from '../common/types/request-context';
import type { Prisma } from '../generated/prisma/client';

const SORTABLE_FIELDS = [
  'name',
  'sku',
  'unitPrice',
  'createdAt',
  'updatedAt',
] as const;

/** Result of a delete request, which archives rather than orphaning history. */
export interface ProductDeletionResult {
  deleted: boolean;
  archived: boolean;
  message: string;
}

const PRODUCT_INCLUDE = {
  category: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
  stockLevels: {
    include: { warehouse: { select: { id: true, name: true, code: true } } },
  },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Lists products with their stock spread across warehouses.
   *
   * Stock levels are filtered to the caller's warehouse scope, so a staff
   * member browsing the catalogue sees quantities for their own site only —
   * the product row is visible, the other sites' numbers are not.
   *
   * @param orgContext - Resolved organisation context.
   * @param query - Pagination, search and filter options.
   * @returns A page of products.
   */
  async list(
    orgContext: OrgContext,
    query: ProductQuery,
  ): Promise<Paginated<ProductView>> {
    const scope = warehouseScopeFilter(orgContext);
    const warehouseFilter: Prisma.StockLevelWhereInput = {
      ...(scope ? { warehouseId: scope } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
    };

    const where: Prisma.ProductWhereInput = {
      organizationId: orgContext.organizationId,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { sku: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.warehouseId || scope
        ? { stockLevels: { some: warehouseFilter } }
        : {}),
      // The threshold test compares two columns, which Prisma expresses as a
      // field reference — so it runs in Postgres and this endpoint paginates
      // correctly. Filtering in JavaScript after the page was taken, as an
      // earlier version did, reported a `totalItems` that did not match.
      ...(query.lowStockOnly
        ? {
            stockLevels: {
              some: {
                ...warehouseFilter,
                ...belowThresholdFilter(this.prisma),
              },
            },
          }
        : {}),
    };

    const [rows, totalItems] = await Promise.all([
      this.prisma.product.findMany({
        where,
        ...toPrismaPage(query),
        orderBy: buildOrderBy(
          query.sortBy,
          query.sortDir,
          SORTABLE_FIELDS,
          'name',
        ),
        include: {
          ...PRODUCT_INCLUDE,
          stockLevels: {
            where: warehouseFilter,
            include: {
              warehouse: { select: { id: true, name: true, code: true } },
            },
          },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    return paginate(
      rows.map((row) => ProductsService.toView(row)),
      totalItems,
      query,
    );
  }

  /**
   * Loads one product with its full stock breakdown.
   *
   * @param orgContext - Resolved organisation context.
   * @param id - Product identifier.
   * @returns The product.
   * @throws NotFoundException when it does not exist in this organisation.
   */
  async findOne(orgContext: OrgContext, id: string): Promise<ProductView> {
    const scope = warehouseScopeFilter(orgContext);

    const product = await this.prisma.product.findFirst({
      where: { id, organizationId: orgContext.organizationId },
      include: {
        ...PRODUCT_INCLUDE,
        stockLevels: {
          where: scope ? { warehouseId: scope } : {},
          include: {
            warehouse: { select: { id: true, name: true, code: true } },
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return ProductsService.toView(product);
  }

  /**
   * Creates a product.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User performing the action.
   * @param input - Validated product payload.
   * @returns The created product.
   */
  async create(
    orgContext: OrgContext,
    actorId: string,
    input: CreateProductInput,
  ): Promise<ProductView> {
    await this.assertReferencesBelongToOrg(
      orgContext,
      input.categoryId,
      input.supplierId,
    );

    const product = await this.prisma.product.create({
      data: {
        organizationId: orgContext.organizationId,
        name: input.name,
        sku: input.sku,
        description: input.description ?? null,
        categoryId: input.categoryId ?? null,
        supplierId: input.supplierId ?? null,
        unitPrice: input.unitPrice.toFixed(2),
        unit: input.unit,
        defaultReorderPoint: input.defaultReorderPoint,
        defaultReorderQuantity: input.defaultReorderQuantity,
        isActive: input.isActive,
      },
      include: PRODUCT_INCLUDE,
    });

    await this.afterMutation(
      orgContext,
      actorId,
      'product.created',
      product.id,
      {
        sku: product.sku,
        name: product.name,
      },
    );

    return ProductsService.toView(product);
  }

  /**
   * Updates a product.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User performing the action.
   * @param id - Product identifier.
   * @param input - Fields to change.
   * @returns The updated product.
   */
  async update(
    orgContext: OrgContext,
    actorId: string,
    id: string,
    input: UpdateProductInput,
  ): Promise<ProductView> {
    await this.assertExists(orgContext, id);
    await this.assertReferencesBelongToOrg(
      orgContext,
      input.categoryId,
      input.supplierId,
    );

    const product = await this.prisma.product.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.sku === undefined ? {} : { sku: input.sku }),
        ...(input.description === undefined
          ? {}
          : { description: input.description }),
        ...(input.categoryId === undefined
          ? {}
          : { categoryId: input.categoryId }),
        ...(input.supplierId === undefined
          ? {}
          : { supplierId: input.supplierId }),
        ...(input.unitPrice === undefined
          ? {}
          : { unitPrice: input.unitPrice.toFixed(2) }),
        ...(input.unit === undefined ? {} : { unit: input.unit }),
        ...(input.defaultReorderPoint === undefined
          ? {}
          : { defaultReorderPoint: input.defaultReorderPoint }),
        ...(input.defaultReorderQuantity === undefined
          ? {}
          : { defaultReorderQuantity: input.defaultReorderQuantity }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      },
      include: PRODUCT_INCLUDE,
    });

    await this.afterMutation(orgContext, actorId, 'product.updated', id, {
      changed: Object.keys(input),
    });

    return ProductsService.toView(product);
  }

  /**
   * Deletes a product, or archives it when it carries stock or history.
   *
   * The movement ledger references products with `onDelete: Restrict`, so a
   * product that has ever moved cannot be removed without destroying audit
   * history. Archiving takes it out of circulation while keeping the books.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User performing the action.
   * @param id - Product identifier.
   * @returns Whether the row was deleted or archived, and why.
   */
  async remove(
    orgContext: OrgContext,
    actorId: string,
    id: string,
  ): Promise<ProductDeletionResult> {
    const product = await this.assertExists(orgContext, id);

    const [movements, stock] = await Promise.all([
      this.prisma.stockMovement.count({ where: { productId: id } }),
      this.prisma.stockLevel.aggregate({
        where: { productId: id },
        _sum: { quantity: true },
      }),
    ]);

    const units = stock._sum.quantity ?? 0;

    if (movements === 0 && units === 0) {
      await this.prisma.$transaction([
        this.prisma.stockLevel.deleteMany({ where: { productId: id } }),
        this.prisma.product.delete({ where: { id } }),
      ]);

      await this.afterMutation(orgContext, actorId, 'product.deleted', id, {
        sku: product.sku,
      });

      return {
        deleted: true,
        archived: false,
        message: `Product "${product.name}" was permanently deleted.`,
      };
    }

    await this.prisma.product.update({
      where: { id },
      data: { isActive: false },
    });
    await this.afterMutation(orgContext, actorId, 'product.archived', id, {
      sku: product.sku,
      movements,
      unitsOnHand: units,
    });

    return {
      deleted: false,
      archived: true,
      message: `Product "${product.name}" has ${movements} movement(s) of recorded history and ${units} unit(s) on hand, so it was archived rather than deleted. Its stock ledger is preserved.`,
    };
  }

  /**
   * Applies the same change to many products.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User performing the action.
   * @param input - Ids and the fields to change.
   * @returns Per-product outcomes.
   */
  async bulkUpdate(
    orgContext: OrgContext,
    actorId: string,
    input: BulkUpdateProductsInput,
  ): Promise<BulkResult> {
    await this.assertReferencesBelongToOrg(
      orgContext,
      input.categoryId ?? undefined,
      input.supplierId ?? undefined,
    );

    // Scoped to the organisation up front, so an id belonging to another tenant
    // simply is not in the working set.
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: input.ids },
        organizationId: orgContext.organizationId,
      },
      select: { id: true, sku: true, name: true },
    });

    const result = await runBulk(
      products.map((product) => ({ id: product.id, label: product.sku })),
      async (item) => {
        await this.prisma.product.update({
          where: { id: item.id },
          data: {
            ...(input.isActive === undefined
              ? {}
              : { isActive: input.isActive }),
            ...(input.categoryId === undefined
              ? {}
              : { categoryId: input.categoryId }),
            ...(input.supplierId === undefined
              ? {}
              : { supplierId: input.supplierId }),
          },
        });
      },
    );

    // Ids the caller sent that do not exist here are reported, not ignored.
    const found = new Set(products.map((product) => product.id));
    for (const id of input.ids.filter((candidate) => !found.has(candidate))) {
      result.results.push({
        id,
        label: id,
        ok: false,
        message: 'Not found in this organisation',
      });
      result.failed += 1;
    }
    result.requested = input.ids.length;

    await this.afterMutation(
      orgContext,
      actorId,
      'product.bulk_updated',
      'bulk',
      {
        count: result.succeeded,
        changed: Object.keys(input).filter((key) => key !== 'ids'),
      },
    );

    return result;
  }

  private async assertExists(
    orgContext: OrgContext,
    id: string,
  ): Promise<{ id: string; name: string; sku: string }> {
    const product = await this.prisma.product.findFirst({
      where: { id, organizationId: orgContext.organizationId },
      select: { id: true, name: true, sku: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  /**
   * Rejects category or supplier ids belonging to another organisation, which
   * would otherwise let a caller link their product to a stranger's record.
   */
  private async assertReferencesBelongToOrg(
    orgContext: OrgContext,
    categoryId?: string,
    supplierId?: string,
  ): Promise<void> {
    if (categoryId) {
      const category = await this.prisma.category.findFirst({
        where: { id: categoryId, organizationId: orgContext.organizationId },
        select: { id: true },
      });
      if (!category) {
        throw new BadRequestException(
          'Category does not exist in this organisation',
        );
      }
    }

    if (supplierId) {
      const supplier = await this.prisma.supplier.findFirst({
        where: { id: supplierId, organizationId: orgContext.organizationId },
        select: { id: true },
      });
      if (!supplier) {
        throw new BadRequestException(
          'Supplier does not exist in this organisation',
        );
      }
    }
  }

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
        entityType: 'Product',
        entityId,
        metadata: metadata as never,
      }),
      this.cacheService.invalidateOrganization(orgContext.organizationId),
    ]);
  }

  /** Maps a Prisma row into the API view model, computing the stock rollups. */
  private static toView(product: ProductRow): ProductView {
    const stockByWarehouse = product.stockLevels.map((level) => ({
      warehouseId: level.warehouse.id,
      warehouseName: level.warehouse.name,
      warehouseCode: level.warehouse.code,
      quantity: level.quantity,
      reservedQuantity: level.reservedQuantity,
      availableQuantity: level.quantity - level.reservedQuantity,
      reorderPoint: level.reorderPoint,
      reorderQuantity: level.reorderQuantity,
      isBelowThreshold:
        level.reorderPoint > 0 && level.quantity <= level.reorderPoint,
    }));

    const totalQuantity = stockByWarehouse.reduce(
      (sum, row) => sum + row.quantity,
      0,
    );
    const totalReserved = stockByWarehouse.reduce(
      (sum, row) => sum + row.reservedQuantity,
      0,
    );

    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      description: product.description,
      unit: product.unit,
      unitPrice: toMoneyString(product.unitPrice),
      defaultReorderPoint: product.defaultReorderPoint,
      defaultReorderQuantity: product.defaultReorderQuantity,
      isActive: product.isActive,
      category: product.category,
      supplier: product.supplier,
      totalQuantity,
      totalReserved,
      totalAvailable: totalQuantity - totalReserved,
      // A product is "low" when any single site has breached its own threshold:
      // 500 units sitting in Surat do not help a picker in Bengaluru.
      isBelowThreshold: stockByWarehouse.some((row) => row.isBelowThreshold),
      stockByWarehouse,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    };
  }
}
