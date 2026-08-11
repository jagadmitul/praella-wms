-- Index for the replenishment query.
--
-- `quantity <= reorderPoint` compares two columns, which no ordinary index can
-- serve. A *partial* index can: Postgres allows a column comparison in the
-- predicate, so this indexes precisely the rows that are actually below their
-- threshold and nothing else. The low-stock report becomes an index scan over a
-- handful of rows instead of a filter over every stock level in the tenant.
--
-- An earlier attempt used a STORED generated column instead. It worked, but
-- Prisma has no syntax for generated columns and models the result as a
-- DEFAULT, so every later `prisma migrate dev` wanted to rewrite the column.
-- This achieves the same thing with no schema drift at all: Prisma matches
-- indexes by column list, and no index in schema.prisma covers these three
-- columns, so it leaves this one alone.
CREATE INDEX IF NOT EXISTS "stock_levels_low_stock_idx"
  ON "stock_levels" ("organizationId", "warehouseId", "productId")
  WHERE "reorderPoint" > 0 AND quantity <= "reorderPoint";
