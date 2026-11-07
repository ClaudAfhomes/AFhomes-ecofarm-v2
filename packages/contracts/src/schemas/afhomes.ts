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
  'network.members',
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
  // The GSD/Employee desk's Customer Lookup screen. It replaced the pragmatic
  // reuse of `operations.redemption` (a TILL permission) for a read-only
  // customer-search screen, so the permission now names the capability:
  // holding the till key no longer opens the lookup, and vice versa.
  'operations.customer_lookup',
  'governance.audit',
  'governance.customer_import',
  'governance.config',
  'cms.pages',
  'cms.media',
  'cms.settings',
  'cms.history',
]);
export type AfHomesModuleKey = z.infer<typeof afHomesModuleKeySchema>;

/** One module entry as the console presents it: label, group and display order. */
export interface AfHomesModuleDescriptor {
  key: AfHomesModuleKey;
  /** Human-readable name shown instead of the raw key. */
  label: string;
  /** Group heading the module is listed under. */
  group: string;
  /** Ascending display order, mirroring `public.modules.sort_order`. */
  sortOrder: number;
}

/**
 * The module catalog, human-readable.
 *
 * Mirrors the `public.modules` seed (name, group_name, sort_order) so the
 * console can present "Dashboard" instead of "dashboard.view" without a
 * round-trip: the roles and staff screens need names for every key, including
 * keys the viewer's own session does not hold. The DATABASE stays the runtime
 * authority - `private.has_permission()` and the per-request principal never
 * read this list - so a drifting label can mislabel a screen but can never
 * grant or deny anything.
 *
 * Ordering is the seed's sort_order, so the Roles screen lists modules in the
 * same order as the permission baseline.
 */
export const MODULE_CATALOG: readonly AfHomesModuleDescriptor[] = [
  { key: 'dashboard.view', label: 'Dashboard', group: 'Dashboard', sortOrder: 10 },
  { key: 'organization.staff', label: 'Staff', group: 'Organization', sortOrder: 20 },
  { key: 'organization.departments', label: 'Departments', group: 'Organization', sortOrder: 21 },
  {
    key: 'organization.roles',
    label: 'Roles & Permissions',
    group: 'Organization',
    sortOrder: 22,
  },
  { key: 'sales.card_sales', label: 'Card Sales', group: 'Sales & Customers', sortOrder: 30 },
  { key: 'sales.card_plans', label: 'Card Plans', group: 'Sales & Customers', sortOrder: 31 },
  { key: 'sales.customers', label: 'Customers', group: 'Sales & Customers', sortOrder: 32 },
  {
    key: 'sales.id_documents',
    label: 'ID Scan / OCR',
    group: 'Sales & Customers',
    sortOrder: 33,
  },
  {
    key: 'sales.uplines',
    label: 'Upline Assignment',
    group: 'Sales & Customers',
    sortOrder: 34,
  },
  {
    key: 'finance.payment_verification',
    label: 'Payment Verification',
    group: 'Finance',
    sortOrder: 40,
  },
  {
    key: 'finance.card_activation',
    label: 'Card Activation',
    group: 'Finance',
    sortOrder: 41,
  },
  {
    key: 'finance.final_qualification',
    label: 'Final Qualification',
    group: 'Finance',
    sortOrder: 42,
  },
  {
    key: 'finance.commission_payouts',
    label: 'Commission Payouts',
    group: 'Finance',
    sortOrder: 43,
  },
  { key: 'finance.points', label: 'Points Ledger', group: 'Finance', sortOrder: 44 },
  {
    key: 'network.ost_registrations',
    label: 'OST Registrations',
    group: 'Network',
    sortOrder: 50,
  },
  { key: 'network.ost_members', label: 'OST Members', group: 'Network', sortOrder: 51 },
  { key: 'network.genealogy', label: 'Genealogy', group: 'Network', sortOrder: 52 },
  { key: 'network.referrals', label: 'Referral & QR Codes', group: 'Network', sortOrder: 53 },
  { key: 'network.commissions', label: 'Commissions', group: 'Network', sortOrder: 54 },
  { key: 'network.withdrawals', label: 'OST Withdrawals', group: 'Network', sortOrder: 55 },
  { key: 'network.members', label: 'Members', group: 'Network', sortOrder: 56 },
  {
    key: 'operations.redemption',
    label: 'Redemption / POS',
    group: 'Operations',
    sortOrder: 60,
  },
  {
    key: 'operations.catalog',
    label: 'Service & Point Catalog',
    group: 'Operations',
    sortOrder: 61,
  },
  {
    key: 'operations.sales',
    label: 'Operational Services Sales',
    group: 'Operations',
    sortOrder: 62,
  },
  {
    key: 'operations.payments',
    label: 'Operational Services Payments',
    group: 'Operations',
    sortOrder: 63,
  },
  {
    key: 'operations.customer_lookup',
    label: 'Customer Lookup',
    group: 'Operations',
    sortOrder: 64,
  },
  { key: 'governance.audit', label: 'Audit Log', group: 'Governance', sortOrder: 70 },
  { key: 'governance.config', label: 'System Configuration', group: 'Governance', sortOrder: 71 },
  {
    key: 'governance.customer_import',
    label: 'Customer Import',
    group: 'Governance',
    sortOrder: 72,
  },
  { key: 'cms.pages', label: 'Website Pages and Content', group: 'Website', sortOrder: 100 },
  { key: 'cms.media', label: 'Website Media', group: 'Website', sortOrder: 101 },
  { key: 'cms.settings', label: 'Website Settings and SEO', group: 'Website', sortOrder: 102 },
  { key: 'cms.history', label: 'Website History', group: 'Website', sortOrder: 103 },
];

/** Flat key -> label view of the catalog. */
export const MODULE_LABELS = Object.fromEntries(
  MODULE_CATALOG.map((entry) => [entry.key, entry.label]),
) as Record<AfHomesModuleKey, string>;

/**
 * The human-readable name for a module key. An unknown key falls back to the
 * key itself so a module can never disappear from a screen just because the
 * catalog is behind it.
 */
export const moduleLabel = (key: string): string =>
  (MODULE_LABELS as Record<string, string | undefined>)[key] ?? key;

/** The catalog grouped for display, in catalog (sort) order. */
export function groupedModuleCatalog(): { group: string; modules: AfHomesModuleDescriptor[] }[] {
  const groups: { group: string; modules: AfHomesModuleDescriptor[] }[] = [];
  for (const entry of MODULE_CATALOG) {
    const bucket = groups.find((candidate) => candidate.group === entry.group);
    if (bucket) bucket.modules.push(entry);
    else groups.push({ group: entry.group, modules: [entry] });
  }
  return groups;
}

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
  isSystem: z.boolean(),
  isActive: z.boolean(),
  /** Owning department. Null for rows created before the role-department link. */
  departmentId: z.string().uuid().nullable(),
  departmentName: z.string().nullable(),
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
  /** Exact saved accreditation number. Absent on older API responses. */
  aaNumber: z.string().nullable().optional(),
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
  isActive: z.boolean().default(true),
  /** Owning department. Required: a role is always created inside a department. */
  departmentId: z.string().uuid(),
  permissions: z.array(afHomesPermissionSchema),
});
export const inviteAfHomesStaffSchema = z.object({
  email: emailSchema,
  fullName: staffNameSchema,
  departmentId: z.string().uuid().nullable(),
  roleId: z.string().uuid(),
});

/**
 * AFHomes staff creation (Phase 20). Same identity fields as the legacy
 * invitation, plus the administrator-set temporary password. The password is
 * server-validated, passed only to Supabase Auth (`auth.admin.createUser`),
 * and never stored in any AFHomes table. The confirm field is client-only
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
 * it by default); the new password follows the AFHomes >= 8 rule.
 */
export const changeAfHomesStaffPasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(128),
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ['newPassword'],
    message: 'Choose a password different from your current password.',
  });
export type ChangeAfHomesStaffPassword = z.infer<typeof changeAfHomesStaffPasswordSchema>;

export const staffSaleInvolvementSchema = z.object({
  id: z.string(),
  customerId: z.string().uuid(),
  customerName: z.string(),
  customerNumber: z.string(),
  saleId: z.string().uuid().nullable(),
  applicationId: z.string().uuid().nullable(),
  reference: z.string(),
  tier: z.string(),
  status: z.string(),
  createdAt: z.string(),
  roles: z.array(z.string()),
});
export type StaffSaleInvolvement = z.infer<typeof staffSaleInvolvementSchema>;
