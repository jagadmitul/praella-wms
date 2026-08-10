import type { Metadata } from 'next';
import type { WarehouseView } from '@wms/contracts';
import { Badge, Card, EmptyState, Label, PageHeader, Table, Td, Th } from '@/components/ui';
import { DeleteWarehouseButton } from '@/components/warehouses/delete-warehouse-button';
import { DialogForm, FieldError } from '@/components/ui/dialog-form';
import { SearchFilter } from '@/components/ui/filters';
import { createWarehouseAction } from '@/lib/actions/inventory';
import { getSession, getWarehouses } from '@/lib/queries';
import { formatNumber } from '@/lib/format';

export const metadata: Metadata = { title: 'Warehouses' };

export default async function WarehousesPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>;
}) {
  const { search } = await searchParams;
  const [session, warehouses] = await Promise.all([
    getSession(),
    getWarehouses({ search }),
  ]);

  const can = (permission: string) =>
    (session.permissions as string[]).includes(permission);

  return (
    <>
      <PageHeader
        title="Warehouses"
        description={
          session.warehouseScope
            ? 'You are assigned to the warehouses shown below.'
            : 'Every site in the organisation, with live stock statistics.'
        }
        action={
          can('warehouse:create') ? (
            <DialogForm
              trigger="New warehouse"
              title="Create a warehouse"
              description="Codes are stored in uppercase and must be unique within your organisation."
              action={createWarehouseAction}
              submitLabel="Create warehouse"
            >
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="name">Name</Label>
                      <input id="name" name="name" className="field" placeholder="Surat Central Hub" />
                      <FieldError name="name" />
                    </div>
                    <div>
                      <Label htmlFor="code">Code</Label>
                      <input id="code" name="code" className="field" placeholder="SRT-HUB" />
                      <FieldError name="code" />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="addressLine1">Address</Label>
                    <input
                      id="addressLine1"
                      name="addressLine1"
                      className="field"
                      placeholder="Plot 44, Sachin GIDC"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <Label htmlFor="city">City</Label>
                      <input id="city" name="city" className="field" />
                    </div>
                    <div>
                      <Label htmlFor="state">State</Label>
                      <input id="state" name="state" className="field" />
                    </div>
                    <div>
                      <Label htmlFor="country">Country</Label>
                      <input id="country" name="country" className="field" defaultValue="India" />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="notes" hint="— optional">
                      Notes
                    </Label>
                    <textarea id="notes" name="notes" rows={2} className="field" />
                  </div>
            </DialogForm>
          ) : null
        }
      />

      <div className="mb-4">
        <SearchFilter placeholder="Search by name, code or city" />
      </div>

      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Warehouse</Th>
              <Th>Location</Th>
              <Th align="right">Products</Th>
              <Th align="right">Units on hand</Th>
              <Th align="right">Below threshold</Th>
              <Th>Status</Th>
              {can('warehouse:delete') ? <Th align="right">Actions</Th> : null}
            </tr>
          </thead>
          <tbody>
            {warehouses.items.length === 0 ? (
              <EmptyState
                colSpan={can('warehouse:delete') ? 7 : 6}
                title="No warehouses found"
                description={
                  search
                    ? 'Try a different search term.'
                    : 'Create your first warehouse to start tracking stock.'
                }
              />
            ) : (
              warehouses.items.map((warehouse: WarehouseView) => (
                <tr key={warehouse.id}>
                  <Td>
                    <p className="font-medium text-ink-800">{warehouse.name}</p>
                    <p className="font-mono text-[11px] text-ink-400">{warehouse.code}</p>
                  </Td>
                  <Td className="text-ink-500">
                    {[warehouse.city, warehouse.state, warehouse.country]
                      .filter(Boolean)
                      .join(', ') || '—'}
                  </Td>
                  <Td align="right">{formatNumber(warehouse.stats.productCount)}</Td>
                  <Td align="right">{formatNumber(warehouse.stats.totalUnits)}</Td>
                  <Td align="right">
                    {warehouse.stats.lowStockCount > 0 ? (
                      <span className="font-medium text-warning-700">
                        {formatNumber(warehouse.stats.lowStockCount)}
                      </span>
                    ) : (
                      <span className="text-ink-300">0</span>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={warehouse.isActive ? 'positive' : 'neutral'}>
                      {warehouse.isActive ? 'Active' : 'Archived'}
                    </Badge>
                  </Td>
                  {can('warehouse:delete') ? (
                    <Td align="right">
                      <DeleteWarehouseButton id={warehouse.id} name={warehouse.name} />
                    </Td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>

      <p className="mt-4 max-w-3xl text-xs text-ink-400">
        Deleting a warehouse that has stock, movement history or open orders archives it
        instead of removing the row, so the stock ledger stays intact. Only a warehouse
        that has never been used is deleted outright.
      </p>
    </>
  );
}
