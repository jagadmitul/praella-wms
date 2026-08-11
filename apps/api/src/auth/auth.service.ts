import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import {
  type AuthSession,
  type AuthUser,
  type CurrentSession,
  permissionsForRole,
  type Role,
  type SignInInput,
  type SignUpInput,
} from '@wms/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/services/audit.service';
import { uniqueSlug } from '../common/utils/slug.util';
import { TokenService, type TokenClientInfo } from './token.service';
import type { OrgContext } from '../common/types/request-context';

/**
 * Argon2id parameters — deliberately slow, tuned for ~50-100ms per hash.
 *
 * `raw?: false` is part of the type so the overload resolving to a string
 * digest is selected rather than the one returning a raw Buffer.
 */
const ARGON2_OPTIONS: argon2.HashOptions & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Registers a user, creates their organisation, and makes them its admin.
   *
   * All three happen in one transaction: an organisation without an admin would
   * be unadministrable, and a user without a membership could not do anything.
   *
   * @param input - Validated sign-up payload.
   * @param client - Optional user agent and IP for the session record.
   * @returns The new user and their first token pair.
   * @throws ConflictException when the email is already registered.
   */
  async signUp(
    input: SignUpInput,
    client: TokenClientInfo = {},
  ): Promise<AuthSession> {
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(
        'An account with this email address already exists',
      );
    }

    const slug = await uniqueSlug(input.organizationName, async (candidate) => {
      const found = await this.prisma.organization.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      return found !== null;
    });

    const passwordHash = await argon2.hash(input.password, ARGON2_OPTIONS);

    const user = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { name: input.organizationName, slug },
      });

      const created = await tx.user.create({
        data: {
          email: input.email,
          fullName: input.fullName,
          passwordHash,
          memberships: {
            create: { organizationId: organization.id, role: 'ADMIN' },
          },
        },
      });

      await this.auditService.recordWithin(tx, {
        organizationId: organization.id,
        actorId: created.id,
        action: 'organization.created',
        entityType: 'Organization',
        entityId: organization.id,
        metadata: { name: organization.name, viaSignUp: true },
      });

      return created;
    });

    const tokens = await this.tokenService.issueTokens(user, client);

    return { user: await this.loadAuthUser(user.id), tokens };
  }

  /**
   * Authenticates a user with email and password.
   *
   * @param input - Validated sign-in payload.
   * @param client - Optional user agent and IP for the session record.
   * @returns The user and a fresh token pair.
   * @throws UnauthorizedException when the credentials do not match.
   */
  async signIn(
    input: SignInInput,
    client: TokenClientInfo = {},
  ): Promise<AuthSession> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true, email: true, passwordHash: true, isActive: true },
    });

    // The same error for "no such user" and "wrong password" — anything else
    // turns the sign-in endpoint into an account-enumeration oracle.
    const invalid = new UnauthorizedException(
      'Incorrect email address or password',
    );

    if (!user) {
      // Burn comparable time so response latency does not reveal whether the
      // address exists.
      await argon2.hash(input.password, ARGON2_OPTIONS);
      throw invalid;
    }

    const matches = await argon2.verify(user.passwordHash, input.password);
    if (!matches) {
      throw invalid;
    }

    if (!user.isActive) {
      throw new UnauthorizedException('This account has been deactivated');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.tokenService.issueTokens(user, client);

    return { user: await this.loadAuthUser(user.id), tokens };
  }

  /**
   * Builds the `GET /auth/me` payload for the active organisation context.
   *
   * @param userId - The authenticated user.
   * @param orgContext - Resolved organisation context, when one applies.
   * @returns The user, active organisation and resolved permission list.
   */
  async currentSession(
    userId: string,
    orgContext: OrgContext | undefined,
  ): Promise<CurrentSession> {
    const user = await this.loadAuthUser(userId);

    // With no explicit context, fall back to the sole membership if there is
    // one, so a single-organisation user gets working permissions immediately.
    const fallback =
      user.memberships.length === 1 ? user.memberships[0] : undefined;
    const role: Role | null = orgContext?.role ?? fallback?.role ?? null;
    const organizationId =
      orgContext?.organizationId ?? fallback?.organizationId ?? null;

    let warehouseScope: string[] | null = orgContext?.warehouseScope
      ? [...orgContext.warehouseScope]
      : null;

    if (!orgContext && fallback && fallback.role === 'STAFF') {
      const assignments = await this.prisma.warehouseMember.findMany({
        where: { membershipId: fallback.membershipId },
        select: { warehouseId: true },
      });
      warehouseScope = assignments.map((assignment) => assignment.warehouseId);
    }

    return {
      user,
      activeOrganizationId: organizationId,
      activeRole: role,
      permissions: role ? [...permissionsForRole(role)] : [],
      warehouseScope,
    };
  }

  /**
   * Loads a user together with every organisation they belong to.
   *
   * @param userId - User to load.
   * @returns The serialisable auth user.
   */
  async loadAuthUser(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        createdAt: true,
        memberships: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            role: true,
            organization: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      createdAt: user.createdAt.toISOString(),
      memberships: user.memberships.map((membership) => ({
        membershipId: membership.id,
        organizationId: membership.organization.id,
        organizationName: membership.organization.name,
        organizationSlug: membership.organization.slug,
        role: membership.role,
      })),
    };
  }

  /**
   * Hashes a password with the application's Argon2id parameters. Shared with
   * member invitation so every stored hash uses identical settings.
   *
   * @param password - Plain-text password.
   * @returns The Argon2id hash.
   */
  static hashPassword(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }
}
