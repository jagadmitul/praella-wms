import type { Metadata } from 'next';
import {
  BulkActionBar,
  BulkProvider,
  BulkRowCheckbox,
  BulkTh,
} from '@/components/ui/bulk-select';
import { Card, EmptyState, PageHeader, StatusBadge, Table, Td, Th } from '@/components/ui';
import {
  ClearFilters,
  FilterBar,
  Pagination,
  SearchFilter,
  SelectFilter,
} from '@/components/ui/filters';
import { TransitionButton } from '@/components/ui/transition-button';
import { DocumentComposer } from '@/components/orders/document-composer';
import { getProducts, getSession, getTransfers, getWarehouses } from '@/lib/queries';
import { bulkTransfersAction } from '@/lib/actions/bulk';
import { formatDate, formatNumber } from '@/lib/format';
import { createTransferAction } from '@/lib/actions/orders';

export const metadata: Metadata = { title: 'Transfers' };

const STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'IN_TRANSIT', label: 'In transit' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; page?: string; status?: string ; pageSize?: string; sortBy?: string; sortDir?: string }>;
}) {
  const params = await searchParams;
  const page = Number(params.page ?? 1);
  // Clamped to the API's own cap so a hand-edited URL cannot force a huge scan.
  const pageSize = Math.min(Number(params.pageSize ?? 20) || 20, 100);

  const [session, transfers, products, warehouses] = await Promise.all([
    getSession(),
    getTransfers({ search: params.search, page, pageSize, status: params.status }),
    getProducts({ pageSize, sortBy: 'name', sortDir: 'asc' }),
    getWarehouses(),
  ]);

  const canTransfer = (session.permissions as string[]).includes('stock:transfer');

  return (
    <>
      <PageHeader
        title="Stock transfers"
        description="Warehouse-to-warehouse moves. Stock leaves the source on dispatch and arrives on receipt, so goods in transit are correctly absent from both sites."
        action={
          canTransfer ? (
            <DocumentComposer
              kind="transfer"
              trigger="New transfer"
              title="Create a stock transfer"
              description="Raised as a draft. Dispatch removes stock from the source; receiving adds it to the destination."
              action={createTransferAction}
              products={products.items.map((product) => ({
                id: product.id,
                label: `${product.sku} — ${product.name}`,
                unitPrice: product.unitPrice,
                unit: product.unit,
              }))}
              warehouses={warehouses.items.map((warehouse) => ({
                id: warehouse.id,
                label: `${warehouse.code} — ${warehouse.name}`,
              }))}
            />
          ) : null
        }
      />

      <FilterBar>
        <SearchFilter placeholder="Search by transfer code" />
        <SelectFilter
          name="status"
          label="Status"
          allLabel="All statuses"
          options={STATUS_OPTIONS}
        />
        <ClearFilters />
      </FilterBar>

      <BulkProvider allIds={transfers.items.map((row) => row.id)}>
        <Card>
          <Table>
          <thead>
            <tr>
              {canTransfer ? <BulkTh /> : null}
              <Th>Transfer</Th>
              <Th>Route</Th>
              <Th>Items</Th>
              <Th align="right">Units</Th>
              <Th>Status</Th>
              <Th>Raised</Th>
              {canTransfer ? <Th align="right">Actions</Th> : null}
            </tr>
          </thead>
          <tbody>
            {transfers.items.length === 0 ? (
              <EmptyState
                colSpan={(canTransfer ? 7 : 6) + (canTransfer ? 1 : 0)}
                title="No transfers found"
                description="Transfers move stock between two of your warehouses."
              />
            ) : (
              transfers.items.map((transfer) => {
                const units = transfer.items.reduce((sum, item) => sum + item.quantity, 0);

                return (
                  <tr key={transfer.id}>
                    {canTransfer ? (
                      <Td className="w-10">
                        <BulkRowCheckbox id={transfer.id} label={transfer.code} />
                      </Td>
                    ) : null}
                    <Td>
                      <span className="font-mono text-xs font-medium text-ink-800">
                        {transfer.code}
                      </span>
                      {transfer.notes ? (
                        <p className="mt-0.5 max-w-xs truncate text-[11px] text-ink-400">
                          {transfer.notes}
                        </p>
                      ) : null}
                    </Td>
                    <Td className="font-mono text-xs whitespace-nowrap text-ink-600">
                      {transfer.sourceWarehouse.code}
                      <span aria-hidden className="mx-1 text-ink-300">
                        →
                      </span>
                      {transfer.destinationWarehouse.code}
                    </Td>
                    <Td className="text-ink-500">
                      {transfer.items.length === 1
                        ? transfer.items[0]?.product.name
                        : `${transfer.items.length} products`}
                    </Td>
                    <Td align="right">{formatNumber(units)}</Td>
                    <Td>
                      <StatusBadge status={transfer.status} />
                    </Td>
                    <Td className="text-xs whitespace-nowrap text-ink-500">
                      {formatDate(transfer.createdAt)}
                      <p className="text-[11px] text-ink-400">
                        {transfer.createdBy?.fullName ?? '—'}
                      </p>
                    </Td>
                    {canTransfer ? (
                      <Td align="right">
                        <div className="flex justify-end gap-1.5">
                          {transfer.status === 'DRAFT' ? (
                            <>
                              <TransitionButton
                                resource="transfers"
                                id={transfer.id}
                                transition="dispatch"
                                label="Dispatch"
                                variant="primary"
                              />
                              <TransitionButton
                                resource="transfers"
                                id={transfer.id}
                                transition="cancel"
                                label="Cancel"
                                confirm={`Cancel transfer ${transfer.code}?`}
                              />
                            </>
                          ) : null}
                          {transfer.status === 'IN_TRANSIT' ? (
                            <>
                              <TransitionButton
                                resource="transfers"
                                id={transfer.id}
                                transition="receive"
                                label="Receive"
                                variant="primary"
                              />
                              <TransitionButton
                                resource="transfers"
                                id={transfer.id}
                                transition="cancel"
                                label="Cancel"
                                confirm={`Cancel ${transfer.code}? Stock will be returned to ${transfer.sourceWarehouse.code}.`}
                              />
                            </>
                          ) : null}
                          {['COMPLETED', 'CANCELLED'].includes(transfer.status) ? (
                            <span className="text-xs text-ink-300">—</span>
                          ) : null}
                        </div>
                      </Td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
          </Table>

          <Pagination
          page={transfers.meta.page}
          totalPages={transfers.meta.totalPages}
          totalItems={transfers.meta.totalItems}
          pageSize={pageSize}
          />
        </Card>

        {canTransfer ? (
          <BulkActionBar
            noun="transfer"
            action={bulkTransfersAction}
            actions={[{ value: 'dispatch', label: 'Dispatch' }, { value: 'receive', label: 'Receive' }, { value: 'cancel', label: 'Cancel', confirm: 'Cancel the selected transfers?' }]}
          />
        ) : null}
      </BulkProvider>
    </>
  );
}
