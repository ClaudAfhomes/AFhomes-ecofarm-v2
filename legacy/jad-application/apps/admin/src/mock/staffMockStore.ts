import type { RoleRecord, StaffModule } from '@jad/contracts';
import {
  STAFF_MODULE_LABEL,
  isRoleNameUnique,
  slugifyRoleName,
  systemRoleRecords,
} from '@jad/contracts';

import type { MockAuditEntry, MockStaffMember } from './data';
import { MOCK_STAFF } from './data';

/**
 * Canonical in-memory mock store for the Staff directory + Roles (RBAC
 * frontend pass). Staff mutations and role CRUD write through here so list +
 * detail stay consistent, and every change appends a mock audit entry (SSOT:
 * all staff exceptions audited). Frontend-only, deterministic IDs, no
 * random. Later replaced by Supabase/backend.
 */
export const STAFF_AUDIT_ACTIONS = {
  CREATED: 'STAFF_CREATED',
  ROLE_ASSIGNED: 'STAFF_ROLE_ASSIGNED',
  DISABLED: 'STAFF_DISABLED',
  ENABLED: 'STAFF_ENABLED',
  DELETED: 'STAFF_DELETED',
  ROLE_CREATED: 'ROLE_CREATED',
  ROLE_PERMISSIONS_UPDATED: 'ROLE_PERMISSIONS_UPDATED',
  ROLE_DELETED: 'ROLE_DELETED',
} as const;

let auditSeq = 0;
let staffSeq = MOCK_STAFF.length + 1;

export const staffStore: {
  members: MockStaffMember[];
  roles: RoleRecord[];
  auditEntries: MockAuditEntry[];
} = {
  members: MOCK_STAFF.map((m) => ({ ...m })),
  roles: systemRoleRecords(),
  auditEntries: [],
};

/** Restore seed state (specs call this to isolate mutation tests). */
export function resetStaffStore(): void {
  staffStore.members = MOCK_STAFF.map((m) => ({ ...m }));
  staffStore.roles = systemRoleRecords();
  staffStore.auditEntries = [];
  auditSeq = 0;
  staffSeq = MOCK_STAFF.length + 1;
}

export function getRoleById(roleId: string): RoleRecord | undefined {
  return staffStore.roles.find((r) => r.id === roleId);
}

export function updateStaffMember(
  id: string,
  patch: Partial<Pick<MockStaffMember, 'roleId' | 'status'>>,
): MockStaffMember | undefined {
  const member = staffStore.members.find((m) => m.id === id);
  if (!member) return undefined;
  Object.assign(member, patch);
  return member;
}

/** Permanently remove a staff member. Returns the removed copy, if present. */
export function deleteStaffMember(id: string): MockStaffMember | undefined {
  const member = staffStore.members.find((m) => m.id === id);
  if (!member) return undefined;
  staffStore.members = staffStore.members.filter((m) => m.id !== id);
  return { ...member };
}

export function isStaffEmailUnique(email: string, excludeId?: string): boolean {
  const wanted = email.trim().toLowerCase();
  return !staffStore.members.some(
    (m) => m.id !== excludeId && m.email.trim().toLowerCase() === wanted,
  );
}

export function createStaffMember(input: {
  name: string;
  email: string;
  roleId: string;
  createdBy: string;
}): MockStaffMember {
  if (!isStaffEmailUnique(input.email)) {
    throw new Error('A staff member with this email already exists.');
  }
  if (!getRoleById(input.roleId)) {
    throw new Error('Selected role does not exist.');
  }
  const member: MockStaffMember = {
    id: `stf-${String(staffSeq).padStart(3, '0')}`,
    name: input.name.trim(),
    email: input.email.trim(),
    roleId: input.roleId,
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
  };
  staffSeq += 1;
  staffStore.members.push(member);
  return { ...member };
}

function nextRoleId(name: string): string {
  const base = slugifyRoleName(name);
  if (!staffStore.roles.some((r) => r.id === base)) return base;
  let suffix = 2;
  while (staffStore.roles.some((r) => r.id === `${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export function createRole(input: {
  name: string;
  permissions: StaffModule[];
  createdBy: string;
}): RoleRecord {
  if (!isRoleNameUnique(staffStore.roles, input.name)) {
    throw new Error('A role with this name already exists.');
  }
  if (input.permissions.length === 0) {
    throw new Error('A role must grant at least one module.');
  }
  const role: RoleRecord = {
    id: nextRoleId(input.name),
    name: input.name.trim(),
    permissions: [...input.permissions],
    isSystem: false,
  };
  staffStore.roles.push(role);
  return { ...role, permissions: [...role.permissions] };
}

export function updateRole(
  id: string,
  patch: Partial<Pick<RoleRecord, 'name' | 'permissions'>>,
): RoleRecord | undefined {
  const role = getRoleById(id);
  if (!role) return undefined;
  if (patch.name !== undefined) {
    if (!isRoleNameUnique(staffStore.roles, patch.name, id)) {
      throw new Error('A role with this name already exists.');
    }
    role.name = patch.name.trim();
  }
  if (patch.permissions !== undefined) {
    if (patch.permissions.length === 0) {
      throw new Error('A role must grant at least one module.');
    }
    role.permissions = [...patch.permissions];
  }
  return { ...role, permissions: [...role.permissions] };
}

/** Governance modules that must always survive on at least one role. */
const GOVERNANCE_MODULES: StaffModule[] = ['staff', 'audit', 'config'];

/**
 * Delete a role (super admins only - enforced by callers). Blocked while
 * members hold it (reassign first) and when it is the last role granting
 * a governance module.
 */
export function deleteRole(id: string): void {
  const role = getRoleById(id);
  if (!role) throw new Error('Role does not exist.');
  const holders = staffStore.members.filter((m) => m.roleId === id);
  if (holders.length > 0) {
    throw new Error(
      `Cannot delete this role while ${holders.length} staff member${holders.length === 1 ? ' holds' : 's hold'} it. Reassign them first.`,
    );
  }
  const sole = GOVERNANCE_MODULES.filter(
    (m) =>
      role.permissions.includes(m) &&
      !staffStore.roles.some((r) => r.id !== id && r.permissions.includes(m)),
  );
  if (sole.length > 0) {
    throw new Error(
      `Cannot delete this role - it is the last role granting ${sole.map((m) => STAFF_MODULE_LABEL[m]).join(', ')}.`,
    );
  }
  staffStore.roles = staffStore.roles.filter((r) => r.id !== id);
}

export function appendStaffAudit(entry: Omit<MockAuditEntry, 'id' | 'createdAt'>): MockAuditEntry {
  auditSeq += 1;
  const full: MockAuditEntry = {
    ...entry,
    id: `aud-staff-${String(auditSeq).padStart(3, '0')}`,
    createdAt: new Date().toISOString(),
  };
  staffStore.auditEntries.push(full);
  return full;
}
