-- CreateIndex
CREATE INDEX "stock_levels_organizationId_reorderPoint_idx" ON "stock_levels"("organizationId", "reorderPoint");
