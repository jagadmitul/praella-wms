'use server';

import { revalidatePath } from 'next/cache';
import {
  adjustStockSchema,
  createProductSchema,
  createWarehouseSchema,
  recordMovementSchema,
  setReplenishmentRuleSchema,
} from '@wms/contracts';
import { ApiError, apiFetch } from '../api';
import type { ActionState } from './types';

/**
 * Runs a mutation and turns any failure into form state.
 *
 * Validation runs against the shared Zod schema first, so the browser reports
 * obvious mistakes without a round trip; the API validates again regardless,
 * because a Server Action is still a public endpoint.
 */
async function run(
  mutate: () => Promise<unknown>,
  successMessage: string,
  revalidate: string[],
): Promise<ActionState> {
  try {
    await mutate();
  } catch (error: unknown) {
    if (error instanceof ApiError) {
      return {
        status: 'error',
        message: error.message,
        ...(error.details
          ? {
              fieldErrors: error.details.reduce<Record<string, string>>(
                (errors, detail) => {
                  errors[detail.path] ??= detail.message;
                  return errors;
                },
                {},
              ),
            }
          : {}),
      };
    }

    return { status: 'error', message: 'Something went wrong. Please try again.' };
  }

  for (const path of revalidate) {
    revalidatePath(path);
  }

  return { status: 'success', message: successMessage };
}

function fieldErrorsFrom(issues: Array<{ path: PropertyKey[]; message: string }>) {
  return issues.reduce<Record<string, string>>((errors, issue) => {
    const key = String(issue.path[0] ?? 'form');
    errors[key] ??= issue.message;
    return errors;
  }, {});
}

/* -------------------------------- Warehouses ------------------------------ */

export async function createWarehouseAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = createWarehouseSchema.safeParse({
    name: formData.get('name'),
    code: formData.get('code'),
    city: formData.get('city') || undefined,
    state: formData.get('state') || undefined,
    country: formData.get('country') || undefined,
    addressLine1: formData.get('addressLine1') || undefined,
    notes: formData.get('notes') || undefined,
  });

  if (!parsed.success) {
    return { status: 'error', fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }

  return run(
    () => apiFetch('/warehouses', { method: 'POST', body: parsed.data }),
    `Warehouse "${parsed.data.name}" created.`,
    ['/warehouses', '/'],
  );
}

export async function deleteWarehouseAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get('warehouseId') ?? '');
  if (!id) return { status: 'error', message: 'Missing warehouse.' };

  let outcome: { archived?: boolean; message?: string } = {};

  const state = await run(
    async () => {
      outcome = await apiFetch<{ archived: boolean; message: string }>(
        `/warehouses/${id}`,
        { method: 'DELETE' },
      );
    },
    '',
    ['/warehouses', '/'],
  );

  // The API decides between deleting and archiving, so report what it did
  // rather than assuming.
  return state.status === 'success'
    ? { status: 'success', message: outcome.message ?? 'Warehouse removed.' }
    : state;
}

/* --------------------------------- Products ------------------------------- */

export async function createProductAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = createProductSchema.safeParse({
    name: formData.get('name'),
    sku: formData.get('sku'),
    unitPrice: Number(formData.get('unitPrice')),
    unit: formData.get('unit') || 'pcs',
    categoryId: formData.get('categoryId') || undefined,
    supplierId: formData.get('supplierId') || undefined,
    description: formData.get('description') || undefined,
    defaultReorderPoint: Number(formData.get('defaultReorderPoint') ?? 0),
    defaultReorderQuantity: Number(formData.get('defaultReorderQuantity') ?? 0),
  });

  if (!parsed.success) {
    return { status: 'error', fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }

  return run(
    () => apiFetch('/products', { method: 'POST', body: parsed.data }),
    `Product "${parsed.data.name}" created.`,
    ['/products', '/inventory', '/'],
  );
}

/* ---------------------------------- Stock --------------------------------- */

export async function recordMovementAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = recordMovementSchema.safeParse({
    productId: formData.get('productId'),
    warehouseId: formData.get('warehouseId'),
    type: formData.get('type'),
    quantity: Number(formData.get('quantity')),
    note: formData.get('note') || undefined,
  });

  if (!parsed.success) {
    return { status: 'error', fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }

  return run(
    () => apiFetch('/stock/movements', { method: 'POST', body: parsed.data }),
    `Recorded ${parsed.data.quantity} unit(s) ${parsed.data.type === 'INBOUND' ? 'in' : 'out'}.`,
    ['/inventory', '/movements', '/low-stock', '/'],
  );
}

export async function adjustStockAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = adjustStockSchema.safeParse({
    productId: formData.get('productId'),
    warehouseId: formData.get('warehouseId'),
    delta: Number(formData.get('delta')),
    reason: formData.get('reason'),
  });

  if (!parsed.success) {
    return { status: 'error', fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }

  return run(
    () => apiFetch('/stock/adjustments', { method: 'POST', body: parsed.data }),
    `Stock adjusted by ${parsed.data.delta > 0 ? '+' : ''}${parsed.data.delta}.`,
    ['/inventory', '/movements', '/low-stock', '/'],
  );
}

export async function setReplenishmentRuleAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = setReplenishmentRuleSchema.safeParse({
    productId: formData.get('productId'),
    warehouseId: formData.get('warehouseId'),
    reorderPoint: Number(formData.get('reorderPoint')),
    reorderQuantity: Number(formData.get('reorderQuantity')),
  });

  if (!parsed.success) {
    return { status: 'error', fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }

  return run(
    () => apiFetch('/stock/replenishment-rules', { method: 'PUT', body: parsed.data }),
    'Replenishment rule saved.',
    ['/inventory', '/low-stock', '/'],
  );
}

/* -------------------------- Document state changes ------------------------ */

/**
 * Advances a document through its lifecycle — dispatch a transfer, receive a
 * purchase order, fulfil a sales order, and so on.
 *
 * One action covers them all because the API models every transition the same
 * way: a POST to `/{resource}/{id}/{transition}` with no body.
 */
export async function documentTransitionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const resource = String(formData.get('resource') ?? '');
  const id = String(formData.get('id') ?? '');
  const transition = String(formData.get('transition') ?? '');

  const allowed: Record<string, string[]> = {
    transfers: ['dispatch', 'receive', 'cancel'],
    'purchase-orders': ['submit', 'receive', 'cancel'],
    'sales-orders': ['allocate', 'fulfill', 'cancel'],
  };

  if (!allowed[resource]?.includes(transition)) {
    return { status: 'error', message: 'Unsupported action.' };
  }

  return run(
    () =>
      apiFetch(`/${resource}/${id}/${transition}`, { method: 'POST', body: {} }),
    `${transition.charAt(0).toUpperCase()}${transition.slice(1)} completed.`,
    [`/${resource}`, '/inventory', '/movements', '/low-stock', '/'],
  );
}
