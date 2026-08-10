'use server';

import { revalidatePath } from 'next/cache';
import {
  createPurchaseOrderSchema,
  createSalesOrderSchema,
  createTransferSchema,
} from '@wms/contracts';
import { ApiError, apiFetch } from '../api';
import type { ActionState } from './types';

/**
 * Multi-line document creation.
 *
 * The composer submits its lines as a single JSON payload in one hidden field
 * rather than as `items[0][productId]`-style form keys. Form encoding has no
 * native notion of a nested array, so the alternative is a bespoke key parser
 * on the server that then has to be kept in step with the client — for a
 * dynamic, add-and-remove line editor that is a lot of fragile plumbing to
 * reimplement badly.
 */
async function submit(
  path: string,
  payload: unknown,
  successMessage: string,
  revalidate: string[],
): Promise<ActionState> {
  try {
    await apiFetch(path, { method: 'POST', body: payload });
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

  for (const target of revalidate) {
    revalidatePath(target);
  }

  return { status: 'success', message: successMessage };
}

/** Reads and JSON-parses the composer's payload field. */
function readPayload(formData: FormData): unknown {
  const raw = formData.get('payload');

  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('Missing payload');
  }

  return JSON.parse(raw) as unknown;
}

function firstIssue(issues: Array<{ path: PropertyKey[]; message: string }>) {
  return issues.reduce<Record<string, string>>((errors, issue) => {
    const key = String(issue.path[0] ?? 'form');
    errors[key] ??= issue.message;
    return errors;
  }, {});
}

export async function createPurchaseOrderAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = createPurchaseOrderSchema.safeParse(readPayload(formData));

  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message,
      fieldErrors: firstIssue(parsed.error.issues),
    };
  }

  return submit(
    '/purchase-orders',
    parsed.data,
    'Purchase order created as a draft.',
    ['/purchase-orders', '/'],
  );
}

export async function createSalesOrderAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = createSalesOrderSchema.safeParse(readPayload(formData));

  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message,
      fieldErrors: firstIssue(parsed.error.issues),
    };
  }

  return submit('/sales-orders', parsed.data, 'Sales order created as a draft.', [
    '/sales-orders',
    '/',
  ]);
}

export async function createTransferAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = createTransferSchema.safeParse(readPayload(formData));

  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message,
      fieldErrors: firstIssue(parsed.error.issues),
    };
  }

  return submit('/transfers', parsed.data, 'Transfer created as a draft.', [
    '/transfers',
    '/',
  ]);
}
