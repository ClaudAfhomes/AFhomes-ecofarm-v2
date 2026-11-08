import { z } from 'zod';
import { hierarchyRoleSchema } from './lifecycle.js';
import { aaNumberSchema, saleTeamKindSchema } from './sale-team.js';

export const genealogyStatusSchema = z.enum(['invited','active','inactive','suspended']);
/** AA-number resolution for the New Customer Application's recommender/referrer
 * inputs: `member` is null when the number does not resolve to an accredited
 * seller within the caller's own authorized genealogy scope (unknown AA number
 * and out-of-scope AA number are indistinguishable on purpose - this never
 * confirms or denies another seller's existence to a caller who cannot see it). */
export const genealogyResolveResultSchema = z.object({
  member: z.object({
    staffId: z.string().uuid(), fullName: z.string(), role: hierarchyRoleSchema,
    aaNumber: aaNumberSchema, kind: saleTeamKindSchema,
    status: z.enum(['accredited','expired','revoked','inactive','not_started']),
  }).nullable(),
});
/** Batch staffId -> AA number, for read-only upline display. `null` means no
 * accreditation is on file for that staff id (never guessed, never blank). */
export const accreditationNumberMapSchema = z.record(z.string(), aaNumberSchema.nullable());
export const genealogyNodeSchema = z.object({
  staffId:z.string().uuid(), fullName:z.string(), role:hierarchyRoleSchema,
  status:genealogyStatusSchema, ostStatus:z.enum(['active','inactive','suspended']).nullable(),
  uplineStaffId:z.string().uuid().nullable(), directDownlineCount:z.number().int().nonnegative(),
  totalDescendantCount:z.number().int().nonnegative(),
});
export const genealogySummarySchema = z.object({
  staffId:z.string().uuid(), totalDirectDownline:z.number().int().nonnegative(),
  totalDescendants:z.number().int().nonnegative(), activeSellerCount:z.number().int().nonnegative(),
  inactiveSellerCount:z.number().int().nonnegative(),
  roleCounts:z.object({vice_director:z.number().int().nonnegative(),senior_sales_manager:z.number().int().nonnegative(),sales_manager:z.number().int().nonnegative(),ost:z.number().int().nonnegative()}),
});
export type GenealogyNode=z.infer<typeof genealogyNodeSchema>;
export type GenealogySummary=z.infer<typeof genealogySummarySchema>;
export type GenealogyResolvedMember = NonNullable<z.infer<typeof genealogyResolveResultSchema>['member']>;
