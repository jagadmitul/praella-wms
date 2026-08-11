'use client';

import { useActionToast } from '@/lib/use-action-toast';
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { IDLE, type ActionState } from '@/lib/actions/types';
import { buttonClass, FormError, Label } from '@/components/ui';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/cn';

export interface ProductOption {
  id: string;
  label: string;
  unitPrice: string;
  unit: string;
}

export interface SelectOption {
  id: string;
  label: string;
}

/** One editable line in the composer. */
interface Line {
  key: number;
  productId: string;
  quantity: string;
  /** Unit cost (purchase) or unit price (sales). Unused for transfers. */
  amount: string;
}

export type DocumentKind = 'purchase' | 'sales' | 'transfer';

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} className={buttonClass('primary')}>
      {pending ? 'Creating…' : label}
    </button>
  );
}

/**
 * Multi-line document composer for purchase orders, sales orders and transfers.
 *
 * One component covers all three because the shape is identical — a header, a
 * repeating line editor, and a total. Only which header fields appear and
 * whether lines carry money differs, and both are a function of `kind`. Three
 * near-identical components would have been three places to fix every bug.
 *
 * Selecting a product prefills its price from the catalogue but leaves the
 * field editable: a negotiated cost that differs from list price is normal, and
 * forcing the user to retype the common case is not.
 */
export function DocumentComposer({
  kind,
  trigger,
  title,
  description,
  action,
  products,
  warehouses,
  suppliers = [],
}: {
  kind: DocumentKind;
  trigger: string;
  title: string;
  description: string;
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  products: ProductOption[];
  warehouses: SelectOption[];
  suppliers?: SelectOption[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, formAction] = useActionState(action, IDLE);
  const result = useActionToast(state, 5000);
  const toast = result?.tone === 'ok' ? (result.text || 'Created.') : null;

  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [destinationWarehouseId, setDestinationWarehouseId] = useState(
    warehouses[1]?.id ?? '',
  );
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([
    { key: 1, productId: products[0]?.id ?? '', quantity: '1', amount: products[0]?.unitPrice ?? '0' },
  ]);

  const carriesMoney = kind !== 'transfer';

  /**
   * Opens the composer on a blank document.
   *
   * The reset happens here rather than after a successful save: it is an event
   * handler, so it costs no extra render pass, and it means a draft abandoned
   * with the ✕ is not silently resurrected the next time the dialog opens.
   */
  const openComposer = (): void => {
    setLines([
      {
        key: 1,
        productId: products[0]?.id ?? '',
        quantity: '1',
        amount: products[0]?.unitPrice ?? '0',
      },
    ]);
    setCustomerName('');
    setCustomerEmail('');
    setNotes('');
    dialogRef.current?.showModal();
  };

  // Closing the dialog is imperative DOM, so it stays in an effect.
  useEffect(() => {
    if (state.status === 'success') dialogRef.current?.close();
  }, [state]);

  const total = useMemo(
    () =>
      lines.reduce(
        (sum, line) => sum + (Number(line.amount) || 0) * (Number(line.quantity) || 0),
        0,
      ),
    [lines],
  );

  const totalUnits = useMemo(
    () => lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0),
    [lines],
  );

  /** Builds the payload the server action validates against the shared schema. */
  const payload = useMemo(() => {
    const items = lines
      .filter((line) => line.productId && Number(line.quantity) > 0)
      .map((line) => ({
        productId: line.productId,
        quantity: Number(line.quantity),
        ...(kind === 'purchase' ? { unitCost: Number(line.amount) } : {}),
        ...(kind === 'sales' ? { unitPrice: Number(line.amount) } : {}),
      }));

    if (kind === 'purchase') {
      return { supplierId, warehouseId, items, ...(notes ? { notes } : {}) };
    }

    if (kind === 'sales') {
      return {
        warehouseId,
        customerName,
        ...(customerEmail ? { customerEmail } : {}),
        items,
        ...(notes ? { notes } : {}),
      };
    }

    return {
      sourceWarehouseId: warehouseId,
      destinationWarehouseId,
      items,
      ...(notes ? { notes } : {}),
    };
  }, [
    kind,
    lines,
    supplierId,
    warehouseId,
    destinationWarehouseId,
    customerName,
    customerEmail,
    notes,
  ]);

  const duplicateProduct =
    new Set(lines.map((line) => line.productId)).size !== lines.length;

  const updateLine = (key: number, patch: Partial<Line>) => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  };

  const addLine = () => {
    setLines((current) => [
      ...current,
      {
        key: Math.max(0, ...current.map((line) => line.key)) + 1,
        productId: products[0]?.id ?? '',
        quantity: '1',
        amount: products[0]?.unitPrice ?? '0',
      },
    ]);
  };

  return (
    <>
      <button
        type="button"
        className={buttonClass('primary')}
        onClick={openComposer}
      >
        {trigger}
      </button>

      {toast ? (
        <p
          role="status"
          className="fixed right-4 bottom-4 z-50 max-w-[calc(100vw-2rem)] rounded-lg border border-positive-600/20 bg-positive-50 px-4 py-2.5 text-sm text-positive-700 shadow-lg sm:right-6 sm:bottom-6"
        >
          {toast}
        </p>
      ) : null}

      <dialog
        ref={dialogRef}
        className="m-auto w-[min(52rem,calc(100vw-1.5rem))] rounded-xl border border-line bg-surface p-0 backdrop:bg-ink-900/40"
        onClick={(event) => {
          if (event.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <form action={formAction} className="flex max-h-[90vh] flex-col">
          <input type="hidden" name="payload" value={JSON.stringify(payload)} />

          <header className="border-b border-line px-5 py-4">
            <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
            <p className="mt-0.5 text-xs text-ink-500">{description}</p>
          </header>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
            {state.status === 'error' ? <FormError message={state.message} /> : null}

            {/* ------------------------------ Header ----------------------------- */}
            <div className="grid gap-4 sm:grid-cols-2">
              {kind === 'purchase' ? (
                <div>
                  <Label htmlFor="supplier">Supplier</Label>
                  <select
                    id="supplier"
                    className="field"
                    value={supplierId}
                    onChange={(event) => setSupplierId(event.target.value)}
                  >
                    {suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div>
                <Label htmlFor="warehouse">
                  {kind === 'purchase'
                    ? 'Deliver to'
                    : kind === 'sales'
                      ? 'Ship from'
                      : 'Source warehouse'}
                </Label>
                <select
                  id="warehouse"
                  className="field"
                  value={warehouseId}
                  onChange={(event) => setWarehouseId(event.target.value)}
                >
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.label}
                    </option>
                  ))}
                </select>
              </div>

              {kind === 'transfer' ? (
                <div>
                  <Label htmlFor="destination">Destination warehouse</Label>
                  <select
                    id="destination"
                    className="field"
                    value={destinationWarehouseId}
                    onChange={(event) => setDestinationWarehouseId(event.target.value)}
                  >
                    {warehouses.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.label}
                      </option>
                    ))}
                  </select>
                  {warehouseId === destinationWarehouseId ? (
                    <p className="mt-1 text-xs text-danger-700">
                      Source and destination must be different.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {kind === 'sales' ? (
                <>
                  <div>
                    <Label htmlFor="customerName">Customer</Label>
                    <input
                      id="customerName"
                      className="field"
                      value={customerName}
                      onChange={(event) => setCustomerName(event.target.value)}
                      placeholder="Aster Retail Pvt Ltd"
                    />
                  </div>
                  <div>
                    <Label htmlFor="customerEmail" hint="— optional">
                      Customer email
                    </Label>
                    <input
                      id="customerEmail"
                      type="email"
                      className="field"
                      value={customerEmail}
                      onChange={(event) => setCustomerEmail(event.target.value)}
                    />
                  </div>
                </>
              ) : null}
            </div>

            {/* ------------------------------- Lines ----------------------------- */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold tracking-wide text-ink-500 uppercase">
                  Line items
                </h3>
                <button
                  type="button"
                  onClick={addLine}
                  className={buttonClass('secondary', 'px-2.5 py-1.5 text-xs')}
                >
                  + Add line
                </button>
              </div>

              {duplicateProduct ? (
                <p className="mb-2 text-xs text-danger-700">
                  Each product may only appear once.
                </p>
              ) : null}

              <div className="space-y-2">
                {lines.map((line) => {
                  const product = products.find(
                    (candidate) => candidate.id === line.productId,
                  );

                  return (
                    <div
                      key={line.key}
                      className={cn(
                        'grid items-end gap-x-3 gap-y-2 rounded-lg border border-line bg-surface-sunken p-3',
                        carriesMoney
                          ? 'sm:grid-cols-[minmax(0,1fr)_5.5rem_7.5rem_7rem_2.25rem]'
                          : 'sm:grid-cols-[minmax(0,1fr)_6rem_3rem_2.25rem]',
                      )}
                    >
                      <div className="min-w-0">
                        <Label htmlFor={`product-${line.key}`}>Product</Label>
                        <select
                          id={`product-${line.key}`}
                          className="field"
                          value={line.productId}
                          onChange={(event) => {
                            const next = products.find(
                              (candidate) => candidate.id === event.target.value,
                            );
                            updateLine(line.key, {
                              productId: event.target.value,
                              // Prefill from the catalogue, but keep it editable.
                              ...(next && carriesMoney ? { amount: next.unitPrice } : {}),
                            });
                          }}
                        >
                          {products.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <Label htmlFor={`qty-${line.key}`}>Qty</Label>
                        <input
                          id={`qty-${line.key}`}
                          type="number"
                          min="1"
                          className="field"
                          value={line.quantity}
                          onChange={(event) =>
                            updateLine(line.key, { quantity: event.target.value })
                          }
                        />
                      </div>

                      {carriesMoney ? (
                        <>
                          <div>
                            <Label htmlFor={`amount-${line.key}`}>
                              {kind === 'purchase' ? 'Unit cost' : 'Unit price'}
                            </Label>
                            <input
                              id={`amount-${line.key}`}
                              type="number"
                              step="0.01"
                              min="0"
                              className="field"
                              value={line.amount}
                              onChange={(event) =>
                                updateLine(line.key, { amount: event.target.value })
                              }
                            />
                          </div>
                          <div className="text-right text-sm">
                            <p className="mb-1.5 text-xs text-ink-400">Line total</p>
                            <p className="tabular font-medium text-ink-800">
                              {formatCurrency(
                                (Number(line.amount) || 0) * (Number(line.quantity) || 0),
                              )}
                            </p>
                          </div>
                        </>
                      ) : (
                        <span className="hidden pb-2.5 text-xs text-ink-400 sm:block">
                          {product?.unit ?? ''}
                        </span>
                      )}

                      {/*
                        Sits on the grid baseline with the inputs rather than
                        floating in its own row, and is a real 36px target with
                        visible hover, focus and disabled states.
                      */}
                      <button
                        type="button"
                        aria-label={`Remove line ${line.key}`}
                        title="Remove line"
                        disabled={lines.length === 1}
                        onClick={() =>
                          setLines((current) =>
                            current.filter((candidate) => candidate.key !== line.key),
                          )
                        }
                        className="mt-2 grid size-9 shrink-0 place-items-center justify-self-end rounded-lg text-ink-400 transition-colors hover:bg-danger-50 hover:text-danger-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-400 sm:mt-0"
                      >
                        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden>
                          <path
                            d="M5.5 5.5l9 9m0-9l-9 9"
                            stroke="currentColor"
                            strokeWidth="1.75"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <Label htmlFor="notes" hint="— optional">
                Notes
              </Label>
              <textarea
                id="notes"
                rows={2}
                className="field"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface-sunken px-5 py-3">
            <p className="text-sm text-ink-500">
              {lines.length} line{lines.length === 1 ? '' : 's'} ·{' '}
              <span className="tabular">{totalUnits}</span> units
              {carriesMoney ? (
                <>
                  {' '}
                  ·{' '}
                  <span className="font-medium text-ink-800 tabular">
                    {formatCurrency(total)}
                  </span>
                </>
              ) : null}
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                className={buttonClass('secondary')}
                onClick={() => dialogRef.current?.close()}
              >
                Cancel
              </button>
              <SubmitButton label="Create draft" />
            </div>
          </footer>
        </form>
      </dialog>
    </>
  );
}
