import {
  BadRequestException,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { permissionsForRole, type Role } from '@wms/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY, SKIP_ORG_CONTEXT_KEY } from '../decorators';
import type { MaybeAuthenticatedRequest } from '../types/request-context';

/** Header a client uses to choose which organisation it is acting inside. */
export const ORGANIZATION_HEADER = 'x-organization-id';

/**
 * Resolves the organisation the request is acting inside and attaches it, with
 * the caller's role, permissions and warehouse scope, to `request.orgContext`.
 *
 * Selection rules:
 *  1. If `x-organization-id` is present, the user must be a member of it.
 *  2. Otherwise, if the user belongs to exactly one organisation, use it.
 *  3. Otherwise the request is ambiguous and is rejected, rather than guessing.
 */
@Injectable()
export class OrgContextGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const [isPublic, skipOrgContext] = [IS_PUBLIC_KEY, SKIP_ORG_CONTEXT_KEY].map((key) =>
      this.reflector.getAllAndOverride<boolean>(key, [
        context.getHandler(),
        context.getClass(),
      ]),
    );

    if (isPublic || skipOrgContext) {
      return true;
    }

    const request = context.switchToHttp().getRequest<MaybeAuthenticatedRequest>();
    if (!request.user) {
      return true; // JwtAuthGuard has already rejected this request.
    }

    const requestedOrganizationId = this.readHeader(request, ORGANIZATION_HEADER);

    const memberships = await this.prisma.membership.findMany({
      where: {
        userId: request.user.id,
        ...(requestedOrganizationId ? { organizationId: requestedOrganizationId } : {}),
      },
      include: {
        organization: { select: { id: true, name: true } },
        warehouses: { select: { warehouseId: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (memberships.length === 0) {
      throw new ForbiddenException(
        requestedOrganizationId
          ? 'You are not a member of the requested organisation'
          : 'You do not belong to any organisation',
      );
    }

    if (memberships.length > 1) {
      throw new BadRequestException(
        `You belong to ${memberships.length} organisations — set the ${ORGANIZATION_HEADER} header to choose one`,
      );
    }

    const membership = memberships[0]!;
    const role = membership.role as Role;

    request.orgContext = {
      organizationId: membership.organizationId,
      organizationName: membership.organization.name,
      membershipId: membership.id,
      role,
      permissions: permissionsForRole(role),
      // Only STAFF are warehouse-restricted, and only when assignments exist.
      // A STAFF member with no assignment yet sees nothing, which is safer than
      // silently granting them the whole organisation.
      warehouseScope:
        role === 'STAFF' ? membership.warehouses.map((link) => link.warehouseId) : null,
    };

    return true;
  }

  private readHeader(
    request: MaybeAuthenticatedRequest,
    header: string,
  ): string | undefined {
    const value = request.headers[header];
    const raw = Array.isArray(value) ? value[0] : value;
    const trimmed = raw?.trim();
    return trimmed ? trimmed : undefined;
  }
}
