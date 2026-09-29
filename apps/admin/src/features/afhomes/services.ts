import {
  afHomesDashboardSchema,
  afHomesDepartmentSchema,
  afHomesRoleSchema,
  afHomesStaffSchema,
  analyticsOverviewSchema,
  type AfHomesDashboard,
  type AfHomesDepartment,
  type AfHomesPermission,
  type AfHomesRole,
  type AfHomesStaff,
  type AnalyticsOverview,
  type AnalyticsPeriod,
} from '@jad/contracts';
import { z } from 'zod';
import { request, requestList } from '../../lib/api/client';

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
export const getAfHomesRoleAudit = (id: string) =>
  requestList(`/admin/afhomes/roles/${id}/audit`, auditEventSchema);
export const getAfHomesStaff = (): Promise<AfHomesStaff[]> =>
  requestList('/admin/afhomes/staff', afHomesStaffSchema);
export const inviteAfHomesStaff = (input: {
  email: string;
  fullName: string;
  departmentId: string | null;
  roleId: string;
}) =>
  request('/admin/afhomes/staff', afHomesStaffSchema, {
    method: 'POST',
    body: JSON.stringify(input),
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
export const getAfHomesDepartments = (): Promise<AfHomesDepartment[]> =>
  requestList('/admin/afhomes/departments', afHomesDepartmentSchema);
export const createAfHomesDepartment = (input: { code: string; name: string }) =>
  request('/admin/afhomes/departments', afHomesDepartmentSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });
export const getAfHomesDashboard = (range: string): Promise<AfHomesDashboard> =>
  request(`/admin/afhomes/dashboard?range=${encodeURIComponent(range)}`, afHomesDashboardSchema);

export const getAnalyticsOverview = (period: AnalyticsPeriod): Promise<AnalyticsOverview> =>
  request(`/analytics?period=${encodeURIComponent(period)}`, analyticsOverviewSchema);
