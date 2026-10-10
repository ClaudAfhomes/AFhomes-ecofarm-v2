import { z } from 'zod';

import { emailSchema, normalizePersonName, PERSON_NAME_RE } from './input.js';

/** Staff display name: letters/spaces/apostrophes/hyphens, stored UPPERCASE. */
const staffNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(PERSON_NAME_RE, 'Use letters, spaces, apostrophes and hyphens only - no numbers')
  .transform((value) => normalizePersonName(value));

export const afHomesActionSchema = z.enum(['view', 'create', 'update', 'delete']);
export type AfHomesAction = z.infer<typeof afHomesActionSchema>;

export const afHomesModuleKeySchema = z.enum([
  'dashboard.view',
  'organization.staff',
  'organization.departments',
  'organization.roles',
  'sales.card_sales',
  'sales.card_plans',
  'sales.customers',
  'sales.id_documents',
  'sales.uplines',
  'finance.payment_verification',
  'finance.card_activation',
  'finance.final_qualification',
  'finance.commission_payouts',
  'finance.points',
  'network.ost_registrations',
  'network.ost_members',
  'network.genealogy',
  'network.referrals',
  'network.commissions',
  'network.withdrawals',
  'operations.redemption',
  'operations.catalog',
  // Operational Services selling. Deliberately NOT `sales.customers` create or
  // update: those govern customer creation and the whole customer record, and a
  // GSD who sells Teppanyaki must not inherit either. It also does not grant
  // verification, which stays on `finance.payment_verification` update.
  'operations.sales',
  // Operational Services RECEIPTS. Deliberately NOT `finance.payment_verification`,
  // which is the VIP-card verification key and belongs to a different workflow:
  // the two payment systems are independent, and neither key authorises the other.
  // `employee` holds no row here at all, so a GSD can never verify a receipt.
  'operations.payments',
  'governance.audit',
  'governance.customer_import',
  'governance.config',
  'cms.pages',
  'cms.media',
  'cms.settings',
  'cms.history',
]);
export type AfHomesModuleKey = z.infer<typeof afHomesModuleKeySchema>;

export const afHomesPermissionSchema = z.object({
  moduleKey: afHomesModuleKeySchema,
  canView: z.boolean(),
  canCreate: z.boolean(),
  canUpdate: z.boolean(),
  canDelete: z.boolean(),
});
export type AfHomesPermission = z.infer<typeof afHomesPermissionSchema>;

export const afHomesRoleSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  isActive: z.boolean(),
  assignedCount: z.number().int().nonnegative(),
  permissions: z.array(afHomesPermissionSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AfHomesRole = z.infer<typeof afHomesRoleSchema>;

export const afHomesDepartmentSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  staffCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AfHomesDepartment = z.infer<typeof afHomesDepartmentSchema>;

export const afHomesRestrictionSchema = z.object({
  moduleKey: afHomesModuleKeySchema,
  denyView: z.boolean(),
  denyCreate: z.boolean(),
  denyUpdate: z.boolean(),
  denyDelete: z.boolean(),
});

export const afHomesStaffSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
  status: z.enum(['invited', 'active', 'inactive', 'suspended']),
  departmentId: z.string().uuid().nullable(),
  departmentName: z.string().nullable(),
  roleId: z.string().uuid(),
  roleName: z.string(),
  /** Stable company employee number (AF-EMP-XXXXX). Null only pre-migration. */
  employeeNumber: z.string().nullish(),
  /** Sales-person ID (AF-SALES-XXXXX). Null for never-sales staff. */
  salesNumber: z.string().nullish(),
  restrictions: z.array(afHomesRestrictionSchema),
  mustChangePassword: z.boolean(),
  invitedAt: z.string().nullable(),
  activatedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type AfHomesStaff = z.infer<typeof afHomesStaffSchema>;

export const afHomesSessionSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
  status: z.enum(['invited', 'active', 'inactive', 'suspended']),
  roleId: z.string().uuid(),
  roleSlug: z.string(),
  roleName: z.string(),
  mustChangePassword: z.boolean(),
  permissions: z.array(afHomesPermissionSchema),
  /**
   * Server environment flag surfaced for UX gating only. True when
   * AFHOMES_ENABLE_TEST_PURGE=true; the purge endpoint re-checks it
   * authoritatively on every call.
   */
  testPurgeEnabled: z.boolean(),
  mfaRequired: z.boolean().optional(),
});
export type AfHomesSession = z.infer<typeof afHomesSessionSchema>;

/**
 * Super-admin-only test-account purge result. Counts only - no record
 * contents, no identities, no secrets.
 */
export const staffTestPurgeCountsSchema = z.object({
  staff: z.number().int().nonnegative(),
  restrictions: z.number().int().nonnegative(),
  assignments: z.number().int().nonnegative(),
  invitations: z.number().int().nonnegative(),
  sales: z.number().int().nonnegative(),
  customers: z.number().int().nonnegative(),
  payments: z.number().int().nonnegative(),
  memberships: z.number().int().nonnegative(),
  history: z.number().int().nonnegative(),
});
export const staffTestPurgeResponseSchema = z.object({
  purged: z.literal(true),
  counts: staffTestPurgeCountsSchema,
  authUserDeleted: z.boolean(),
});
export type StaffTestPurgeResponse = z.infer<typeof staffTestPurgeResponseSchema>;

/**
 * Safe preflight payload for the staff invitation landing page. It contains
 * only the identity already bound to the verified Supabase invite session;
 * role and permission data stay server-side until password authentication.
 */
export const staffAccountSetupSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
});
export type StaffAccountSetup = z.infer<typeof staffAccountSetupSchema>;

export const afHomesDashboardPointSchema = z.object({
  period: z.string(),
  verifiedSales: z.number().int().nonnegative(),
  collections: z.string(),
  activatedCards: z.number().int().nonnegative(),
  pointsRedeemed: z.number().int().nonnegative(),
});
export const afHomesDashboardSchema = z.object({
  totals: z.object({
    verifiedSales: z.number().int().nonnegative(),
    verifiedCollections: z.string(),
    activeMemberships: z.number().int().nonnegative(),
    pendingAccounts: z.number().int().nonnegative(),
    downPaymentAccounts: z.number().int().nonnegative(),
    overdueAccounts: z.number().int().nonnegative(),
    pointsIssued: z.number().int().nonnegative(),
    pointsRedeemed: z.number().int().nonnegative(),
    pendingQualifications: z.number().int().nonnegative(),
    earnedUnpaidCommissions: z.string(),
    activeSellers: z.number().int().nonnegative(),
    inactiveSellers: z.number().int().nonnegative(),
    activeEmployees: z.number().int().nonnegative(),
    inactiveEmployees: z.number().int().nonnegative(),
  }),
  queues: z.object({
    paymentVerification: z.number().int().nonnegative(),
    cardActivation: z.number().int().nonnegative(),
    finalQualification: z.number().int().nonnegative(),
    ostRegistrations: z.number().int().nonnegative(),
    commissionPayouts: z.number().int().nonnegative(),
  }),
  trend: z.array(afHomesDashboardPointSchema),
});
export type AfHomesDashboard = z.infer<typeof afHomesDashboardSchema>;

export const createAfHomesRoleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  isActive: z.boolean().default(true),
  permissions: z.array(afHomesPermissionSchema),
});
export const inviteAfHomesStaffSchema = z.object({
  email: emailSchema,
  fullName: staffNameSchema,
  departmentId: z.string().uuid().nullable(),
  roleId: z.string().uuid(),
});

/**
 * AF Homes staff creation (Phase 20). Same identity fields as the legacy
 * invitation, plus the administrator-set temporary password. The password is
 * server-validated, passed only to Supabase Auth (`auth.admin.createUser`),
 * and never stored in any AF Homes table. The confirm field is client-only
 * (the dialog compares it before submitting) so it has no server schema.
 */
export const createAfHomesStaffSchema = inviteAfHomesStaffSchema.extend({
  temporaryPassword: z.string().min(8).max(128),
});
export type CreateAfHomesStaff = z.infer<typeof createAfHomesStaffSchema>;

/** My Account display-name update (PATCH own session). */
export const updateAfHomesStaffProfileSchema = z.object({
  name: staffNameSchema,
});
export type UpdateAfHomesStaffProfile = z.infer<typeof updateAfHomesStaffProfileSchema>;

/**
 * My Account / forced first-login password change. The current password is
 * re-verified with a fresh `signInWithPassword` (Supabase does not require
 * it by default); the new password follows the AF Homes >= 8 rule.
 */
export const changeAfHomesStaffPasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});
export type ChangeAfHomesStaffPassword = z.infer<typeof changeAfHomesStaffPasswordSchema>;
