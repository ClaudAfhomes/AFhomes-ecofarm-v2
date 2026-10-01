/**
 * Cross-portal identity contracts.
 *
 * `GET /auth/portals` answers one question for the bearer's OWN Auth user:
 * which AF Homes identities exist (staff row, customer row, OST row). It is
 * read-only, session-scoped (never parameterized by user id), and carries no
 * PII beyond what each portal already shows its own member. Login screens use
 * it to route to the right portal and to name the wrong-portal message; it
 * authorizes nothing.
 */
import { z } from 'zod';

import { customerStatusSchema } from './lifecycle.js';

export const authPortalsSchema = z.object({
  staff: z
    .object({
      roleSlug: z.string().nullable(),
      roleName: z.string().nullable(),
      status: z.enum(['invited', 'active', 'inactive', 'suspended']),
      mustChangePassword: z.boolean(),
    })
    .nullable(),
  customer: z
    .object({
      status: customerStatusSchema,
    })
    .nullable(),
  ost: z
    .object({
      status: z.enum(['active', 'inactive', 'suspended']),
      ostNumber: z.string(),
    })
    .nullable(),
});
export type AuthPortals = z.infer<typeof authPortalsSchema>;

/**
 * An approved OST member's own record, safe for the OST portal. No sponsor
 * ids, no Auth internals, no other member.
 */
export const ostMeSchema = z.object({
  ostNumber: z.string(),
  fullName: z.string(),
  status: z.enum(['active', 'inactive', 'suspended']),
  sponsorName: z.string(),
  approvedAt: z.string(),
});
export type OstMe = z.infer<typeof ostMeSchema>;
