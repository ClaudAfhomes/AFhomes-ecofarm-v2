import {
  afHomesDashboardSchema,
  afHomesDepartmentSchema,
  afHomesRoleSchema,
  afHomesSessionSchema,
  afHomesStaffSchema,
  analyticsOverviewSchema,
  dashboardQueuesSchema,
  salesTrendReportSchema,
  staffTestPurgeResponseSchema,
  type AfHomesDashboard,
  type AfHomesDepartment,
  type AfHomesPermission,
  type AfHomesRole,
  type AfHomesStaff,
  type AnalyticsOverview,
  type AnalyticsPeriod,
  type DashboardQueues,
  type SalesTrendGranularity,
  type SalesTrendReport,
  type StaffTestPurgeResponse,
} from '@jad/contracts';
import { z } from 'zod';
import {
  protectedRequest as request,
  protectedRequestList as requestList,
} from '../../lib/api/client';
import { normalizeProfileName, normalizeStaffIdentity } from '../../lib/normalize';

export const getAfHomesRoles = (): Promise<AfHomesRole[]> =>
  requestList('/admin/afhomes/roles', afHomesRoleSchema);
export const createAfHomesRole = (input: {
  name: string;
  description?: string;
  isActive: boolean;
  permissions: AfHomesPermission[];
}) =>
  request('/admin/afhomes/roles', afHomesRoleSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });
export const updateAfHomesRole = (
  id: string,
  input: Partial<{
    name: string;
    description: string;
    isActive: boolean;
    permissions: AfHomesPermission[];
  }>,
) =>
  request(`/admin/afhomes/roles/${id}`, afHomesRoleSchema, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
const auditEventSchema = z.object({
  id: z.union([z.string(), z.number()]),
  action: z.string(),
  created_at: z.string(),
  actor_id: z.string().nullable(),
});
export type AfHomesAuditEvent = z.infer<typeof auditEventSchema>;
export const getAfHomesRoleAudit = (id: string) =>
  requestList(`/admin/afhomes/roles/${id}/audit`, auditEventSchema);
export const getAfHomesStaffAudit = (id: string) =>
  requestList(`/admin/afhomes/staff/${id}/audit`, auditEventSchema);
export const getAfHomesRoleById = (id: string): Promise<AfHomesRole> =>
  request(`/admin/afhomes/roles/${id}`, afHomesRoleSchema);
export const getAfHomesStaff = (): Promise<AfHomesStaff[]> =>
  requestList('/admin/afhomes/staff', afHomesStaffSchema);
export const getAfHomesStaffById = (id: string): Promise<AfHomesStaff> =>
  request(`/admin/afhomes/staff/${id}`, afHomesStaffSchema);
/**
 * JAD-parity staff creation: the administrator sets a temporary password and
 * the account starts gated on `mustChangePassword`. The secret travels to
 * Supabase Auth only and is never stored in an AF Homes table. (The legacy
 * `inviteAfHomesStaff` invitation callback is retired for standard
 * onboarding; pre-existing invited accounts still activate through
 * `/admin/activate-account`.)
 */
export const createAfHomesStaff = (input: {
  email: string;
  fullName: string;
  departmentId: string | null;
  roleId: string;
  temporaryPassword: string;
}) =>
  request('/admin/afhomes/staff', afHomesStaffSchema, {
    method: 'POST',
    body: JSON.stringify({ ...input, ...normalizeStaffIdentity(input) }),
  });
export const updateAfHomesStaff = (
  id: string,
  input: Partial<Pick<AfHomesStaff, 'departmentId' | 'roleId' | 'status' | 'restrictions'>>,
) =>
  request(`/admin/afhomes/staff/${id}`, afHomesStaffSchema, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
const staffDeactivationSchema = z.object({ deactivated: z.literal(true) });
const deletionSchema = z.object({ deleted: z.literal(true) });
export const deactivateAfHomesStaff = (id: string) =>
  request(`/admin/afhomes/staff/${id}/deactivate`, staffDeactivationSchema, { method: 'POST' });
export const deleteAfHomesStaff = (id: string) =>
  request(`/admin/afhomes/staff/${id}`, deletionSchema, { method: 'DELETE' });

/**
 * Client-side mirror of the server's test-account eligibility, for SHOWING
 * the purge control only. RFC-reserved, undeliverable domains (including
 * example.* subdomains) can never be a functional real account. The server
 * re-checks authoritatively on every call, so this can never authorize
 * anything.
 */
export function isTestStaffEmail(email: unknown): boolean {
  if (typeof email !== 'string') return false;
  const parts = email.trim().toLowerCase().split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const host = parts[1]!;
  if (host === 'localhost' || host === 'example.com' || host === 'example.net' || host === 'example.org')
    return true;
  if (host.endsWith('.example.com') || host.endsWith('.example.net') || host.endsWith('.example.org'))
    return true;
  return host.endsWith('.invalid') || host.endsWith('.test') || host.endsWith('.localhost');
}

/** Super-admin-only test-data purge. Never used for real accounts. */
export const purgeTestAfHomesStaff = (id: string): Promise<StaffTestPurgeResponse> =>
  request(`/admin/afhomes/staff/${id}/purge-test-data`, staffTestPurgeResponseSchema, {
    method: 'POST',
    body: JSON.stringify({}),
  });
export const getAfHomesDepartments = (): Promise<AfHomesDepartment[]> =>
  requestList('/admin/afhomes/departments', afHomesDepartmentSchema);
export const createAfHomesDepartment = (input: { code: string; name: string }) =>
  request('/admin/afhomes/departments', afHomesDepartmentSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });
export const getAfHomesDashboard = (range: string): Promise<AfHomesDashboard> =>
  request(`/admin/afhomes/dashboard?range=${encodeURIComponent(range)}`, afHomesDashboardSchema);

/** My Account display-name update (PATCH own session; reachable while gated). */
export const updateAfHomesStaffProfile = (input: { name: string }) =>
  request('/admin/afhomes/session', afHomesSessionSchema, {
    method: 'PATCH',
    body: JSON.stringify({ name: normalizeProfileName(input.name) }),
  });

const passwordChangedSchema = z.object({ changed: z.literal(true) });
/** My Account / forced first-login password change. */
export const changeAfHomesStaffPassword = (input: {
  currentPassword: string;
  newPassword: string;
}) =>
  request('/admin/afhomes/session/password', passwordChangedSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const getAnalyticsOverview = (period: AnalyticsPeriod): Promise<AnalyticsOverview> =>
  request(`/analytics?period=${encodeURIComponent(period)}`, analyticsOverviewSchema);

/**
 * JAD-parity Sales Overview trend: a dedicated per-granularity series of
 * qualifying-sale counts and exact-decimal frozen-value totals. Independent of
 * the page-level analytics period selector.
 */
export const getAfHomesSalesTrend = (
  granularity: SalesTrendGranularity,
): Promise<SalesTrendReport> =>
  request(
    `/analytics/sales-trend?granularity=${encodeURIComponent(granularity)}`,
    salesTrendReportSchema,
  );

/**
 * Phase 2B operational dashboard queue cards (JAD QueueCard parity).
 * Server-side counts; a `null` count means the caller may not know that queue
 * and its card stays hidden. Never fetch full lists to count client-side.
 */
export const getAfHomesDashboardQueues = (): Promise<DashboardQueues> =>
  request('/queues/dashboard', dashboardQueuesSchema);
