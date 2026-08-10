import { NextResponse, type NextRequest } from 'next/server';
import type { AuthTokens } from '@wms/contracts';

const ACCESS_TOKEN_COOKIE = 'wms_access';
const REFRESH_TOKEN_COOKIE = 'wms_refresh';

/** Refresh this many seconds before the access token actually expires. */
const REFRESH_MARGIN_SECONDS = 60;

const PUBLIC_PATHS = [
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/invitations',
];

/**
* Keeps the session alive and guards the dashboard.
 *
 * Refreshing happens here rather than inside a Server Component because a
 * component rendering a page is not allowed to set cookies — the proxy layer is
 * the only place in the request lifecycle that can both call the API and write
 * the new token back to the browser.
 *
 * (Next 16 renamed this convention from `middleware.ts` to `proxy.ts`.)
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;

  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  // Already signed in and heading for the sign-in page — send them onwards.
  if (isPublic && accessToken && !isExpiringSoon(accessToken)) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  if (isPublic) {
    return NextResponse.next();
  }

  if (!refreshToken) {
    return redirectToLogin(request, pathname + search);
  }

  if (accessToken && !isExpiringSoon(accessToken)) {
    return NextResponse.next();
  }

  const tokens = await refreshTokens(refreshToken);

  if (!tokens) {
    const response = redirectToLogin(request, pathname + search);
    response.cookies.delete(ACCESS_TOKEN_COOKIE);
    response.cookies.delete(REFRESH_TOKEN_COOKIE);
    return response;
  }

  const response = NextResponse.next();
  const secure = process.env.NODE_ENV === 'production';

  response.cookies.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: tokens.expiresIn,
  });
  response.cookies.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 60 * 60 * 24 * 14,
  });

  // The request being handled right now still carries the old cookie, so hand
  // it the new token directly instead of making it wait a round trip.
  request.cookies.set(ACCESS_TOKEN_COOKIE, tokens.accessToken);

  return response;
}

/**
 * Reads a JWT's expiry without verifying it.
 *
 * Verification is the API's job — this only decides whether it is worth asking
 * for a new token, so a forged `exp` costs an attacker one rejected refresh.
 */
function isExpiringSoon(token: string): boolean {
  try {
    const [, payload] = token.split('.');
    if (!payload) return true;

    const decoded = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
    ) as { exp?: number };

    if (!decoded.exp) return true;

    return decoded.exp - REFRESH_MARGIN_SECONDS <= Math.floor(Date.now() / 1000);
  } catch {
    return true;
  }
}

async function refreshTokens(refreshToken: string): Promise<AuthTokens | null> {
  const baseUrl = (process.env.API_BASE_URL ?? 'http://localhost:4300/api/v1').replace(
    /\/$/,
    '',
  );

  try {
    const response = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    });

    if (!response.ok) return null;

    return (await response.json()) as AuthTokens;
  } catch {
    return null;
  }
}

function redirectToLogin(request: NextRequest, from: string): NextResponse {
  const url = new URL('/login', request.url);
  if (from && from !== '/') {
    url.searchParams.set('from', from);
  }
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)'],
};
