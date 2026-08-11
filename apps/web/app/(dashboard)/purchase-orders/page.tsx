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
import {
  getProducts,
  getPurchaseOrders,
  getSession,
  getSuppliers,
  getWarehouses,
} from '@/lib/queries';
import { bulkPurchaseOrdersAction } from '@/lib/actions/bulk';
import { formatCurrency, formatDate, formatNumber } from '@/lib/format';
import { createPurchaseOrderAction } from '@/lib/actions/orders';

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
  searchParams: Promise<{ search?: string; page?: string; status?: string ; pageSize?: string; sortBy?: string; sortDir?: string }>;
}) {
  const params = await searchParams;
  const page = Number(params.page ?? 1);
  // Clamped to the API's own cap so a hand-edited URL cannot force a huge scan.
  const pageSize = Math.min(Number(params.pageSize ?? 20) || 20, 100);

  const [session, orders, products, warehouses, suppliers] = await Promise.all([
    getSession(),
    getPurchaseOrders({
      search: params.search,
      page,
      pageSize,
      status: params.status,
    }),
    getProducts({ pageSize, sortBy: 'name', sortDir: 'asc' }),
    getWarehouses(),
    getSuppliers(),
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
        action={
          canManage ? (
            <DocumentComposer
              kind="purchase"
              trigger="New purchase order"
              title="Create a purchase order"
              description="Raised as a draft. Stock only changes when the goods are received."
              action={createPurchaseOrderAction}
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
              suppliers={suppliers.items.map((supplier) => ({
                id: supplier.id,
                label: supplier.name,
              }))}
            />
          ) : null
        }
      />

      <FilterBar>
        <SearchFilter placeholder="Search by order code or supplier" />
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
                colSpan={(showActions ? 9 : 8) + (showActions ? 1 : 0)}
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
          pageSize={pageSize}
          />
        </Card>

        {canManage ? (
          <BulkActionBar
            noun="order"
            action={bulkPurchaseOrdersAction}
            actions={[{ value: 'submit', label: 'Submit to supplier' }, { value: 'receive', label: 'Receive in full' }, { value: 'cancel', label: 'Cancel', confirm: 'Cancel the selected orders?' }]}
          />
        ) : null}
      </BulkProvider>
    </>
  );
}
