import {
  applyDecorators,
  createParamDecorator,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import { ApiForbiddenResponse, ApiHeader, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Permission } from '@wms/contracts';
import type { AuthenticatedRequest, OrgContext, RequestUser } from '../types/request-context';

export const IS_PUBLIC_KEY = 'wms:isPublic';
export const SKIP_ORG_CONTEXT_KEY = 'wms:skipOrgContext';
export const REQUIRED_PERMISSIONS_KEY = 'wms:requiredPermissions';

/**
 * Marks a route as reachable without an access token. Authentication is on by
 * default via a global guard, so forgetting this decorator fails closed.
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Marks an authenticated route that does not operate inside a single
 * organisation — for example `GET /auth/me`, which lists every membership.
 */
export const SkipOrgContext = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_ORG_CONTEXT_KEY, true);

/**
 * Declares the permissions a route requires. All of them must be held; the
 * guard never treats the list as "any of".
 *
 * @param permissions - Permissions the caller's role must include.
 */
export function RequirePermissions(
  ...permissions: Permission[]
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions),
    ApiForbiddenResponse({
      description: `Requires permission(s): ${permissions.join(', ')}`,
    }),
    ApiUnauthorizedResponse({ description: 'Missing or invalid access token' }),
  );
}

/** Documents the organisation selector header on Swagger operations. */
export const ApiOrgHeader = (): MethodDecorator & ClassDecorator =>
  ApiHeader({
    name: 'x-organization-id',
    required: false,
    description:
      'Organisation to act within. Optional when the user belongs to exactly one organisation.',
  });

/** Injects the authenticated user. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user;
  },
);

/** Injects the resolved organisation context. */
export const CurrentOrg = createParamDecorator(
  (_data: unknown, context: ExecutionContext): OrgContext => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.orgContext;
  },
);
