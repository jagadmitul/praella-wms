import type { Metadata } from 'next';
import Link from 'next/link';
import { MovementTrend } from '@/components/charts/movement-trend';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
  buttonClass,
} from '@/components/ui';
import { getDashboard } from '@/lib/queries';
import {
  formatCompactCurrency,
  formatNumber,
  formatRelative,
  humanise,
} from '@/lib/format';

export const metadata: Metadata = { title: 'Dashboard' };

const MOVEMENT_TONE = {
  INBOUND: 'positive',
  TRANSFER_IN: 'positive',
  OUTBOUND: 'brand',
  TRANSFER_OUT: 'brand',
  ADJUSTMENT: 'warning',
} as const;

export default async function DashboardPage() {
  const summary = await getDashboard();

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Inventory position across every warehouse you can see."
        action={
          <Link href="/low-stock" className={buttonClass('secondary')}>
            Review replenishment
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Units on hand"
          value={formatNumber(summary.totalUnits)}
          hint={`${summary.productCount} active products`}
        />
        <StatTile
          label="Inventory value"
          value={formatCompactCurrency(summary.inventoryValue)}
          hint="Quantity × unit price"
        />
        <StatTile
          label="Below threshold"
          value={formatNumber(summary.lowStockCount)}
          hint="Product / warehouse lines"
          tone={summary.lowStockCount > 0 ? 'warning' : 'positive'}
        />
        <StatTile
          label="Open orders"
          value={formatNumber(summary.openPurchaseOrders + summary.openSalesOrders)}
          hint={`${summary.openPurchaseOrders} inbound · ${summary.openSalesOrders} outbound`}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader
            title="Stock movement"
            description={`${formatNumber(summary.movementsLast7Days)} movements in the last 7 days`}
          />
          <MovementTrend data={summary.movementTrend} />
        </Card>

        <Card>
          <CardHeader
            title="Needs reordering"
            description="Most urgent shortfalls first"
            action={
              <Link
                href="/low-stock"
                className="text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                View all
              </Link>
            }
          />
          <Table>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Site</Th>
                <Th align="right">On hand</Th>
                <Th align="right">Short by</Th>
              </tr>
            </thead>
            <tbody>
              {summary.topLowStock.length === 0 ? (
                <EmptyState
                  colSpan={4}
                  title="Every line is above its threshold"
                  description="Nothing needs reordering right now."
                />
              ) : (
                summary.topLowStock.map((item) => (
                  <tr key={`${item.productId}-${item.warehouseId}`}>
                    <Td>
                      <p className="font-medium text-ink-800">{item.productName}</p>
                      <p className="font-mono text-[11px] text-ink-400">{item.sku}</p>
                    </Td>
                    <Td>
                      <span className="font-mono text-xs">{item.warehouseCode}</span>
                    </Td>
                    <Td align="right">{formatNumber(item.quantity)}</Td>
                    <Td align="right">
                      <span className="font-medium text-warning-700">
                        {formatNumber(item.shortfall)}
                      </span>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Recent activity"
          description="The last entries in the stock ledger"
          action={
            <Link
              href="/movements"
              className="text-xs font-medium text-brand-600 hover:text-brand-700"
            >
              Full history
            </Link>
          }
        />
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Type</Th>
              <Th>Product</Th>
              <Th>Warehouse</Th>
              <Th align="right">Qty</Th>
              <Th align="right">Balance after</Th>
              <Th>Recorded by</Th>
            </tr>
          </thead>
          <tbody>
            {summary.recentMovements.length === 0 ? (
              <EmptyState
                colSpan={7}
                title="No stock movements yet"
                description="Receive a purchase order or record a movement to get started."
              />
            ) : (
              summary.recentMovements.map((movement) => {
                const isInbound =
                  movement.type === 'INBOUND' || movement.type === 'TRANSFER_IN';
                const site = isInbound
                  ? movement.destinationWarehouse
                  : movement.sourceWarehouse;

                return (
                  <tr key={movement.id}>
                    <Td className="whitespace-nowrap text-ink-500">
                      {formatRelative(movement.createdAt)}
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
                    <Td>
                      <span className="font-mono text-xs">{site?.code ?? '—'}</span>
                    </Td>
                    <Td align="right">
                      <span
                        className={
                          isInbound ? 'text-positive-700' : 'text-ink-700'
                        }
                      >
                        {isInbound ? '+' : '−'}
                        {formatNumber(movement.quantity)}
                      </span>
                    </Td>
                    <Td align="right">{formatNumber(movement.balanceAfter)}</Td>
                    <Td className="text-ink-500">{movement.createdBy?.fullName ?? '—'}</Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
