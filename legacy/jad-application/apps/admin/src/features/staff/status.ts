import { roleNameFor } from '@jad/contracts';
import type { RoleRecord, StaffRole } from '@jad/contracts';
import type { StatusTone } from '@jad/ui';
import type { MockStaffMember } from '../../mock/data';

/** Role chip tones for system roles (labels come from role records). */
export const STAFF_ROLE_TONE: Record<StaffRole, StatusTone> = {
  super_admin: 'danger',
  admin: 'info',
  finance: 'warning',
  merchant: 'success',
};

/** Chip tone for any role id (system tone, else neutral for custom roles). */
export function roleToneFor(roleId: string): StatusTone {
  return (STAFF_ROLE_TONE as Record<string, StatusTone>)[roleId] ?? 'neutral';
}

/** Display name for a role id (record name, else system label, else raw id). */
export function roleLabelFor(
  roles: readonly Pick<RoleRecord, 'id' | 'name'>[] | undefined,
  roleId: string,
): string {
  return roleNameFor(roles, roleId);
}

export const STAFF_STATUS_LABEL: Record<MockStaffMember['status'], string> = {
  ACTIVE: 'Active',
  DISABLED: 'Disabled',
};

export const STAFF_STATUS_TONE: Record<MockStaffMember['status'], StatusTone> = {
  ACTIVE: 'success',
  DISABLED: 'neutral',
};
