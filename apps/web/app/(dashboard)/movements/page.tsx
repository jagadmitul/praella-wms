import type { Metadata } from 'next';
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';
import {
  ClearFilters,
  DateFilter,
  FilterBar,
  Pagination,
  SearchFilter,
  SelectFilter,
} from '@/components/ui/filters';
import { getMovements, getWarehouses } from '@/lib/queries';
import { formatCurrency, formatDateTime, formatNumber, humanise } from '@/lib/format';

export const metadata: Metadata = { title: 'Movement history' };

const MOVEMENT_TONE = {
  INBOUND: 'positive',
  TRANSFER_IN: 'positive',
  OUTBOUND: 'brand',
  TRANSFER_OUT: 'brand',
  ADJUSTMENT: 'warning',
} as const;

const TYPE_OPTIONS = [
  { value: 'INBOUND', label: 'Inbound' },
  { value: 'OUTBOUND', label: 'Outbound' },
  { value: 'TRANSFER_IN', label: 'Transfer in' },
  { value: 'TRANSFER_OUT', label: 'Transfer out' },
  { value: 'ADJUSTMENT', label: 'Adjustment' },
];

export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    page?: string;
    warehouseId?: string;
    type?: string;
    from?: string;
    to?: string;
    pageSize?: string;
    sortBy?: string;
    sortDir?: string;
  }>;
}) {
  const params = await searchParams;
  const page = Number(params.page ?? 1);
  // Clamped to the API's own cap so a hand-edited URL cannot force a huge scan.
  const pageSize = Math.min(Number(params.pageSize ?? 25) || 25, 100);

  const [movements, warehouses] = await Promise.all([
    getMovements({
      search: params.search,
      page,
      pageSize,
      warehouseId: params.warehouseId,
      type: params.type,
      from: params.from,
      to: params.to,
    }),
    getWarehouses(),
  ]);

  return (
    <>
      <PageHeader
        title="Movement history"
        description="The append-only stock ledger. Rows are never edited or deleted, so the signed sum of movements always reconciles to the quantity on the shelf."
      />

      <FilterBar>
        <SearchFilter placeholder="Search product, SKU, reference or note" />
        <SelectFilter
          name="warehouseId"
          label="Warehouse"
          allLabel="All warehouses"
          options={warehouses.items.map((warehouse) => ({
            value: warehouse.id,
            label: `${warehouse.code} — ${warehouse.name}`,
          }))}
        />
        <SelectFilter name="type" label="Type" allLabel="All types" options={TYPE_OPTIONS} />
        <DateFilter name="from" label="From" />
        <DateFilter name="to" label="To" />
        <ClearFilters />
      </FilterBar>

      <Card>
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Type</Th>
              <Th>Product</Th>
              <Th>Route</Th>
              <Th align="right">Qty</Th>
              <Th align="right">Balance after</Th>
              <Th align="right">Unit cost</Th>
              <Th>Reference</Th>
              <Th>By</Th>
            </tr>
          </thead>
          <tbody>
            {movements.items.length === 0 ? (
              <EmptyState
                colSpan={9}
                title="No movements match these filters"
                description="Try widening the date range, warehouse or movement type."
              />
            ) : (
              movements.items.map((movement) => {
                const isInbound =
                  movement.type === 'INBOUND' || movement.type === 'TRANSFER_IN';

                return (
                  <tr key={movement.id}>
                    <Td className="whitespace-nowrap text-xs text-ink-500">
                      {formatDateTime(movement.createdAt)}
                    </Td>
                    <Td>
                      <Badge tone={MOVEMENT_TONE[movement.type]}>
                        {humanise(movement.type)}
                      </Badge>
                    </Td>
                    <Td>
                      <p className="font-medium text-ink-800">{movement.product.name}</p>
                      <p className="font-mono text-[11px] text-ink-400">
                        {movement.product.sku}
                      </p>
                    </Td>
                    <Td className="font-mono text-xs whitespace-nowrap text-ink-500">
                      {movement.sourceWarehouse?.code ?? '—'}
                      <span aria-hidden className="mx-1 text-ink-300">
                        →
                      </span>
                      {movement.destinationWarehouse?.code ?? '—'}
                    </Td>
                    <Td align="right">
                      <span className={isInbound ? 'text-positive-700' : 'text-ink-700'}>
                        {isInbound ? '+' : '−'}
                        {formatNumber(movement.quantity)}
                      </span>
                    </Td>
                    <Td align="right">{formatNumber(movement.balanceAfter)}</Td>
                    <Td align="right" className="text-ink-500">
                      {movement.unitCost ? formatCurrency(movement.unitCost) : '—'}
                    </Td>
                    <Td>
                      {movement.referenceCode ? (
                        <span className="font-mono text-xs text-ink-700">
                          {movement.referenceCode}
                        </span>
                      ) : (
                        <span className="text-xs text-ink-400">
                          {humanise(movement.referenceType)}
                        </span>
                      )}
                    </Td>
                    <Td className="text-xs text-ink-500">
                      {movement.createdBy?.fullName ?? '—'}
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </Table>

        <Pagination
          page={movements.meta.page}
          totalPages={movements.meta.totalPages}
          totalItems={movements.meta.totalItems}
          pageSize={pageSize}
        />
      </Card>
    </>
  );
}
