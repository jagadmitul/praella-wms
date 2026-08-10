import { z } from 'zod';
import { type Role, roleSchema } from './enums';

/**
 * Every fine-grained permission in the system, expressed as `resource:action`.
 *
 * Permissions — not roles — are what guards check. Roles are only a convenient
 * bundle of permissions, so adding a fourth role later never requires touching
 * a single controller.
 */
export const PERMISSIONS = [
  // Organisation & membership
  'org:read',
  'org:update',
  'member:read',
  'member:invite',
  'member:manage',

  // Warehouses
  'warehouse:read',
  'warehouse:create',
  'warehouse:update',
  'warehouse:delete',
  'warehouse:assign',

  // Catalogue
  'category:read',
  'category:manage',
  'supplier:read',
  'supplier:manage',
  'product:read',
  'product:create',
  'product:update',
  'product:delete',

  // Stock
  'stock:read',
  'stock:adjust',
  'stock:transfer',
  'movement:read',
  'movement:record',

  // Replenishment
  'replenishment:read',
  'replenishment:manage',

  // Orders
  'purchase_order:read',
  'purchase_order:manage',
  'purchase_order:receive',
  'sales_order:read',
  'sales_order:manage',
  'sales_order:fulfill',

  // Platform
  'report:read',
  'job:read',
  'job:create',
] as const;

export const permissionSchema = z.enum(PERMISSIONS);
export type Permission = (typeof PERMISSIONS)[number];

const STAFF_PERMISSIONS: readonly Permission[] = [
  'org:read',
  'member:read',
  'warehouse:read',
  'category:read',
  'supplier:read',
  'product:read',
  'stock:read',
  // Staff record physical movements they actually perform on the floor, but may
  // not silently rewrite a stock level via an adjustment.
  'movement:read',
  'movement:record',
  'replenishment:read',
  'purchase_order:read',
  'sales_order:read',
  'report:read',
  'job:read',
];

const MANAGER_PERMISSIONS: readonly Permission[] = [
  ...STAFF_PERMISSIONS,
  'warehouse:create',
  'warehouse:update',
  'category:manage',
  'supplier:manage',
  'product:create',
  'product:update',
  'product:delete',
  'stock:adjust',
  'stock:transfer',
  'replenishment:manage',
  'purchase_order:manage',
  'purchase_order:receive',
  'sales_order:manage',
  'sales_order:fulfill',
  'job:create',
];

const ADMIN_PERMISSIONS: readonly Permission[] = [...PERMISSIONS];

/**
 * The single source of truth for what each role may do. The API enforces it in
 * `PermissionsGuard`; the web client imports the very same map to decide which
 * actions to render, so the UI can never offer a button the API would reject.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  ADMIN: ADMIN_PERMISSIONS,
  MANAGER: MANAGER_PERMISSIONS,
  STAFF: STAFF_PERMISSIONS,
};

/**
 * Returns every permission granted to a role.
 *
 * @param role - Organisation role to expand.
 * @returns The frozen list of permissions for that role.
 */
export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

/**
 * Checks whether a role is granted a specific permission.
 *
 * @param role - Organisation role of the acting membership.
 * @param permission - Permission being tested.
 * @returns `true` when the role includes the permission.
 */
export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * Checks whether a role holds *every* permission in a list. Guards require all
 * declared permissions rather than any of them, so a route can safely declare
 * several without widening access.
 *
 * @param role - Organisation role of the acting membership.
 * @param permissions - Permissions that must all be present.
 * @returns `true` when the role satisfies all of them.
 */
export function roleHasAllPermissions(
  role: Role,
  permissions: readonly Permission[],
): boolean {
  return permissions.every((permission) => roleHasPermission(role, permission));
}

/** Roles ordered from most to least privileged, useful for UI sorting. */
export const ROLE_HIERARCHY: readonly Role[] = ['ADMIN', 'MANAGER', 'STAFF'];

/** Human-readable role labels shared by the API's docs and the web client. */
export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  STAFF: 'Staff',
};

export { roleSchema };
