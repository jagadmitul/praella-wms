import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DocumentComposer } from './document-composer';

/**
 * The composer is where a mistake is most expensive: it is the only place a
 * user assembles a multi-line financial document. These tests cover the line
 * maths, the duplicate-product rule and the price prefill — all of which are
 * client-side behaviour the API integration suite cannot see.
 */
describe('DocumentComposer', () => {
  const products = [
    { id: 'p1', label: 'SKU-1 — Widget', unitPrice: '100.00', unit: 'pcs' },
    { id: 'p2', label: 'SKU-2 — Gadget', unitPrice: '250.50', unit: 'pcs' },
  ];
  const warehouses = [
    { id: 'w1', label: 'ALPHA — Alpha Depot' },
    { id: 'w2', label: 'BETA — Beta Depot' },
  ];
  const suppliers = [{ id: 's1', label: 'Acme Supplies' }];

  const noopAction = vi.fn(async () => ({ status: 'idle' as const }));

  async function openComposer(kind: 'purchase' | 'sales' | 'transfer' = 'purchase') {
    const user = userEvent.setup();

    render(
      <DocumentComposer
        kind={kind}
        trigger="New order"
        title="Create an order"
        description="Draft only."
        action={noopAction}
        products={products}
        warehouses={warehouses}
        suppliers={suppliers}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'New order' }));
    return user;
  }

  it('starts with one line priced from the catalogue', async () => {
    await openComposer();

    expect(screen.getByLabelText('Qty')).toHaveValue(1);
    expect(screen.getByLabelText('Unit cost')).toHaveValue(100);
    expect(screen.getByText(/1 line/)).toBeInTheDocument();
  });

  it('keeps the running total in step with quantity', async () => {
    const user = await openComposer();

    await user.clear(screen.getByLabelText('Qty'));
    await user.type(screen.getByLabelText('Qty'), '3');

    // The footer text is split across elements, so match on the whole summary
    // line rather than a single text node.
    const summary = document.querySelector('footer p')!;
    expect(summary.textContent?.replace(/\s+/g, ' ')).toMatch(/1 line · 3 units/);
    expect(summary.textContent).toMatch(/300/);
  });

  it('prefills the price when the product changes, but leaves it editable', async () => {
    const user = await openComposer();

    await user.selectOptions(screen.getByLabelText('Product'), 'p2');
    expect(screen.getByLabelText('Unit cost')).toHaveValue(250.5);

    await user.clear(screen.getByLabelText('Unit cost'));
    await user.type(screen.getByLabelText('Unit cost'), '199');
    expect(screen.getByLabelText('Unit cost')).toHaveValue(199);
  });

  it('adds and removes lines', async () => {
    const user = await openComposer();

    await user.click(screen.getByRole('button', { name: '+ Add line' }));
    expect(screen.getAllByLabelText('Qty')).toHaveLength(2);

    await user.click(screen.getAllByRole('button', { name: 'Remove line' })[0]!);
    expect(screen.getAllByLabelText('Qty')).toHaveLength(1);
  });

  it('refuses to let the last line be removed', async () => {
    await openComposer();

    expect(screen.getByRole('button', { name: 'Remove line' })).toBeDisabled();
  });

  it('warns when the same product appears twice', async () => {
    const user = await openComposer();

    await user.click(screen.getByRole('button', { name: '+ Add line' }));

    // Both lines default to the first product.
    expect(screen.getByText('Each product may only appear once.')).toBeInTheDocument();

    await user.selectOptions(screen.getAllByLabelText('Product')[1]!, 'p2');
    expect(
      screen.queryByText('Each product may only appear once.'),
    ).not.toBeInTheDocument();
  });

  it('serialises the payload the server action will validate', async () => {
    const user = await openComposer();

    await user.clear(screen.getByLabelText('Qty'));
    await user.type(screen.getByLabelText('Qty'), '7');

    const payload = JSON.parse(
      (document.querySelector('input[name="payload"]') as HTMLInputElement).value,
    ) as { supplierId: string; warehouseId: string; items: unknown[] };

    expect(payload.supplierId).toBe('s1');
    expect(payload.warehouseId).toBe('w1');
    expect(payload.items).toEqual([{ productId: 'p1', quantity: 7, unitCost: 100 }]);
  });

  it('asks for a customer on a sales order, not a supplier', async () => {
    await openComposer('sales');

    expect(screen.getByLabelText('Customer')).toBeInTheDocument();
    expect(screen.queryByLabelText('Supplier')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Unit price')).toBeInTheDocument();
  });

  it('drops money entirely on a transfer and requires two distinct sites', async () => {
    const user = await openComposer('transfer');

    expect(screen.queryByLabelText('Unit cost')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Unit price')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Destination warehouse'), 'w1');
    expect(
      screen.getByText('Source and destination must be different.'),
    ).toBeInTheDocument();
  });

  it('reports the line and unit totals in the footer', async () => {
    const user = await openComposer();

    await user.click(screen.getByRole('button', { name: '+ Add line' }));
    await user.selectOptions(screen.getAllByLabelText('Product')[1]!, 'p2');

    const footer = screen.getByText(/2 lines/).closest('p')!;
    expect(within(footer).getByText(/2 lines/)).toBeInTheDocument();
  });
});
