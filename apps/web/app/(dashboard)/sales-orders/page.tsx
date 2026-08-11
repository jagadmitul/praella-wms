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
import { getProducts, getSalesOrders, getSession, getWarehouses } from '@/lib/queries';
import { bulkSalesOrdersAction } from '@/lib/actions/bulk';
import { formatCurrency, formatDate, formatNumber } from '@/lib/format';
import { createSalesOrderAction } from '@/lib/actions/orders';

export const metadata: Metadata = { title: 'Sales orders' };

const STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'ALLOCATED', label: 'Allocated' },
  { value: 'PARTIALLY_FULFILLED', label: 'Partially fulfilled' },
  { value: 'FULFILLED', label: 'Fulfilled' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export default async function SalesOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; page?: string; status?: string ; pageSize?: string; sortBy?: string; sortDir?: string }>;
}) {
  const params = await searchParams;
  const page = Number(params.page ?? 1);
  // Clamped to the API's own cap so a hand-edited URL cannot force a huge scan.
  const pageSize = Math.min(Number(params.pageSize ?? 20) || 20, 100);

  const [session, orders, products, warehouses] = await Promise.all([
    getSession(),
    getSalesOrders({ search: params.search, page, pageSize, status: params.status }),
    getProducts({ pageSize, sortBy: 'name', sortDir: 'asc' }),
    getWarehouses(),
  ]);

  const permissions = session.permissions as string[];
  const canManage = permissions.includes('sales_order:manage');
  const canFulfill = permissions.includes('sales_order:fulfill');
  const showActions = canManage || canFulfill;

  return (
    <>
      <PageHeader
        title="Sales orders"
        description="Outbound stock. Allocating reserves units without moving them, so two orders can never promise the same last item; fulfilment turns that reservation into a real dispatch."
        action={
          canManage ? (
            <DocumentComposer
              kind="sales"
              trigger="New sales order"
              title="Create a sales order"
              description="Raised as a draft. Allocate it to reserve stock, then fulfil to ship."
              action={createSalesOrderAction}
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
        <SearchFilter placeholder="Search by order code or customer" />
        <SelectFilter
          name="status"
          label="Status"
          allLabel="All statuses"
          options={STATUS_OPTIONS}
        />
        <ClearFilters />
      </FilterBar>

      <BulkProvider allIds={orders.items.map((row) => row.id)}>
        <Card>
          <Table>
          <thead>
            <tr>
              {canManage ? <BulkTh /> : null}
              <Th>Order</Th>
              <Th>Customer</Th>
              <Th>Ships from</Th>
              <Th align="right">Ordered</Th>
              <Th align="right">Shipped</Th>
              <Th align="right">Value</Th>
              <Th>Status</Th>
              <Th>Raised</Th>
              {showActions ? <Th align="right">Actions</Th> : null}
            </tr>
          </thead>
          <tbody>
            {orders.items.length === 0 ? (
              <EmptyState
                colSpan={(showActions ? 9 : 8) + (showActions ? 1 : 0)}
                title="No sales orders found"
                description="Sales orders dispatch stock out of a warehouse to a customer."
              />
            ) : (
              orders.items.map((order) => {
                const ordered = order.items.reduce((sum, item) => sum + item.quantity, 0);
                const shipped = order.items.reduce(
                  (sum, item) => sum + item.fulfilledQuantity,
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
                    <Td>
                      <p className="text-ink-700">{order.customerName}</p>
                      {order.customerEmail ? (
                        <p className="text-[11px] text-ink-400">{order.customerEmail}</p>
                      ) : null}
                    </Td>
                    <Td>
                      <span className="font-mono text-xs">{order.warehouse.code}</span>
                    </Td>
                    <Td align="right">{formatNumber(ordered)}</Td>
                    <Td align="right">
                      <span
                        className={
                          shipped === ordered
                            ? 'text-positive-700'
                            : shipped > 0
                              ? 'text-warning-700'
                              : 'text-ink-300'
                        }
                      >
                        {formatNumber(shipped)}
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
                                resource="sales-orders"
                                id={order.id}
                                transition="allocate"
                                label="Allocate"
                                variant="primary"
                              />
                              <TransitionButton
                                resource="sales-orders"
                                id={order.id}
                                transition="cancel"
                                label="Cancel"
                                confirm={`Cancel ${order.code}?`}
                              />
                            </>
                          ) : null}
                          {['ALLOCATED', 'PARTIALLY_FULFILLED'].includes(order.status) ? (
                            <>
                              {canFulfill ? (
                                <TransitionButton
                                  resource="sales-orders"
                                  id={order.id}
                                  transition="fulfill"
                                  label="Ship all"
                                  variant="primary"
                                />
                              ) : null}
                              {canManage ? (
                                <TransitionButton
                                  resource="sales-orders"
                                  id={order.id}
                                  transition="cancel"
                                  label="Cancel"
                                  confirm={`Cancel ${order.code}? Reserved stock will be released.`}
                                />
                              ) : null}
                            </>
                          ) : null}
                          {['FULFILLED', 'CANCELLED'].includes(order.status) ? (
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
          pageSize={pageSize}
          />
        </Card>

        {canManage ? (
          <BulkActionBar
            noun="order"
            action={bulkSalesOrdersAction}
            actions={[{ value: 'allocate', label: 'Allocate stock' }, { value: 'fulfill', label: 'Ship in full' }, { value: 'cancel', label: 'Cancel', confirm: 'Cancel the selected orders?' }]}
          />
        ) : null}
      </BulkProvider>
    </>
  );
}
