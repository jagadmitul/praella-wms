import { z } from 'zod';
import { roleSchema } from './enums';
import { permissionSchema } from './permissions';
import { idSchema, shortTextSchema } from './common';

/**
 * Password policy shared by sign-up and password changes. Deliberately checks
 * composition rather than only length so seeded demo accounts and real accounts
 * obey the same rule.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a digit');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(254);

/**
 * Sign-up creates the user, an organisation, and an ADMIN membership linking
 * them, all in one transaction. The first user of an organisation must be an
 * admin, otherwise nobody could ever administer it.
 */
export const signUpSchema = z.object({
  fullName: shortTextSchema,
  email: emailSchema,
  password: passwordSchema,
  organizationName: shortTextSchema,
});
export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

/** One organisation the signed-in user belongs to, plus their role in it. */
export const membershipSummarySchema = z.object({
  membershipId: idSchema,
  organizationId: idSchema,
  organizationName: z.string(),
  organizationSlug: z.string(),
  role: roleSchema,
});
export type MembershipSummary = z.infer<typeof membershipSummarySchema>;

export const authUserSchema = z.object({
  id: idSchema,
  email: z.string(),
  fullName: z.string(),
  createdAt: z.string(),
  memberships: z.array(membershipSummarySchema),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  /** Access-token lifetime in seconds, so clients can schedule a refresh. */
  expiresIn: z.number(),
  tokenType: z.literal('Bearer'),
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

export const authSessionSchema = z.object({
  user: authUserSchema,
  tokens: authTokensSchema,
});
export type AuthSession = z.infer<typeof authSessionSchema>;

/**
 * `GET /auth/me` response: the user, the organisation currently in context, and
 * the resolved permission list for that context. The web client renders its
 * navigation straight from `permissions`.
 */
export const currentSessionSchema = z.object({
  user: authUserSchema,
  activeOrganizationId: idSchema.nullable(),
  activeRole: roleSchema.nullable(),
  permissions: z.array(permissionSchema),
  /** Warehouse ids a STAFF member is scoped to; `null` means unrestricted. */
  warehouseScope: z.array(idSchema).nullable(),
});
export type CurrentSession = z.infer<typeof currentSessionSchema>;

/** Payload embedded in the signed JWT access token. */
export interface AccessTokenPayload {
  sub: string;
  email: string;
  tokenType: 'access';
  jti: string;
}

/** Payload embedded in the signed JWT refresh token. */
export interface RefreshTokenPayload {
  sub: string;
  tokenType: 'refresh';
  jti: string;
}

/* -------------------------------------------------------------------------- */
/*                             Password reset flow                            */
/* -------------------------------------------------------------------------- */

export const requestPasswordResetSchema = z.object({
  email: emailSchema,
});
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;

export const confirmPasswordResetSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: passwordSchema,
});
export type ConfirmPasswordResetInput = z.infer<typeof confirmPasswordResetSchema>;

/* -------------------------------------------------------------------------- */
/*                                 Invitations                                */
/* -------------------------------------------------------------------------- */

/**
 * Accepting an invitation only sets a password. Role and warehouse scope were
 * fixed by the inviting admin and are read from the stored invitation, so an
 * invitee cannot promote themselves on the way in.
 */
export const acceptInvitationSchema = z.object({
  token: z.string().min(1, 'Invitation token is required'),
  password: passwordSchema,
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

/** Public preview of an invitation, shown before the invitee sets a password. */
export const invitationPreviewSchema = z.object({
  email: z.string(),
  fullName: z.string(),
  organizationName: z.string(),
  role: roleSchema,
  expiresAt: z.string(),
  /** True when the invitee already has an account and only needs to accept. */
  hasExistingAccount: z.boolean(),
});
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;
