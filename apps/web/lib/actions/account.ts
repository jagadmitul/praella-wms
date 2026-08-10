'use server';

import { redirect } from 'next/navigation';
import {
  acceptInvitationSchema,
  confirmPasswordResetSchema,
  requestPasswordResetSchema,
} from '@wms/contracts';
import { API_BASE_URL } from '../api';
import type { ActionState } from './types';

/** Posts to a public auth endpoint and normalises the outcome for a form. */
async function post(path: string, body: unknown): Promise<ActionState | null> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  if (response.ok) return null;

  const payload = (await response.json().catch(() => null)) as
    | { message?: string; details?: Array<{ path: string; message: string }> }
    | null;

  return {
    status: 'error',
    message: payload?.message ?? 'Something went wrong. Please try again.',
    ...(payload?.details
      ? {
          fieldErrors: payload.details.reduce<Record<string, string>>((errors, detail) => {
            errors[detail.path] ??= detail.message;
            return errors;
          }, {}),
        }
      : {}),
  };
}

/** Accepts an invitation and sets the invitee's password. */
export async function acceptInvitationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = acceptInvitationSchema.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return {
      status: 'error',
      fieldErrors: parsed.error.issues.reduce<Record<string, string>>((errors, issue) => {
        errors[String(issue.path[0] ?? 'form')] ??= issue.message;
        return errors;
      }, {}),
    };
  }

  const failure = await post('/invitations/accept', parsed.data);
  if (failure) return failure;

  redirect('/login?accepted=1');
}

/**
 * Requests a reset link. Always reports success, mirroring the API — telling
 * the visitor whether the address exists would defeat the point.
 */
export async function requestPasswordResetAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = requestPasswordResetSchema.safeParse({ email: formData.get('email') });

  if (!parsed.success) {
    return { status: 'error', fieldErrors: { email: 'Enter a valid email address' } };
  }

  await post('/auth/password-reset/request', parsed.data);

  return {
    status: 'success',
    message:
      'If an account exists for that address, a reset link is on its way. Check the API logs in this demo.',
  };
}

/** Consumes a reset token and sets the new password. */
export async function confirmPasswordResetAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = confirmPasswordResetSchema.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return {
      status: 'error',
      fieldErrors: parsed.error.issues.reduce<Record<string, string>>((errors, issue) => {
        errors[String(issue.path[0] ?? 'form')] ??= issue.message;
        return errors;
      }, {}),
    };
  }

  const failure = await post('/auth/password-reset/confirm', parsed.data);
  if (failure) return failure;

  redirect('/login?reset=1');
}
