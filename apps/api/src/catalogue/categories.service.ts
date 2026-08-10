import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CategoryView,
  CreateCategoryInput,
  Paginated,
  PaginationQuery,
  UpdateCategoryInput,
} from '@wms/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { buildOrderBy, paginate, toPrismaPage } from '../common/utils/pagination.util';
import { slugify } from '../common/utils/slug.util';
import type { OrgContext } from '../common/types/request-context';
import type { Prisma } from '../generated/prisma/client';

const SORTABLE_FIELDS = ['name', 'createdAt'] as const;

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Lists product categories.
   *
   * @param orgContext - Resolved organisation context.
   * @param query - Pagination and search options.
   * @returns A page of categories with product counts.
   */
  async list(
    orgContext: OrgContext,
    query: PaginationQuery,
  ): Promise<Paginated<CategoryView>> {
    const where: Prisma.CategoryWhereInput = {
      organizationId: orgContext.organizationId,
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [rows, totalItems] = await Promise.all([
      this.prisma.category.findMany({
        where,
        ...toPrismaPage(query),
        orderBy: buildOrderBy(query.sortBy, query.sortDir, SORTABLE_FIELDS, 'name'),
        include: { _count: { select: { products: true } } },
      }),
      this.prisma.category.count({ where }),
    ]);

    return paginate(rows.map(CategoriesService.toView), totalItems, query);
  }

  /**
   * Creates a category.
   *
   * @param orgContext - Resolved organisation context.
   * @param input - Validated category payload.
   * @returns The created category.
   */
  async create(
    orgContext: OrgContext,
    input: CreateCategoryInput,
  ): Promise<CategoryView> {
    const category = await this.prisma.category.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        slug: slugify(input.name),
        organizationId: orgContext.organizationId,
      },
      include: { _count: { select: { products: true } } },
    });

    await this.cacheService.invalidateOrganization(orgContext.organizationId);
    return CategoriesService.toView(category);
  }

  /**
   * Updates a category.
   *
   * @param orgContext - Resolved organisation context.
   * @param id - Category identifier.
   * @param input - Fields to change.
   * @returns The updated category.
   */
  async update(
    orgContext: OrgContext,
    id: string,
    input: UpdateCategoryInput,
  ): Promise<CategoryView> {
    await this.assertExists(orgContext, id);

    const category = await this.prisma.category.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name, slug: slugify(input.name) }),
        ...(input.description === undefined ? {} : { description: input.description }),
      },
      include: { _count: { select: { products: true } } },
    });

    await this.cacheService.invalidateOrganization(orgContext.organizationId);
    return CategoriesService.toView(category);
  }

  /**
   * Deletes a category that has no products attached.
   *
   * @param orgContext - Resolved organisation context.
   * @param id - Category identifier.
   * @throws ConflictException when products still reference it.
   */
  async remove(orgContext: OrgContext, id: string): Promise<void> {
    await this.assertExists(orgContext, id);

    const productCount = await this.prisma.product.count({ where: { categoryId: id } });
    if (productCount > 0) {
      throw new ConflictException(
        `Cannot delete this category: ${productCount} product(s) still use it. Reassign them first.`,
      );
    }

    await this.prisma.category.delete({ where: { id } });
    await this.cacheService.invalidateOrganization(orgContext.organizationId);
  }

  private async assertExists(orgContext: OrgContext, id: string): Promise<void> {
    const found = await this.prisma.category.findFirst({
      where: { id, organizationId: orgContext.organizationId },
      select: { id: true },
    });

    if (!found) {
      throw new NotFoundException('Category not found');
    }
  }

  private static toView(
    category: Prisma.CategoryGetPayload<{
      include: { _count: { select: { products: true } } };
    }>,
  ): CategoryView {
    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      productCount: category._count.products,
    };
  }
}
