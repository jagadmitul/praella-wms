import type { Metadata } from 'next';
import {
  BulkActionBar,
  BulkProvider,
  BulkRowCheckbox,
  BulkTh,
} from '@/components/ui/bulk-select';
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
import { createProductAction } from '@/lib/actions/inventory';
import {
  getCategories,
  getProducts,
  getSession,
  getSuppliers,
  getWarehouses,
} from '@/lib/queries';
import { bulkProductsAction } from '@/lib/actions/bulk';
import { formatCurrency, formatNumber } from '@/lib/format';

export const metadata: Metadata = { title: 'Products' };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    page?: string;
    categoryId?: string;
    supplierId?: string;
    warehouseId?: string;
    isActive?: string;
    lowStockOnly?: string;
    pageSize?: string;
    sortBy?: string;
    sortDir?: string;
  }>;
}) {
  const params = await searchParams;
  const page = Number(params.page ?? 1);
  // Clamped to the API's own cap so a hand-edited URL cannot force a huge scan.
  const pageSize = Math.min(Number(params.pageSize ?? 20) || 20, 100);

  const [session, products, categories, suppliers, warehouses] = await Promise.all([
    getSession(),
    getProducts({
      search: params.search,
      page,
      pageSize,
      categoryId: params.categoryId,
      supplierId: params.supplierId,
      warehouseId: params.warehouseId,
      isActive: params.isActive,
      lowStockOnly: params.lowStockOnly,
      sortBy: params.sortBy ?? 'name',
      sortDir: (params.sortDir as 'asc' | 'desc') ?? 'asc',
    }),
    getCategories(),
    getSuppliers(),
    getWarehouses(),
  ]);

  const can = (permission: string) =>
    (session.permissions as string[]).includes(permission);

  // The catalogue itself is organisation-wide — a SKU is not warehouse data —
  // but the stock rolled up beside it is not. Spelling out how many sites are
  // in view stops a scoped user reading their partial totals as the whole
  // company's, which is the one way this page could actually mislead.
  const visibleSites = warehouses.items.length;
  const scopeDescription =
    visibleSites === 1
      ? `Your catalogue, with stock rolled up across ${warehouses.items[0]?.code ?? 'your site'} — the one warehouse you are assigned to.`
      : `Your catalogue, with stock rolled up across all ${visibleSites} warehouses you can see.`;

  return (
    <>
      <PageHeader
        title="Products"
        description={scopeDescription}
        action={
          can('product:create') ? (
            <DialogForm
              trigger="New product"
              title="Add a product"
              description="SKUs are stored in uppercase and must be unique within your organisation."
              action={createProductAction}
              submitLabel="Create product"
            >
                  <div className="grid grid-cols-[1.6fr_1fr] gap-4">
                    <div>
                      <Label htmlFor="name">Product name</Label>
                      <input id="name" name="name" className="field" placeholder="Aurora 27&quot; Monitor" />
                      <FieldError name="name" />
                    </div>
                    <div>
                      <Label htmlFor="sku">SKU</Label>
                      <input id="sku" name="sku" className="field" placeholder="ELEC-MON-27" />
                      <FieldError name="sku" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="categoryId">Category</Label>
                      <select id="categoryId" name="categoryId" className="field">
                        <option value="">None</option>
                        {categories.items.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="supplierId">Supplier</Label>
                      <select id="supplierId" name="supplierId" className="field">
                        <option value="">None</option>
                        {suppliers.items.map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="unitPrice">Unit price (₹)</Label>
                      <input
                        id="unitPrice"
                        name="unitPrice"
                        type="number"
                        step="0.01"
                        min="0"
                        className="field"
                        defaultValue="0"
                      />
                      <FieldError name="unitPrice" />
                    </div>
                    <div>
                      <Label htmlFor="unit">Unit of measure</Label>
                      <input id="unit" name="unit" className="field" defaultValue="pcs" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="defaultReorderPoint" hint="— minimum stock">
                        Reorder point
                      </Label>
                      <input
                        id="defaultReorderPoint"
                        name="defaultReorderPoint"
                        type="number"
                        min="0"
                        className="field"
                        defaultValue="0"
                      />
                    </div>
                    <div>
                      <Label htmlFor="defaultReorderQuantity">Reorder quantity</Label>
                      <input
                        id="defaultReorderQuantity"
                        name="defaultReorderQuantity"
                        type="number"
                        min="0"
                        className="field"
                        defaultValue="0"
                      />
                    </div>
                  </div>
            </DialogForm>
          ) : null
        }
      />

      <FilterBar>
        <SearchFilter placeholder="Search name, SKU or description" />
        <SelectFilter
          name="categoryId"
          label="Category"
          allLabel="All categories"
          options={categories.items.map((category) => ({
            value: category.id,
            label: category.name,
          }))}
        />
        <SelectFilter
          name="supplierId"
          label="Supplier"
          allLabel="All suppliers"
          options={suppliers.items.map((supplier) => ({
            value: supplier.id,
            label: supplier.name,
          }))}
        />
        <SelectFilter
          name="lowStockOnly"
          label="Stock"
          allLabel="All stock levels"
          options={[{ value: 'true', label: 'Below threshold only' }]}
        />
        <SelectFilter
          name="isActive"
          label="State"
          allLabel="Active and archived"
          options={[
            { value: 'true', label: 'Active only' },
            { value: 'false', label: 'Archived only' },
          ]}
        />
        <SortFilter
          options={[
            { value: 'name', label: 'Name' },
            { value: 'sku', label: 'SKU' },
            { value: 'unitPrice', label: 'Unit price' },
            { value: 'createdAt', label: 'Created' },
            { value: 'updatedAt', label: 'Updated' },
          ]}
        />
        <ClearFilters />
      </FilterBar>

      <BulkProvider allIds={products.items.map((row) => row.id)}>
        <Card>
          <Table>
          <thead>
            <tr>
              {can('product:update') ? <BulkTh /> : null}
              <Th>Product</Th>
              <Th>Category</Th>
              <Th>Supplier</Th>
              <Th align="right">Unit price</Th>
              <Th align="right">On hand</Th>
              <Th align="right">Reserved</Th>
              <Th align="right">Available</Th>
              <Th>Sites</Th>
            </tr>
          </thead>
          <tbody>
            {products.items.length === 0 ? (
              <EmptyState
                colSpan={8 + (can('product:update') ? 1 : 0)}
                title="No products found"
                description="Adjust your filters, or add the first product to your catalogue."
              />
            ) : (
              products.items.map((product) => (
                <tr key={product.id}>
                    {can('product:update') ? (
                      <Td className="w-10">
                        <BulkRowCheckbox id={product.id} label={product.sku} />
                      </Td>
                    ) : null}
                  <Td>
                    <div className="flex items-center gap-2">
                      <div>
                        <p className="font-medium text-ink-800">{product.name}</p>
                        <p className="font-mono text-[11px] text-ink-400">{product.sku}</p>
                      </div>
                      {product.isBelowThreshold ? <Badge tone="warning">Low</Badge> : null}
                      {!product.isActive ? <Badge tone="neutral">Archived</Badge> : null}
                    </div>
                  </Td>
                  <Td className="text-ink-500">{product.category?.name ?? '—'}</Td>
                  <Td className="text-ink-500">{product.supplier?.name ?? '—'}</Td>
                  <Td align="right">{formatCurrency(product.unitPrice)}</Td>
                  <Td align="right">{formatNumber(product.totalQuantity)}</Td>
                  <Td align="right">
                    {product.totalReserved > 0 ? (
                      <span className="text-warning-700">
                        {formatNumber(product.totalReserved)}
                      </span>
                    ) : (
                      <span className="text-ink-300">0</span>
                    )}
                  </Td>
                  <Td align="right">
                    <span className="font-medium">{formatNumber(product.totalAvailable)}</span>{' '}
                    <span className="text-xs text-ink-400">{product.unit}</span>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {product.stockByWarehouse.length === 0 ? (
                        <span className="text-xs text-ink-300">No stock</span>
                      ) : (
                        product.stockByWarehouse.map((row) => (
                          <Badge
                            key={row.warehouseId}
                            tone={row.isBelowThreshold ? 'warning' : 'neutral'}
                          >
                            {row.warehouseCode} {formatNumber(row.quantity)}
                          </Badge>
                        ))
                      )}
                    </div>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
          </Table>

          <Pagination
          page={products.meta.page}
          totalPages={products.meta.totalPages}
          totalItems={products.meta.totalItems}
          pageSize={pageSize}
          />
        </Card>

        {can('product:update') ? (
          <BulkActionBar
            noun="product"
            action={bulkProductsAction}
            actions={[{ value: 'archive', label: 'Archive', confirm: 'Archive the selected products?' }, { value: 'activate', label: 'Restore to active' }]}
          />
        ) : null}
      </BulkProvider>
    </>
  );
}
