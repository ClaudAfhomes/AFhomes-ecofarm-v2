import { z } from 'zod';

import { staffMemberSchema } from '@jad/contracts';
import type { MockStaffMember } from '../../../mock/data';

import { request, requestList } from '../../../lib/api/client';

export interface StaffAuditActor {
  actor: string;
  actorRole: string;
}

/** Staff directory - REST over api/v1 (Phase B4 cutover). */
export function getStaff(): Promise<MockStaffMember[]> {
  return requestList('/admin/staff', staffMemberSchema);
}

export function getStaffMember(id: string): Promise<MockStaffMember | undefined> {
  return request(`/admin/staff/${id}`, staffMemberSchema).catch(() => undefined);
}

/** Create a staff member (starts ACTIVE) + audit. */
export function createStaff(input: {
  name: string;
  email: string;
  roleId: string;
  temporaryPassword: string;
  actor: string;
  actorRole: string;
}): Promise<MockStaffMember> {
  return request('/admin/staff', staffMemberSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

/** Reassign a staff member's role (exactly one role per user) + audit. */
export function assignStaffRole(input: {
  id: string;
  roleId: string;
  actor: string;
  actorRole: string;
}): Promise<MockStaffMember> {
  return request(`/admin/staff/${input.id}`, staffMemberSchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roleId: input.roleId, actor: input.actor, actorRole: input.actorRole }),
  });
}

/** Enable/disable a staff member's access + audit. */
export function setStaffStatus(input: {
  id: string;
  status: MockStaffMember['status'];
  actor: string;
  actorRole: string;
}): Promise<MockStaffMember> {
  return request(`/admin/staff/${input.id}`, staffMemberSchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: input.status, actor: input.actor, actorRole: input.actorRole }),
  });
}

/** Permanently delete a staff member (super-admin only, enforced by callers) + audit. */
export function deleteStaff(input: {
  id: string;
  actor: string;
  actorRole: string;
}): Promise<void> {
  return request(`/admin/staff/${input.id}`, z.object({ id: z.string(), deleted: z.boolean() }), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor: input.actor, actorRole: input.actorRole }),
  }).then(() => undefined);
}

/** Email uniqueness is enforced server-side (409) and surfaced in submit errors. */
