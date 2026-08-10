import type { Request } from 'express';
import type { Permission, Role } from '@wms/contracts';

/** The authenticated principal, resolved from the JWT access token. */
export interface RequestUser {
  id: string;
  email: string;
  fullName: string;
}

/**
 * The organisation the current request is acting inside, together with the
 * caller's effective authority within it.
 *
 * Every tenant-scoped query filters on `organizationId` from here — never from
 * a client-supplied body field — which is what makes cross-tenant access
 * structurally impossible rather than merely unlikely.
 */
export interface OrgContext {
  organizationId: string;
  organizationName: string;
  membershipId: string;
  role: Role;
  permissions: readonly Permission[];
  /**
   * Warehouse ids this membership may touch, or `null` when unrestricted.
   * ADMIN and MANAGER are unrestricted; STAFF are limited to their assignments.
   */
  warehouseScope: readonly string[] | null;
}

/** An Express request after the auth and org-context guards have run. */
export interface AuthenticatedRequest extends Request {
  user: RequestUser;
  orgContext: OrgContext;
  requestId: string;
}

/** A request that has passed authentication but may not yet have org context. */
export interface MaybeAuthenticatedRequest extends Request {
  user?: RequestUser;
  orgContext?: OrgContext;
  requestId: string;
}
