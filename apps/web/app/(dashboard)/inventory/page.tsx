import type { Metadata } from 'next';
import { Badge, Card, EmptyState, Label, PageHeader, Table, Td, Th } from '@/components/ui';
import { DialogForm, FieldError } from '@/components/ui/dialog-form';
import {
  ClearFilters,
  FilterBar,
  Pagination,
  SearchFilter,
  SelectFilter,
  SortFilter,
} from '@/components/ui/filters';
import {
  adjustStockAction,
  recordMovementAction,
  setReplenishmentRuleAction,
} from '@/lib/actions/inventory';
import { getProducts, getSession, getStockLevels, getWarehouses } from '@/lib/queries';
import { formatCurrency, formatNumber, formatRelative } from '@/lib/format';

export const metadata: Metadata = { title: 'Stock levels' };

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    page?: string;
    warehouseId?: string;
    categoryId?: string;
    belowThreshold?: string;
    pageSize?: string;
    sortBy?: string;
    sortDir?: string;
  }>;
}) {
  const params = await searchParams;
  const page = Number(params.page ?? 1);
  // Clamped to the API's own cap so a hand-edited URL cannot force a huge scan.
  const pageSize = Math.min(Number(params.pageSize ?? 25) || 25, 100);

  const [session, levels, warehouses, products] = await Promise.all([
    getSession(),
    getStockLevels({
      search: params.search,
      page,
      pageSize,
      warehouseId: params.warehouseId,
      categoryId: params.categoryId,
      belowThreshold: params.belowThreshold,
      sortBy: params.sortBy ?? 'quantity',
      sortDir: (params.sortDir as 'asc' | 'desc') ?? 'desc',
    }),
    getWarehouses(),
    getProducts({ pageSize, sortBy: 'name', sortDir: 'asc' }),
  ]);

  const can = (permission: string) =>
    (session.permissions as string[]).includes(permission);

  const warehouseOptions = warehouses.items.map((warehouse) => ({
    value: warehouse.id,
    label: `${warehouse.code} — ${warehouse.name}`,
  }));
  const productOptions = products.items.map((product) => ({
    value: product.id,
    label: `${product.sku} — ${product.name}`,
  }));

  /** Product + warehouse selectors, shared by all three dialogs. */
  const selectors = (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <Label htmlFor="productId">Product</Label>
        <select id="productId" name="productId" className="field">
          {productOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <FieldError name="productId" />
      </div>
      <div>
        <Label htmlFor="warehouseId">Warehouse</Label>
        <select id="warehouseId" name="warehouseId" className="field">
          {warehouseOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <FieldError name="warehouseId" />
      </div>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Stock levels"
        description="On-hand and reserved quantity for every product at every site."
        action={
          <div className="flex gap-2">
            {can('movement:record') ? (
              <DialogForm
                trigger="Record movement"
                title="Record a stock movement"
                description="Goods physically received into, or dispatched from, a warehouse."
                action={recordMovementAction}
                submitLabel="Record movement"
              >
                    {selectors}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="type">Direction</Label>
                        <select id="type" name="type" className="field">
                          <option value="INBOUND">Inbound — goods received</option>
                          <option value="OUTBOUND">Outbound — goods dispatched</option>
                        </select>
                      </div>
                      <div>
                        <Label htmlFor="quantity">Quantity</Label>
                        <input
                          id="quantity"
                          name="quantity"
                          type="number"
                          min="1"
                          className="field"
                          defaultValue="1"
                        />
                        <FieldError name="quantity" />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="note" hint="— optional">
                        Note
                      </Label>
                      <input id="note" name="note" className="field" />
                    </div>
              </DialogForm>
            ) : null}

            {can('stock:adjust') ? (
              <DialogForm
                trigger="Adjust stock"
                title="Adjust stock"
                description="For corrections after a physical count. A reason is required and is written to the audit trail."
                action={adjustStockAction}
                submitLabel="Apply adjustment"
              >
                    {selectors}
                    <div>
                      <Label htmlFor="delta" hint="— negative to reduce, positive to increase">
                        Adjustment
                      </Label>
                      <input
                        id="delta"
                        name="delta"
                        type="number"
                        className="field"
                        defaultValue="-1"
                      />
                      <FieldError name="delta" />
                    </div>
                    <div>
                      <Label htmlFor="reason">Reason</Label>
                      <input
                        id="reason"
                        name="reason"
                        className="field"
                        placeholder="Cycle count variance"
                      />
                      <FieldError name="reason" />
                    </div>
              </DialogForm>
            ) : null}

            {can('replenishment:manage') ? (
              <DialogForm
                trigger="Set threshold"
                title="Set a replenishment rule"
                description="Thresholds are per product, per warehouse — the same SKU can warrant different safety stock at a hub than at a spoke."
                action={setReplenishmentRuleAction}
                submitLabel="Save rule"
              >
                    {selectors}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="reorderPoint" hint="— flag at or below this">
                          Minimum stock
                        </Label>
                        <input
                          id="reorderPoint"
                          name="reorderPoint"
                          type="number"
                          min="0"
                          className="field"
                          defaultValue="0"
                        />
                        <FieldError name="reorderPoint" />
                      </div>
                      <div>
                        <Label htmlFor="reorderQuantity">Reorder quantity</Label>
                        <input
                          id="reorderQuantity"
                          name="reorderQuantity"
                          type="number"
                          min="0"
                          className="field"
                          defaultValue="0"
                        />
                      </div>
                    </div>
              </DialogForm>
            ) : null}
          </div>
        }
      />

      <FilterBar>
        <SearchFilter placeholder="Search product or SKU" />
        <SelectFilter
          name="warehouseId"
          label="Warehouse"
          allLabel="All warehouses"
          options={warehouseOptions}
        />
        <SelectFilter
          name="belowThreshold"
          label="Stock"
          allLabel="All stock levels"
          options={[{ value: 'true', label: 'Below threshold only' }]}
        />
        <SortFilter
          options={[
            { value: 'quantity', label: 'Quantity' },
            { value: 'reorderPoint', label: 'Threshold' },
            { value: 'updatedAt', label: 'Updated' },
          ]}
        />
        <ClearFilters />
      </FilterBar>

      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Product</Th>
              <Th>Warehouse</Th>
              <Th align="right">On hand</Th>
              <Th align="right">Reserved</Th>
              <Th align="right">Available</Th>
              <Th align="right">Threshold</Th>
              <Th align="right">Stock value</Th>
              <Th>Updated</Th>
            </tr>
          </thead>
          <tbody>
            {levels.items.length === 0 ? (
              <EmptyState
                colSpan={8}
                title="No stock levels yet"
                description="Record a movement or receive a purchase order to create one."
              />
            ) : (
              levels.items.map((level) => (
                <tr key={level.id}>
                  <Td>
                    <p className="font-medium text-ink-800">{level.product.name}</p>
                    <p className="font-mono text-[11px] text-ink-400">{level.product.sku}</p>
                  </Td>
                  <Td>
                    <span className="font-mono text-xs">{level.warehouse.code}</span>
                  </Td>
                  <Td align="right">{formatNumber(level.quantity)}</Td>
                  <Td align="right">
                    {level.reservedQuantity > 0 ? (
                      <span className="text-warning-700">
                        {formatNumber(level.reservedQuantity)}
                      </span>
                    ) : (
                      <span className="text-ink-300">0</span>
                    )}
                  </Td>
                  <Td align="right" className="font-medium">
                    {formatNumber(level.availableQuantity)}
                  </Td>
                  <Td align="right">
                    {level.reorderPoint > 0 ? (
                      <span
                        className={
                          level.isBelowThreshold ? 'font-medium text-warning-700' : undefined
                        }
                      >
                        {formatNumber(level.reorderPoint)}
                      </span>
                    ) : (
                      <span className="text-ink-300">—</span>
                    )}
                  </Td>
                  <Td align="right" className="text-ink-500">
                    {formatCurrency(Number(level.product.unitPrice) * level.quantity)}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-ink-400">
                        {formatRelative(level.updatedAt)}
                      </span>
                      {level.isBelowThreshold ? <Badge tone="warning">Reorder</Badge> : null}
                    </div>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </Table>

        <Pagination
          page={levels.meta.page}
          totalPages={levels.meta.totalPages}
          totalItems={levels.meta.totalItems}
          pageSize={pageSize}
        />
      </Card>
    </>
  );
}
