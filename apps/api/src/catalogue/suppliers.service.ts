import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateSupplierInput,
  Paginated,
  PaginationQuery,
  SupplierView,
  UpdateSupplierInput,
} from '@wms/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { buildOrderBy, paginate, toPrismaPage } from '../common/utils/pagination.util';
import type { OrgContext } from '../common/types/request-context';
import type { Prisma } from '../generated/prisma/client';

const SORTABLE_FIELDS = ['name', 'createdAt'] as const;

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Lists suppliers.
   *
   * @param orgContext - Resolved organisation context.
   * @param query - Pagination and search options.
   * @returns A page of suppliers with product counts.
   */
  async list(
    orgContext: OrgContext,
    query: PaginationQuery,
  ): Promise<Paginated<SupplierView>> {
    const where: Prisma.SupplierWhereInput = {
      organizationId: orgContext.organizationId,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { contactName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, totalItems] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        ...toPrismaPage(query),
        orderBy: buildOrderBy(query.sortBy, query.sortDir, SORTABLE_FIELDS, 'name'),
        include: { _count: { select: { products: true } } },
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return paginate(rows.map(SuppliersService.toView), totalItems, query);
  }

  /**
   * Creates a supplier.
   *
   * @param orgContext - Resolved organisation context.
   * @param input - Validated supplier payload.
   * @returns The created supplier.
   */
  async create(
    orgContext: OrgContext,
    input: CreateSupplierInput,
  ): Promise<SupplierView> {
    const supplier = await this.prisma.supplier.create({
      data: {
        organizationId: orgContext.organizationId,
        name: input.name,
        contactName: input.contactName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        notes: input.notes ?? null,
      },
      include: { _count: { select: { products: true } } },
    });

    await this.cacheService.invalidateOrganization(orgContext.organizationId);
    return SuppliersService.toView(supplier);
  }

  /**
   * Updates a supplier.
   *
   * @param orgContext - Resolved organisation context.
   * @param id - Supplier identifier.
   * @param input - Fields to change.
   * @returns The updated supplier.
   */
  async update(
    orgContext: OrgContext,
    id: string,
    input: UpdateSupplierInput,
  ): Promise<SupplierView> {
    await this.assertExists(orgContext, id);

    const supplier = await this.prisma.supplier.update({
      where: { id },
      data: input,
      include: { _count: { select: { products: true } } },
    });

    await this.cacheService.invalidateOrganization(orgContext.organizationId);
    return SuppliersService.toView(supplier);
  }

  /**
   * Deletes a supplier that has no products or purchase orders attached.
   *
   * @param orgContext - Resolved organisation context.
   * @param id - Supplier identifier.
   * @throws ConflictException when the supplier is still referenced.
   */
  async remove(orgContext: OrgContext, id: string): Promise<void> {
    await this.assertExists(orgContext, id);

    const [productCount, orderCount] = await Promise.all([
      this.prisma.product.count({ where: { supplierId: id } }),
      this.prisma.purchaseOrder.count({ where: { supplierId: id } }),
    ]);

    if (orderCount > 0) {
      throw new ConflictException(
        `Cannot delete this supplier: ${orderCount} purchase order(s) reference it.`,
      );
    }

    if (productCount > 0) {
      throw new ConflictException(
        `Cannot delete this supplier: ${productCount} product(s) still use it. Reassign them first.`,
      );
    }

    await this.prisma.supplier.delete({ where: { id } });
    await this.cacheService.invalidateOrganization(orgContext.organizationId);
  }

  private async assertExists(orgContext: OrgContext, id: string): Promise<void> {
    const found = await this.prisma.supplier.findFirst({
      where: { id, organizationId: orgContext.organizationId },
      select: { id: true },
    });

    if (!found) {
      throw new NotFoundException('Supplier not found');
    }
  }

  private static toView(
    supplier: Prisma.SupplierGetPayload<{
      include: { _count: { select: { products: true } } };
    }>,
  ): SupplierView {
    return {
      id: supplier.id,
      name: supplier.name,
      contactName: supplier.contactName,
      email: supplier.email,
      phone: supplier.phone,
      address: supplier.address,
      notes: supplier.notes,
      productCount: supplier._count.products,
    };
  }
}
