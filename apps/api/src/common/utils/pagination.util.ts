import { buildPaginationMeta, type Paginated, type PaginationQuery } from '@wms/contracts';

/** Prisma `skip`/`take` derived from a page number and size. */
export interface PrismaPageArgs {
  skip: number;
  take: number;
}

/**
 * Converts a 1-based page query into Prisma's offset arguments.
 *
 * @param query - Validated pagination query.
 * @returns `skip` and `take` for a Prisma `findMany`.
 */
export function toPrismaPage(query: Pick<PaginationQuery, 'page' | 'pageSize'>): PrismaPageArgs {
  return {
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  };
}

/**
 * Wraps a page of rows in the standard `{ items, meta }` envelope.
 *
 * @param items - Rows for the current page.
 * @param totalItems - Total rows matching the filter.
 * @param query - The pagination query that produced the page.
 * @returns The paginated envelope.
 */
export function paginate<TItem>(
  items: TItem[],
  totalItems: number,
  query: Pick<PaginationQuery, 'page' | 'pageSize'>,
): Paginated<TItem> {
  return {
    items,
    meta: buildPaginationMeta(query.page, query.pageSize, totalItems),
  };
}

/**
 * Builds a safe Prisma `orderBy` from a client-supplied sort field.
 *
 * The allow-list matters: passing an arbitrary string straight through would
 * let a caller sort by an unindexed column and turn a cheap list endpoint into
 * a full table scan.
 *
 * @param sortBy - Requested sort field, possibly unknown or absent.
 * @param sortDir - Requested direction.
 * @param allowed - Fields the endpoint permits sorting on.
 * @param fallback - Field used when `sortBy` is absent or not allowed.
 * @returns A Prisma `orderBy` object.
 */
export function buildOrderBy<TField extends string>(
  sortBy: string | undefined,
  sortDir: 'asc' | 'desc',
  allowed: readonly TField[],
  fallback: TField,
): Record<string, 'asc' | 'desc'> {
  const field = allowed.includes(sortBy as TField) ? (sortBy as TField) : fallback;
  return { [field]: sortDir };
}
