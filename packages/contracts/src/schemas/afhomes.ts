import { z } from 'zod';

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
  'governance.audit',
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
  restrictions: z.array(afHomesRestrictionSchema),
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
  permissions: z.array(afHomesPermissionSchema),
});
export type AfHomesSession = z.infer<typeof afHomesSessionSchema>;

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
  email: z.string().trim().email(),
  fullName: z.string().trim().min(2).max(120),
  departmentId: z.string().uuid().nullable(),
  roleId: z.string().uuid(),
});
