import { buildPaginationMeta } from '@wms/contracts';
import { buildOrderBy, paginate, toPrismaPage } from './pagination.util';

describe('pagination helpers', () => {
  describe('toPrismaPage', () => {
    it('converts a 1-based page into skip/take', () => {
      expect(toPrismaPage({ page: 1, pageSize: 20 })).toEqual({
        skip: 0,
        take: 20,
      });
      expect(toPrismaPage({ page: 3, pageSize: 25 })).toEqual({
        skip: 50,
        take: 25,
      });
    });
  });

  describe('buildPaginationMeta', () => {
    it('computes page counts and navigation flags', () => {
      expect(buildPaginationMeta(2, 20, 45)).toEqual({
        page: 2,
        pageSize: 20,
        totalItems: 45,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true,
      });
    });

    it('reports no pages and no navigation for an empty result set', () => {
      expect(buildPaginationMeta(1, 20, 0)).toMatchObject({
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      });
    });

    it('marks the final page as having no next page', () => {
      expect(buildPaginationMeta(3, 20, 45)).toMatchObject({
        hasNextPage: false,
        hasPreviousPage: true,
      });
    });
  });

  describe('buildOrderBy', () => {
    const allowed = ['name', 'sku', 'createdAt'] as const;

    it('honours an allowed sort field', () => {
      expect(buildOrderBy('sku', 'asc', allowed, 'name')).toEqual({
        sku: 'asc',
      });
    });

    it('falls back when the field is absent', () => {
      expect(buildOrderBy(undefined, 'desc', allowed, 'name')).toEqual({
        name: 'desc',
      });
    });

    it('refuses a field outside the allow-list', () => {
      // Sorting by an arbitrary column would let a caller turn a cheap list
      // endpoint into a full table scan on an unindexed field.
      expect(buildOrderBy('passwordHash', 'asc', allowed, 'name')).toEqual({
        name: 'asc',
      });
    });
  });

  describe('paginate', () => {
    it('wraps rows in the standard envelope', () => {
      const result = paginate(['a', 'b'], 7, { page: 1, pageSize: 2 });

      expect(result.items).toEqual(['a', 'b']);
      expect(result.meta.totalPages).toBe(4);
    });
  });
});
