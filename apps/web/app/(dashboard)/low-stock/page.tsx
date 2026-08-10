import type { Metadata } from 'next';
import { Card, CardHeader, EmptyState, PageHeader, StatTile, Table, Td, Th } from '@/components/ui';
import { SelectFilter } from '@/components/ui/filters';
import { getLowStock, getWarehouses } from '@/lib/queries';
import { formatNumber } from '@/lib/format';

export const metadata: Metadata = { title: 'Replenishment' };

export default async function LowStockPage({
  searchParams,
}: {
  searchParams: Promise<{ warehouseId?: string }>;
}) {
  const { warehouseId } = await searchParams;

  const [lowStock, warehouses] = await Promise.all([
    getLowStock({ warehouseId }),
    getWarehouses(),
  ]);

  const totalShortfall = lowStock.reduce((sum, item) => sum + item.shortfall, 0);
  const suppliersAffected = new Set(
    lowStock.map((item) => item.supplier?.id).filter(Boolean),
  ).size;

  return (
    <>
      <PageHeader
        title="Replenishment"
        description="Every product/warehouse line at or below its minimum stock threshold, most urgent first."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Lines to reorder"
          value={formatNumber(lowStock.length)}
          tone={lowStock.length > 0 ? 'warning' : 'positive'}
          hint={lowStock.length === 0 ? 'Everything is above threshold' : undefined}
        />
        <StatTile
          label="Total shortfall"
          value={formatNumber(totalShortfall)}
          hint="Units below threshold"
        />
        <StatTile
          label="Suppliers involved"
          value={formatNumber(suppliersAffected)}
          hint="Distinct suppliers to contact"
        />
      </div>

      <div className="mb-4">
        <SelectFilter
          name="warehouseId"
          label="Warehouse"
          allLabel="All warehouses"
          options={warehouses.items.map((warehouse) => ({
            value: warehouse.id,
            label: `${warehouse.code} — ${warehouse.name}`,
          }))}
        />
      </div>

      <Card>
        <CardHeader
          title="Reorder list"
          description="Suggested quantity comes from the reorder quantity on each rule, falling back to the shortfall."
        />
        <Table>
          <thead>
            <tr>
              <Th>Product</Th>
              <Th>Warehouse</Th>
              <Th>Supplier</Th>
              <Th align="right">On hand</Th>
              <Th align="right">Threshold</Th>
              <Th align="right">Short by</Th>
              <Th align="right">Suggested order</Th>
            </tr>
          </thead>
          <tbody>
            {lowStock.length === 0 ? (
              <EmptyState
                colSpan={7}
                title="Nothing needs reordering"
                description="Every tracked line is above its minimum stock threshold."
              />
            ) : (
              lowStock.map((item) => (
                <tr key={`${item.productId}-${item.warehouseId}`}>
                  <Td>
                    <p className="font-medium text-ink-800">{item.productName}</p>
                    <p className="font-mono text-[11px] text-ink-400">{item.sku}</p>
                  </Td>
                  <Td>
                    <span className="font-mono text-xs">{item.warehouseCode}</span>
                    <p className="text-[11px] text-ink-400">{item.warehouseName}</p>
                  </Td>
                  <Td className="text-ink-500">{item.supplier?.name ?? '—'}</Td>
                  <Td align="right">{formatNumber(item.quantity)}</Td>
                  <Td align="right" className="text-ink-500">
                    {formatNumber(item.reorderPoint)}
                  </Td>
                  <Td align="right">
                    <span className="font-medium text-warning-700">
                      {formatNumber(item.shortfall)}
                    </span>
                  </Td>
                  <Td align="right" className="font-medium">
                    {formatNumber(item.suggestedOrderQuantity)}
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
