import { createHash, randomBytes } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CreateInvitationInput,
  InvitationPreview,
  InvitationView,
} from '@wms/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/services/audit.service';
import { AuthService } from '../auth/auth.service';
import { MailerService } from '../notifications/mailer.service';
import type { OrgContext } from '../common/types/request-context';
import type { Invitation, Prisma } from '../generated/prisma/client';

const INVITE_INCLUDE = {
  invitedBy: { select: { id: true, fullName: true } },
  organization: { select: { name: true } },
} satisfies Prisma.InvitationInclude;

type InvitationRow = Prisma.InvitationGetPayload<{
  include: typeof INVITE_INCLUDE;
}>;

/**
 * Invitations to join an organisation.
 *
 * The token is a 32-byte random value handed out exactly once, in the link. Only
 * its SHA-256 hash is stored, so a database leak yields nothing an attacker can
 * redeem — the same reasoning as refresh tokens.
 *
 * Role and warehouse scope are fixed when the invitation is created and read
 * back from the stored row on acceptance. An invitee therefore cannot influence
 * their own privileges by tampering with the acceptance request.
 */
@Injectable()
export class InvitationsService {
  /** Invitations expire after this many days. */
  private static readonly TTL_DAYS = 7;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
    private readonly mailer: MailerService,
  ) {}

  /**
   * Creates an invitation and emails the acceptance link.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - Admin sending the invitation.
   * @param input - Invitee details, role and warehouse scope.
   * @returns The invitation, including the one-time acceptance URL.
   * @throws ConflictException when the person is already a member or already invited.
   */
  async create(
    orgContext: OrgContext,
    actorId: string,
    input: CreateInvitationInput,
  ): Promise<InvitationView> {
    const existingMember = await this.prisma.membership.findFirst({
      where: {
        organizationId: orgContext.organizationId,
        user: { email: input.email },
      },
      select: { id: true },
    });

    if (existingMember) {
      throw new ConflictException(
        'This person is already a member of the organisation',
      );
    }

    const pending = await this.prisma.invitation.findFirst({
      where: {
        organizationId: orgContext.organizationId,
        email: input.email,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });

    if (pending) {
      throw new ConflictException(
        'An invitation is already pending for this email address. Revoke it first to send a new one.',
      );
    }

    const warehouseIds =
      input.role === 'STAFF' ? (input.warehouseIds ?? []) : [];
    const token = randomBytes(32).toString('hex');

    const invitation = await this.prisma.invitation.create({
      data: {
        organizationId: orgContext.organizationId,
        email: input.email,
        fullName: input.fullName,
        role: input.role,
        warehouseIds,
        tokenHash: InvitationsService.hash(token),
        expiresAt: new Date(
          Date.now() + InvitationsService.TTL_DAYS * 24 * 60 * 60 * 1_000,
        ),
        invitedById: actorId,
      },
      include: INVITE_INCLUDE,
    });

    const inviteUrl = this.buildInviteUrl(token);

    await Promise.all([
      this.mailer.send({
        to: input.email,
        subject: `You have been invited to ${invitation.organization.name}`,
        body: [
          `Hello ${input.fullName},`,
          '',
          `You have been invited to join ${invitation.organization.name} as a ${input.role.toLowerCase()}.`,
          '',
          'Accept the invitation and choose a password here:',
          inviteUrl,
          '',
          `This link expires in ${InvitationsService.TTL_DAYS} days.`,
        ].join('\n'),
      }),
      this.auditService.record({
        organizationId: orgContext.organizationId,
        actorId,
        action: 'invitation.created',
        entityType: 'Invitation',
        entityId: invitation.id,
        metadata: { email: input.email, role: input.role },
      }),
    ]);

    return { ...(await this.toView(invitation)), inviteUrl };
  }

  /**
   * Lists invitations for the organisation.
   *
   * @param orgContext - Resolved organisation context.
   * @returns Invitations, newest first.
   */
  async list(orgContext: OrgContext): Promise<InvitationView[]> {
    const rows = await this.prisma.invitation.findMany({
      where: { organizationId: orgContext.organizationId },
      orderBy: { createdAt: 'desc' },
      include: INVITE_INCLUDE,
    });

    return Promise.all(rows.map((row) => this.toView(row)));
  }

  /**
   * Revokes a pending invitation.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - Admin revoking it.
   * @param id - Invitation identifier.
   */
  async revoke(
    orgContext: OrgContext,
    actorId: string,
    id: string,
  ): Promise<void> {
    const invitation = await this.prisma.invitation.findFirst({
      where: { id, organizationId: orgContext.organizationId },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.acceptedAt) {
      throw new ConflictException('This invitation has already been accepted');
    }

    await this.prisma.invitation.update({
      where: { id },
      data: { revokedAt: new Date() },
    });

    await this.auditService.record({
      organizationId: orgContext.organizationId,
      actorId,
      action: 'invitation.revoked',
      entityType: 'Invitation',
      entityId: id,
      metadata: { email: invitation.email },
    });
  }

  /**
   * Returns a public preview of an invitation so the acceptance page can show
   * who invited whom before asking for a password.
   *
   * @param token - Raw invitation token from the link.
   * @returns Non-sensitive details of the invitation.
   */
  async preview(token: string): Promise<InvitationPreview> {
    const invitation = await this.loadRedeemable(token);

    const existingUser = await this.prisma.user.findUnique({
      where: { email: invitation.email },
      select: { id: true },
    });

    return {
      email: invitation.email,
      fullName: invitation.fullName,
      organizationName: invitation.organization.name,
      role: invitation.role,
      expiresAt: invitation.expiresAt.toISOString(),
      hasExistingAccount: existingUser !== null,
    };
  }

  /**
   * Accepts an invitation, creating the account if needed and joining the
   * organisation with the role that was fixed at invite time.
   *
   * @param token - Raw invitation token from the link.
   * @param password - Password chosen by the invitee.
   * @returns The email of the account that can now sign in.
   */
  async accept(token: string, password: string): Promise<{ email: string }> {
    const invitation = await this.loadRedeemable(token);
    const passwordHash = await AuthService.hashPassword(password);

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({
        where: { email: invitation.email },
        select: { id: true },
      });

      // An existing account keeps its current password: accepting an invite
      // must never be a way to overwrite someone else's credentials by
      // inviting an address they already own.
      const userId =
        existing?.id ??
        (
          await tx.user.create({
            data: {
              email: invitation.email,
              fullName: invitation.fullName,
              passwordHash,
            },
            select: { id: true },
          })
        ).id;

      const membership = await tx.membership.create({
        data: {
          userId,
          organizationId: invitation.organizationId,
          role: invitation.role,
          ...(invitation.role === 'STAFF' && invitation.warehouseIds.length > 0
            ? {
                warehouses: {
                  create: invitation.warehouseIds.map((warehouseId) => ({
                    warehouseId,
                  })),
                },
              }
            : {}),
        },
      });

      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });

      await this.auditService.recordWithin(tx, {
        organizationId: invitation.organizationId,
        actorId: userId,
        action: 'invitation.accepted',
        entityType: 'Membership',
        entityId: membership.id,
        metadata: { email: invitation.email, role: invitation.role },
      });
    });

    return { email: invitation.email };
  }

  /** Loads an invitation by raw token, rejecting anything not redeemable. */
  private async loadRedeemable(token: string): Promise<InvitationRow> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: InvitationsService.hash(token) },
      include: INVITE_INCLUDE,
    });

    // One message for every failure mode: a probing attacker learns nothing
    // about which tokens exist.
    const invalid = new NotFoundException(
      'This invitation link is invalid, has expired, or has already been used',
    );

    if (!invitation) throw invalid;
    if (invitation.acceptedAt) throw invalid;
    if (invitation.revokedAt) throw invalid;
    if (invitation.expiresAt.getTime() < Date.now()) throw invalid;

    return invitation;
  }

  private buildInviteUrl(token: string): string {
    const base = (
      this.configService.get<string>('APP_URL') ?? 'http://localhost:3300'
    ).replace(/\/$/, '');

    return `${base}/invitations/${token}`;
  }

  private async toView(invitation: InvitationRow): Promise<InvitationView> {
    const warehouses =
      invitation.warehouseIds.length > 0
        ? await this.prisma.warehouse.findMany({
            where: { id: { in: invitation.warehouseIds } },
            select: { id: true, name: true, code: true },
          })
        : [];

    return {
      id: invitation.id,
      email: invitation.email,
      fullName: invitation.fullName,
      role: invitation.role,
      status: InvitationsService.statusOf(invitation),
      expiresAt: invitation.expiresAt.toISOString(),
      acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
      createdAt: invitation.createdAt.toISOString(),
      invitedBy: invitation.invitedBy,
      warehouses,
    };
  }

  private static statusOf(invitation: Invitation): InvitationView['status'] {
    if (invitation.acceptedAt) return 'ACCEPTED';
    if (invitation.revokedAt) return 'REVOKED';
    if (invitation.expiresAt.getTime() < Date.now()) return 'EXPIRED';
    return 'PENDING';
  }

  private static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
