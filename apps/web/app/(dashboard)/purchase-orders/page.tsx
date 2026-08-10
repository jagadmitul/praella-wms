import type { Metadata } from 'next';
import { Card, EmptyState, PageHeader, StatusBadge, Table, Td, Th } from '@/components/ui';
import { Pagination, SearchFilter, SelectFilter } from '@/components/ui/filters';
import { TransitionButton } from '@/components/ui/transition-button';
import { getPurchaseOrders, getSession } from '@/lib/queries';
import { formatCurrency, formatDate, formatNumber } from '@/lib/format';

export const metadata: Metadata = { title: 'Purchase orders' };

const STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'PARTIALLY_RECEIVED', label: 'Partially received' },
  { value: 'RECEIVED', label: 'Received' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; page?: string; status?: string }>;
}) {
  const params = await searchParams;
  const page = Number(params.page ?? 1);

  const [session, orders] = await Promise.all([
    getSession(),
    getPurchaseOrders({
      search: params.search,
      page,
      pageSize: 20,
      status: params.status,
    }),
  ]);

  const permissions = session.permissions as string[];
  const canManage = permissions.includes('purchase_order:manage');
  const canReceive = permissions.includes('purchase_order:receive');
  const showActions = canManage || canReceive;

  return (
    <>
      <PageHeader
        title="Purchase orders"
        description="Inbound stock. Raising an order changes nothing; stock only moves when goods are received, and receipts can be partial."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchFilter placeholder="Search by order code or supplier" />
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
              <Th>Order</Th>
              <Th>Supplier</Th>
              <Th>Destination</Th>
              <Th align="right">Ordered</Th>
              <Th align="right">Received</Th>
              <Th align="right">Value</Th>
              <Th>Status</Th>
              <Th>Raised</Th>
              {showActions ? <Th align="right">Actions</Th> : null}
            </tr>
          </thead>
          <tbody>
            {orders.items.length === 0 ? (
              <EmptyState
                colSpan={showActions ? 9 : 8}
                title="No purchase orders found"
                description="Purchase orders bring stock into a warehouse from a supplier."
              />
            ) : (
              orders.items.map((order) => {
                const ordered = order.items.reduce((sum, item) => sum + item.quantity, 0);
                const received = order.items.reduce(
                  (sum, item) => sum + item.receivedQuantity,
                  0,
                );

                return (
                  <tr key={order.id}>
                    <Td>
                      <span className="font-mono text-xs font-medium text-ink-800">
                        {order.code}
                      </span>
                      <p className="text-[11px] text-ink-400">
                        {order.items.length} line{order.items.length === 1 ? '' : 's'}
                      </p>
                    </Td>
                    <Td className="text-ink-600">{order.supplier.name}</Td>
                    <Td>
                      <span className="font-mono text-xs">{order.warehouse.code}</span>
                    </Td>
                    <Td align="right">{formatNumber(ordered)}</Td>
                    <Td align="right">
                      <span
                        className={
                          received === ordered
                            ? 'text-positive-700'
                            : received > 0
                              ? 'text-warning-700'
                              : 'text-ink-300'
                        }
                      >
                        {formatNumber(received)}
                      </span>
                    </Td>
                    <Td align="right">{formatCurrency(order.totalAmount)}</Td>
                    <Td>
                      <StatusBadge status={order.status} />
                    </Td>
                    <Td className="text-xs whitespace-nowrap text-ink-500">
                      {formatDate(order.createdAt)}
                    </Td>
                    {showActions ? (
                      <Td align="right">
                        <div className="flex justify-end gap-1.5">
                          {order.status === 'DRAFT' && canManage ? (
                            <>
                              <TransitionButton
                                resource="purchase-orders"
                                id={order.id}
                                transition="submit"
                                label="Submit"
                                variant="primary"
                              />
                              <TransitionButton
                                resource="purchase-orders"
                                id={order.id}
                                transition="cancel"
                                label="Cancel"
                                confirm={`Cancel ${order.code}?`}
                              />
                            </>
                          ) : null}
                          {['SUBMITTED', 'PARTIALLY_RECEIVED'].includes(order.status) &&
                          canReceive ? (
                            <TransitionButton
                              resource="purchase-orders"
                              id={order.id}
                              transition="receive"
                              label="Receive all"
                              variant="primary"
                            />
                          ) : null}
                          {['RECEIVED', 'CANCELLED'].includes(order.status) ? (
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
          page={orders.meta.page}
          totalPages={orders.meta.totalPages}
          totalItems={orders.meta.totalItems}
        />
      </Card>
    </>
  );
}
