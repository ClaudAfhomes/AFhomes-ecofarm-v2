import { resolveRoleModules } from '@jad/contracts';
import type { RoleRecord } from '@jad/contracts';

import type { MockStaffMember } from '../../mock/data';

/**
 * Staff governance guards (pure logic - pages render the reasons).
 * Exactly one role per staff member; permissions belong to roles. The
 * platform must always keep at least one ACTIVE member in a role granting
 * the `staff` module (governance survival), and nobody may change their
 * own role or status.
 */

export function isSelf(sessionEmail: string | undefined, target: MockStaffMember): boolean {
  return sessionEmail !== undefined && sessionEmail.toLowerCase() === target.email.toLowerCase();
}

function grantsStaffModule(roles: readonly RoleRecord[] | undefined, roleId: string): boolean {
  return resolveRoleModules(roles, roleId).includes('staff');
}

/** ACTIVE governors (members in staff-granting roles), optionally excluding one id. */
export function activeGovernorCount(
  members: MockStaffMember[],
  roles: readonly RoleRecord[] | undefined,
  excludeId?: string,
): number {
  return members.filter(
    (m) => m.status === 'ACTIVE' && grantsStaffModule(roles, m.roleId) && m.id !== excludeId,
  ).length;
}

export function isLastGovernor(
  members: MockStaffMember[],
  roles: readonly RoleRecord[] | undefined,
  target: MockStaffMember,
): boolean {
  return (
    target.status === 'ACTIVE' &&
    grantsStaffModule(roles, target.roleId) &&
    activeGovernorCount(members, roles, target.id) === 0
  );
}

/** Guard a role reassignment. Returns `ok` or a production-ready reason. */
export function guardRoleChange(
  members: MockStaffMember[],
  roles: readonly RoleRecord[] | undefined,
  sessionEmail: string | undefined,
  target: MockStaffMember,
): { ok: true } | { ok: false; reason: string } {
  if (isSelf(sessionEmail, target)) {
    return { ok: false, reason: 'You cannot change your own role.' };
  }
  if (isLastGovernor(members, roles, target)) {
    return {
      ok: false,
      reason: `${target.name} is the last active administrator. Grant the Staff module to another role with an active member first.`,
    };
  }
  return { ok: true };
}

/**
 * Guard a permanent staff deletion. Only holders of the super_admin role may
 * delete other staff; nobody may delete themselves; and the last active
 * administrator cannot be deleted (governance survival).
 */
export function guardStaffDelete(
  members: MockStaffMember[],
  roles: readonly RoleRecord[] | undefined,
  sessionEmail: string | undefined,
  sessionRoleId: string | null | undefined,
  target: MockStaffMember,
): { ok: true } | { ok: false; reason: string } {
  if (isSelf(sessionEmail, target)) {
    return { ok: false, reason: 'You cannot delete your own staff account.' };
  }
  if (sessionRoleId !== 'super_admin') {
    return { ok: false, reason: 'Only super admins can delete staff accounts.' };
  }
  if (isLastGovernor(members, roles, target)) {
    return {
      ok: false,
      reason: `${target.name} is the last active administrator. Grant the Staff module to another role with an active member first.`,
    };
  }
  return { ok: true };
}

/** Guard an enable/disable transition. Returns `ok` or a production-ready reason. */
export function guardStatusChange(
  members: MockStaffMember[],
  roles: readonly RoleRecord[] | undefined,
  sessionEmail: string | undefined,
  target: MockStaffMember,
): { ok: true } | { ok: false; reason: string } {
  if (isSelf(sessionEmail, target)) {
    return { ok: false, reason: 'You cannot change your own status.' };
  }
  if (target.status === 'ACTIVE' && isLastGovernor(members, roles, target)) {
    return {
      ok: false,
      reason: `${target.name} is the last active administrator. Grant the Staff module to another role with an active member first.`,
    };
  }
  return { ok: true };
}
