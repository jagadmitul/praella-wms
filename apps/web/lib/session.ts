import 'server-only';
import { cookies } from 'next/headers';
import type { AuthTokens } from '@wms/contracts';

export const ACCESS_TOKEN_COOKIE = 'wms_access';
export const REFRESH_TOKEN_COOKIE = 'wms_refresh';
export const ORGANIZATION_COOKIE = 'wms_org';

/**
 * Session handling deliberately keeps both tokens in `httpOnly` cookies and
 * never exposes them to client-side JavaScript.
 *
 * The alternative — `localStorage` — is the common shortcut, but it puts a
 * long-lived refresh token somewhere any injected script can read. Here the
 * browser only ever holds an opaque cookie, and every call to the API is made
 * from the Next.js server, which is the one place allowed to see the token.
 */

const baseCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
} as const;

/**
 * Persists a freshly issued token pair.
 *
 * @param tokens - Access and refresh tokens returned by the API.
 */
export async function storeSession(tokens: AuthTokens): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    ...baseCookieOptions,
    maxAge: tokens.expiresIn,
  });

  cookieStore.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...baseCookieOptions,
    maxAge: 60 * 60 * 24 * 14,
  });
}

/** Removes every session cookie. */
export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, ORGANIZATION_COOKIE]) {
    cookieStore.delete(name);
  }
}

/** Returns the current access token, if the visitor has one. */
export async function getAccessToken(): Promise<string | undefined> {
  return (await cookies()).get(ACCESS_TOKEN_COOKIE)?.value;
}

/** Returns the current refresh token, if the visitor has one. */
export async function getRefreshToken(): Promise<string | undefined> {
  return (await cookies()).get(REFRESH_TOKEN_COOKIE)?.value;
}

/** Returns the organisation the visitor has selected, if any. */
export async function getActiveOrganizationId(): Promise<string | undefined> {
  return (await cookies()).get(ORGANIZATION_COOKIE)?.value;
}

/**
 * Records which organisation subsequent requests should act inside. Only
 * meaningful for a user who belongs to more than one.
 *
 * @param organizationId - Organisation to make active.
 */
export async function setActiveOrganization(organizationId: string): Promise<void> {
  (await cookies()).set(ORGANIZATION_COOKIE, organizationId, {
    ...baseCookieOptions,
    maxAge: 60 * 60 * 24 * 30,
  });
}
