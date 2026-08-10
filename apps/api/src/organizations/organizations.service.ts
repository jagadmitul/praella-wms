import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  InviteMemberInput,
  MemberQuery,
  MemberView,
  OrganizationView,
  Paginated,
  Role,
  UpdateMemberInput,
  UpdateOrganizationInput,
} from '@wms/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { AuditService } from '../common/services/audit.service';
import { paginate, toPrismaPage } from '../common/utils/pagination.util';
import { AuthService } from '../auth/auth.service';
import type { OrgContext } from '../common/types/request-context';
import type { Prisma } from '../generated/prisma/client';

const MEMBER_INCLUDE = {
  user: { select: { id: true, email: true, fullName: true } },
  warehouses: {
    include: { warehouse: { select: { id: true, name: true, code: true } } },
  },
} satisfies Prisma.MembershipInclude;

type MemberRow = Prisma.MembershipGetPayload<{ include: typeof MEMBER_INCLUDE }>;

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Returns the organisation the request is acting inside.
   *
   * @param orgContext - Resolved organisation context.
   * @returns The organisation.
   */
  async current(orgContext: OrgContext): Promise<OrganizationView> {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: orgContext.organizationId },
    });

    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      createdAt: organization.createdAt.toISOString(),
    };
  }

  /**
   * Renames the organisation.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User performing the update.
   * @param input - New organisation details.
   * @returns The updated organisation.
   */
  async update(
    orgContext: OrgContext,
    actorId: string,
    input: UpdateOrganizationInput,
  ): Promise<OrganizationView> {
    const organization = await this.prisma.organization.update({
      where: { id: orgContext.organizationId },
      data: { name: input.name },
    });

    await Promise.all([
      this.auditService.record({
        organizationId: orgContext.organizationId,
        actorId,
        action: 'organization.updated',
        entityType: 'Organization',
        entityId: organization.id,
        metadata: { name: input.name },
      }),
      this.cacheService.invalidateOrganization(orgContext.organizationId),
    ]);

    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      createdAt: organization.createdAt.toISOString(),
    };
  }

  /**
   * Lists the people collaborating in this organisation.
   *
   * @param orgContext - Resolved organisation context.
   * @param query - Pagination and filter options.
   * @returns A page of members.
   */
  async listMembers(
    orgContext: OrgContext,
    query: MemberQuery,
  ): Promise<Paginated<MemberView>> {
    const where: Prisma.MembershipWhereInput = {
      organizationId: orgContext.organizationId,
      ...(query.role ? { role: query.role } : {}),
      ...(query.search
        ? {
            user: {
              OR: [
                { fullName: { contains: query.search, mode: 'insensitive' } },
                { email: { contains: query.search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };

    const [rows, totalItems] = await Promise.all([
      this.prisma.membership.findMany({
        where,
        ...toPrismaPage(query),
        orderBy: { createdAt: 'asc' },
        include: MEMBER_INCLUDE,
      }),
      this.prisma.membership.count({ where }),
    ]);

    return paginate(rows.map(OrganizationsService.toView), totalItems, query);
  }

  /**
   * Adds a collaborator. An existing account is linked by email; an unknown
   * email creates the account with the supplied temporary password.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User sending the invitation.
   * @param input - Validated invitation payload.
   * @returns The new membership.
   * @throws ConflictException when the user is already a member.
   */
  async inviteMember(
    orgContext: OrgContext,
    actorId: string,
    input: InviteMemberInput,
  ): Promise<MemberView> {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });

    if (existingUser) {
      const existingMembership = await this.prisma.membership.findUnique({
        where: {
          userId_organizationId: {
            userId: existingUser.id,
            organizationId: orgContext.organizationId,
          },
        },
        select: { id: true },
      });

      if (existingMembership) {
        throw new ConflictException('This person is already a member of the organisation');
      }
    }

    await this.assertWarehousesInOrg(orgContext, input.warehouseIds ?? []);

    const passwordHash = existingUser
      ? null
      : await AuthService.hashPassword(input.temporaryPassword);

    const membership = await this.prisma.$transaction(async (tx) => {
      const userId =
        existingUser?.id ??
        (
          await tx.user.create({
            data: {
              email: input.email,
              fullName: input.fullName,
              passwordHash: passwordHash!,
            },
            select: { id: true },
          })
        ).id;

      const created = await tx.membership.create({
        data: {
          userId,
          organizationId: orgContext.organizationId,
          role: input.role,
          // Warehouse assignments only mean anything for STAFF; admins and
          // managers are unrestricted by design.
          ...(input.role === 'STAFF' && input.warehouseIds?.length
            ? {
                warehouses: {
                  create: input.warehouseIds.map((warehouseId) => ({ warehouseId })),
                },
              }
            : {}),
        },
        include: MEMBER_INCLUDE,
      });

      await this.auditService.recordWithin(tx, {
        organizationId: orgContext.organizationId,
        actorId,
        action: 'member.invited',
        entityType: 'Membership',
        entityId: created.id,
        metadata: { email: input.email, role: input.role },
      });

      return created;
    });

    await this.cacheService.invalidateOrganization(orgContext.organizationId);
    return OrganizationsService.toView(membership);
  }

  /**
   * Changes a member's role or warehouse assignments.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User performing the change.
   * @param membershipId - Membership to change.
   * @param input - New role and/or warehouse assignments.
   * @returns The updated membership.
   */
  async updateMember(
    orgContext: OrgContext,
    actorId: string,
    membershipId: string,
    input: UpdateMemberInput,
  ): Promise<MemberView> {
    const membership = await this.loadMembership(orgContext, membershipId);

    if (input.role && input.role !== membership.role) {
      await this.assertNotLastAdmin(orgContext, membership.id, membership.role as Role);
    }

    await this.assertWarehousesInOrg(orgContext, input.warehouseIds ?? []);

    const nextRole = (input.role ?? membership.role) as Role;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (input.role) {
        await tx.membership.update({
          where: { id: membershipId },
          data: { role: input.role },
        });
      }

      // Promoting to ADMIN or MANAGER makes assignments meaningless, so they
      // are cleared rather than left behind to confuse a later demotion.
      if (nextRole !== 'STAFF') {
        await tx.warehouseMember.deleteMany({ where: { membershipId } });
      } else if (input.warehouseIds) {
        await tx.warehouseMember.deleteMany({ where: { membershipId } });
        await tx.warehouseMember.createMany({
          data: input.warehouseIds.map((warehouseId) => ({ membershipId, warehouseId })),
          skipDuplicates: true,
        });
      }

      return tx.membership.findUniqueOrThrow({
        where: { id: membershipId },
        include: MEMBER_INCLUDE,
      });
    });

    await Promise.all([
      this.auditService.record({
        organizationId: orgContext.organizationId,
        actorId,
        action: 'member.updated',
        entityType: 'Membership',
        entityId: membershipId,
        metadata: { role: nextRole, warehouseIds: input.warehouseIds ?? null },
      }),
      this.cacheService.invalidateOrganization(orgContext.organizationId),
    ]);

    return OrganizationsService.toView(updated);
  }

  /**
   * Removes a member from the organisation.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User performing the removal.
   * @param membershipId - Membership to remove.
   */
  async removeMember(
    orgContext: OrgContext,
    actorId: string,
    membershipId: string,
  ): Promise<void> {
    const membership = await this.loadMembership(orgContext, membershipId);

    if (membership.id === orgContext.membershipId) {
      throw new ForbiddenException('You cannot remove your own membership');
    }

    await this.assertNotLastAdmin(orgContext, membership.id, membership.role as Role);

    await this.prisma.membership.delete({ where: { id: membershipId } });

    await Promise.all([
      this.auditService.record({
        organizationId: orgContext.organizationId,
        actorId,
        action: 'member.removed',
        entityType: 'Membership',
        entityId: membershipId,
        metadata: { email: membership.user.email },
      }),
      this.cacheService.invalidateOrganization(orgContext.organizationId),
    ]);
  }

  private async loadMembership(
    orgContext: OrgContext,
    membershipId: string,
  ): Promise<MemberRow> {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, organizationId: orgContext.organizationId },
      include: MEMBER_INCLUDE,
    });

    if (!membership) {
      throw new NotFoundException('Member not found in this organisation');
    }

    return membership;
  }

  /**
   * Prevents the organisation from losing its last admin, which would leave it
   * permanently unadministrable.
   */
  private async assertNotLastAdmin(
    orgContext: OrgContext,
    membershipId: string,
    currentRole: Role,
  ): Promise<void> {
    if (currentRole !== 'ADMIN') {
      return;
    }

    const adminCount = await this.prisma.membership.count({
      where: { organizationId: orgContext.organizationId, role: 'ADMIN' },
    });

    if (adminCount <= 1) {
      throw new ConflictException(
        'This is the last admin of the organisation. Promote another member to admin first.',
      );
    }

    void membershipId;
  }

  private async assertWarehousesInOrg(
    orgContext: OrgContext,
    warehouseIds: string[],
  ): Promise<void> {
    if (warehouseIds.length === 0) {
      return;
    }

    const found = await this.prisma.warehouse.count({
      where: { id: { in: warehouseIds }, organizationId: orgContext.organizationId },
    });

    if (found !== new Set(warehouseIds).size) {
      throw new BadRequestException('One or more warehouses do not exist in this organisation');
    }
  }

  private static toView(membership: MemberRow): MemberView {
    return {
      membershipId: membership.id,
      userId: membership.user.id,
      email: membership.user.email,
      fullName: membership.user.fullName,
      role: membership.role as Role,
      joinedAt: membership.createdAt.toISOString(),
      warehouses: membership.warehouses.map((link) => link.warehouse),
    };
  }
}
