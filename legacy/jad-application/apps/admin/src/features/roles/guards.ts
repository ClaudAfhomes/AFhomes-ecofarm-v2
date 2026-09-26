import { STAFF_MODULE_LABEL } from '@jad/contracts';
import type { RoleRecord, StaffModule } from '@jad/contracts';

import type { MockStaffMember } from '../../mock/data';

/**
 * Role governance guards (pure logic - pages render the reasons).
 * Governance survival: at least one role must always grant each of the
 * governance modules (`staff`, `audit`, `config`); nobody may strip their
 * own role's governance access; roles holding members cannot be deleted.
 */

export const GOVERNANCE_MODULES: StaffModule[] = ['staff', 'audit', 'config'];

/** Governance modules this role is the sole granter of (excluding itself). */
export function soleGrantedGovernance(roles: readonly RoleRecord[], roleId: string): StaffModule[] {
  const current = roles.find((r) => r.id === roleId);
  if (!current) return [];
  return GOVERNANCE_MODULES.filter(
    (m) =>
      current.permissions.includes(m) &&
      !roles.some((r) => r.id !== roleId && r.permissions.includes(m)),
  );
}

/** Guard a permission-set replacement. Returns `ok` or a production-ready reason. */
export function guardRolePermissions(
  roles: readonly RoleRecord[],
  roleId: string,
  next: StaffModule[],
  sessionRoleId?: string | null,
): { ok: true } | { ok: false; reason: string } {
  const current = roles.find((r) => r.id === roleId);
  if (
    current &&
    sessionRoleId === roleId &&
    current.permissions.includes('staff') &&
    !next.includes('staff')
  ) {
    return {
      ok: false,
      reason:
        'You cannot remove your own governance access. Grant the Staff module to another role first.',
    };
  }
  const removed = soleGrantedGovernance(roles, roleId).filter((m) => !next.includes(m));
  if (removed.length > 0) {
    const labels = removed.map((m) => STAFF_MODULE_LABEL[m]).join(', ');
    return {
      ok: false,
      reason: `Cannot revoke ${labels} - this is the last role granting ${removed.length === 1 ? 'it' : 'them'}. Grant ${removed.length === 1 ? 'it' : 'them'} to another role first.`,
    };
  }
  return { ok: true };
}

/**
 * Guard a role deletion. Only super admins may delete roles (system roles
 * included); deletion is further blocked while members hold the role and
 * when it is the last role granting a governance module.
 */
export function guardRoleDelete(
  roles: readonly RoleRecord[],
  members: MockStaffMember[],
  role: RoleRecord,
  sessionRoleId?: string | null,
): { ok: true } | { ok: false; reason: string } {
  if (sessionRoleId !== 'super_admin') {
    return { ok: false, reason: 'Only super admins can delete roles.' };
  }
  const holders = members.filter((m) => m.roleId === role.id);
  if (holders.length > 0) {
    return {
      ok: false,
      reason: `Cannot delete this role while ${holders.length} staff member${holders.length === 1 ? ' holds' : 's hold'} it. Reassign them first.`,
    };
  }
  const sole = soleGrantedGovernance(roles, role.id);
  if (sole.length > 0) {
    const labels = sole.map((m) => STAFF_MODULE_LABEL[m]).join(', ');
    return {
      ok: false,
      reason: `Cannot delete this role - it is the last role granting ${labels}.`,
    };
  }
  return { ok: true };
}
