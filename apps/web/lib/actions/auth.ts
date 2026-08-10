'use server';

import { redirect } from 'next/navigation';
import { signInSchema, signUpSchema, type AuthSession } from '@wms/contracts';
import { API_BASE_URL } from '../api';
import { clearSession, getRefreshToken, storeSession } from '../session';

/** Shape returned to the form by every auth action. */
export interface AuthFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * Turns Zod issues into a field → message map the form can render inline.
 */
function toFieldErrors(issues: Array<{ path: PropertyKey[]; message: string }>) {
  return issues.reduce<Record<string, string>>((errors, issue) => {
    const key = String(issue.path[0] ?? 'form');
    errors[key] ??= issue.message;
    return errors;
  }, {});
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

/**
 * Signs a user in and stores their session cookies.
 *
 * Validated with the same Zod schema the API uses, so the form catches obvious
 * mistakes without a round trip — and cannot drift from the server's rules,
 * because there is only one copy of them.
 *
 * @param _previousState - Prior form state, unused.
 * @param formData - Submitted sign-in form.
 * @returns Form state carrying any error; redirects on success.
 */
export async function signInAction(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { fieldErrors: toFieldErrors(parsed.error.issues) };
  }

  const response = await post('/auth/sign-in', parsed.data);

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    return { error: body?.message ?? 'Unable to sign in. Please try again.' };
  }

  const session = (await response.json()) as AuthSession;
  await storeSession(session.tokens);

  const from = formData.get('from');
  redirect(typeof from === 'string' && from.startsWith('/') ? from : '/');
}

/**
 * Registers a user, creates their organisation, and signs them in.
 *
 * @param _previousState - Prior form state, unused.
 * @param formData - Submitted sign-up form.
 * @returns Form state carrying any error; redirects on success.
 */
export async function signUpAction(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    password: formData.get('password'),
    organizationName: formData.get('organizationName'),
  });

  if (!parsed.success) {
    return { fieldErrors: toFieldErrors(parsed.error.issues) };
  }

  const response = await post('/auth/sign-up', parsed.data);

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    return { error: body?.message ?? 'Unable to create the account. Please try again.' };
  }

  const session = (await response.json()) as AuthSession;
  await storeSession(session.tokens);

  redirect('/');
}

/**
 * Signs the user out, revoking the refresh token server-side as well as
 * clearing the cookies — otherwise the token would stay valid for a fortnight
 * in whatever else happens to hold a copy of it.
 */
export async function signOutAction(): Promise<void> {
  const refreshToken = await getRefreshToken();

  if (refreshToken) {
    await post('/auth/sign-out', { refreshToken }).catch(() => undefined);
  }

  await clearSession();
  redirect('/login');
}
