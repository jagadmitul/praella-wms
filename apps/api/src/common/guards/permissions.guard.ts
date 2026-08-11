import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@wms/contracts';
import { REQUIRED_PERMISSIONS_KEY } from '../decorators';
import type { MaybeAuthenticatedRequest } from '../types/request-context';

/**
 * Enforces the `@RequirePermissions(...)` declaration on a route against the
 * permissions resolved for the caller's role in the active organisation.
 *
 * The guard checks permissions rather than roles. That indirection is the whole
 * point of the RBAC design: "only admins may delete a warehouse" is expressed
 * once, in the role→permission matrix, instead of being scattered across
 * controllers as role comparisons that drift apart over time.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<MaybeAuthenticatedRequest>();
    const orgContext = request.orgContext;

    if (!orgContext) {
      throw new ForbiddenException(
        'No organisation context resolved for this request',
      );
    }

    const missing = required.filter(
      (permission) => !orgContext.permissions.includes(permission),
    );

    if (missing.length > 0) {
      throw new ForbiddenException(
        `Your role (${orgContext.role}) is missing the required permission(s): ${missing.join(', ')}`,
      );
    }

    return true;
  }
}
