import { z } from 'zod';

import { roleRecordSchema, type RoleRecord, type StaffModule } from '@jad/contracts';

import { request, requestList } from '../../../lib/api/client';
import type { StaffAuditActor } from '../../staff/services/staff';

/** Role directory - REST over api/v1 (Phase B4 cutover). */
export function getRoles(): Promise<RoleRecord[]> {
  return requestList('/admin/roles', roleRecordSchema);
}

export function getRole(id: string): Promise<RoleRecord | undefined> {
  return request(`/admin/roles/${id}`, roleRecordSchema).catch(() => undefined);
}

/** Create a custom role + audit. */
export function createRole(
  input: { name: string; permissions: StaffModule[] } & StaffAuditActor,
): Promise<RoleRecord> {
  return request('/admin/roles', roleRecordSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

/** Rename a role and/or replace its permission set + audit. */
export function updateRole(
  input: { id: string; name?: string; permissions?: StaffModule[] } & StaffAuditActor,
): Promise<RoleRecord> {
  const { id, ...patch } = input;
  return request(`/admin/roles/${id}`, roleRecordSchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/** Delete a role (super admins only) + audit. */
export function deleteRole(input: { id: string } & StaffAuditActor): Promise<void> {
  return request(`/admin/roles/${input.id}`, z.object({ id: z.string(), deleted: z.boolean() }), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor: input.actor, actorRole: input.actorRole }),
  }).then(() => undefined);
}
