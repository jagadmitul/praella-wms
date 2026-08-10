import {
  PERMISSIONS,
  permissionsForRole,
  ROLE_PERMISSIONS,
  roleHasAllPermissions,
  roleHasPermission,
  type Permission,
} from '@wms/contracts';

/**
 * Guards the RBAC matrix itself.
 *
 * The integration suite proves the API enforces the matrix; this proves the
 * matrix says what the brief asks it to say. Together they mean a widened role
 * cannot reach production unnoticed.
 */
describe('role → permission matrix', () => {
  it('grants admins every permission', () => {
    expect(permissionsForRole('ADMIN')).toHaveLength(PERMISSIONS.length);
  });

  it('enforces the rules the brief spells out', () => {
    // "only Admins can delete warehouses"
    expect(roleHasPermission('ADMIN', 'warehouse:delete')).toBe(true);
    expect(roleHasPermission('MANAGER', 'warehouse:delete')).toBe(false);
    expect(roleHasPermission('STAFF', 'warehouse:delete')).toBe(false);

    // "Managers can adjust stock"
    expect(roleHasPermission('MANAGER', 'stock:adjust')).toBe(true);
    expect(roleHasPermission('STAFF', 'stock:adjust')).toBe(false);

    // "Staff can only view/record stock movements"
    expect(roleHasPermission('STAFF', 'movement:read')).toBe(true);
    expect(roleHasPermission('STAFF', 'movement:record')).toBe(true);
  });

  it('keeps staff read-only outside of recording movements', () => {
    const staffWritePermissions = permissionsForRole('STAFF').filter((permission) =>
      /:(create|update|delete|manage|adjust|transfer|invite|receive|fulfill|assign)$/.test(
        permission,
      ),
    );

    expect(staffWritePermissions).toEqual([]);
  });

  it('nests the roles: staff ⊂ manager ⊂ admin', () => {
    const staff = permissionsForRole('STAFF');
    const manager = permissionsForRole('MANAGER');
    const admin = permissionsForRole('ADMIN');

    expect(roleHasAllPermissions('MANAGER', staff)).toBe(true);
    expect(roleHasAllPermissions('ADMIN', manager)).toBe(true);
    expect(admin.length).toBeGreaterThan(manager.length);
    expect(manager.length).toBeGreaterThan(staff.length);
  });

  it('reserves organisation administration for admins alone', () => {
    const adminOnly: Permission[] = [
      'org:update',
      'member:invite',
      'member:manage',
      'warehouse:delete',
      'warehouse:assign',
    ];

    for (const permission of adminOnly) {
      expect(roleHasPermission('ADMIN', permission)).toBe(true);
      expect(roleHasPermission('MANAGER', permission)).toBe(false);
      expect(roleHasPermission('STAFF', permission)).toBe(false);
    }
  });

  it('contains no duplicate permissions in any role', () => {
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      expect(new Set(permissions).size).toBe(permissions.length);
      expect(role).toBeTruthy();
    }
  });

  it('grants no permission that is not declared in PERMISSIONS', () => {
    const declared = new Set<string>(PERMISSIONS);

    for (const permissions of Object.values(ROLE_PERMISSIONS)) {
      for (const permission of permissions) {
        expect(declared.has(permission)).toBe(true);
      }
    }
  });

  it('requires all declared permissions rather than any of them', () => {
    expect(roleHasAllPermissions('MANAGER', ['stock:adjust', 'product:create'])).toBe(true);
    expect(roleHasAllPermissions('MANAGER', ['stock:adjust', 'warehouse:delete'])).toBe(
      false,
    );
  });
});
