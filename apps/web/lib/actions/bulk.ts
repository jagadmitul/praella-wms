'use server';

import { revalidatePath } from 'next/cache';
import type { BulkResult } from '@wms/contracts';
import { ApiError, apiFetch } from '../api';
import type { ActionState } from './types';

/**
 * Bulk actions.
 *
 * The selected ids arrive as one comma-separated hidden field rather than many
 * repeated inputs: a hundred `<input name="ids">` elements is a lot of DOM for
 * something the server immediately re-joins anyway.
 */
async function runBulk(
  path: string,
  body: unknown,
  revalidate: string[],
): Promise<ActionState> {
  try {
    const result = await apiFetch<BulkResult>(path, { method: 'POST', body });

    for (const target of revalidate) {
      revalidatePath(target);
    }

    return {
      status: 'success',
      message: `${result.succeeded} of ${result.requested} updated`,
      result,
    };
  } catch (error: unknown) {
    return {
      status: 'error',
      message:
        error instanceof ApiError
          ? error.message
          : 'Something went wrong. Please try again.',
    };
  }
}

/** Reads the comma-separated id list the action bar submits. */
function readIds(formData: FormData): string[] {
  const raw = formData.get('ids');
  return typeof raw === 'string' ? raw.split(',').filter(Boolean) : [];
}

export async function bulkProductsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ids = readIds(formData);
  const action = String(formData.get('action') ?? '');

  if (ids.length === 0) return { status: 'error', message: 'Nothing selected.' };

  const body =
    action === 'activate'
      ? { ids, isActive: true }
      : action === 'archive'
        ? { ids, isActive: false }
        : null;

  if (!body) return { status: 'error', message: 'Unknown action.' };

  return runBulk('/products/bulk', body, ['/products', '/inventory', '/']);
}

/** One action shape for every document type; the resource is bound per export. */
function documentBulk(resource: 'purchase-orders' | 'sales-orders' | 'transfers') {
  return async function bulkAction(
    _previous: ActionState,
    formData: FormData,
  ): Promise<ActionState> {
    const ids = readIds(formData);
    const transition = String(formData.get('action') ?? '');

    if (ids.length === 0) return { status: 'error', message: 'Nothing selected.' };

    return runBulk(`/${resource}/bulk`, { ids, transition }, [
      `/${resource}`,
      '/inventory',
      '/movements',
      '/',
    ]);
  };
}

export const bulkPurchaseOrdersAction = documentBulk('purchase-orders');
export const bulkSalesOrdersAction = documentBulk('sales-orders');
export const bulkTransfersAction = documentBulk('transfers');
