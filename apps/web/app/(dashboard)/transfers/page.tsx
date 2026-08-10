import type { Metadata } from 'next';
import { Card, EmptyState, PageHeader, StatusBadge, Table, Td, Th } from '@/components/ui';
import { Pagination, SearchFilter, SelectFilter } from '@/components/ui/filters';
import { TransitionButton } from '@/components/ui/transition-button';
import { getSession, getTransfers } from '@/lib/queries';
import { formatDate, formatNumber } from '@/lib/format';

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
  searchParams: Promise<{ search?: string; page?: string; status?: string }>;
}) {
  const params = await searchParams;
  const page = Number(params.page ?? 1);

  const [session, transfers] = await Promise.all([
    getSession(),
    getTransfers({ search: params.search, page, pageSize: 20, status: params.status }),
  ]);

  const canTransfer = (session.permissions as string[]).includes('stock:transfer');

  return (
    <>
      <PageHeader
        title="Stock transfers"
        description="Warehouse-to-warehouse moves. Stock leaves the source on dispatch and arrives on receipt, so goods in transit are correctly absent from both sites."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchFilter placeholder="Search by transfer code" />
        <SelectFilter
          name="status"
          label="Status"
          allLabel="All statuses"
          options={STATUS_OPTIONS}
        />
      </div>

      <Card>
        <Table>
          <thead>
            <tr>
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
                colSpan={canTransfer ? 7 : 6}
                title="No transfers found"
                description="Transfers move stock between two of your warehouses."
              />
            ) : (
              transfers.items.map((transfer) => {
                const units = transfer.items.reduce((sum, item) => sum + item.quantity, 0);

                return (
                  <tr key={transfer.id}>
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
        />
      </Card>
    </>
  );
}
