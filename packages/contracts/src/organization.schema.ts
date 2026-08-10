import { z } from 'zod';
import { roleSchema } from './enums';
import { idSchema, paginationQuerySchema, shortTextSchema } from './common';
import { emailSchema, passwordSchema } from './auth.schema';

export const updateOrganizationSchema = z.object({
  name: shortTextSchema,
});
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

/**
 * Adds a collaborator to the organisation. An existing user is linked by email;
 * an unknown email creates the account with the supplied temporary password.
 * This keeps the demo self-contained without needing an email provider.
 */
export const inviteMemberSchema = z.object({
  email: emailSchema,
  fullName: shortTextSchema,
  role: roleSchema,
  temporaryPassword: passwordSchema,
  /** Warehouses a STAFF invitee may access. Ignored for ADMIN and MANAGER. */
  warehouseIds: z.array(idSchema).optional(),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const updateMemberSchema = z.object({
  role: roleSchema.optional(),
  warehouseIds: z.array(idSchema).optional(),
});
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

export const memberQuerySchema = paginationQuerySchema.extend({
  role: roleSchema.optional(),
});
export type MemberQuery = z.infer<typeof memberQuerySchema>;
