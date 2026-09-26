import { z } from 'zod';

import { archivedMemberSchema, type ArchivedMember } from '@jad/contracts';

import { request, requestList } from '../../../lib/api/client';

/** Archived roster + restore - REST over api/v1 (Phase B3 cutover). */
export async function getArchived(): Promise<ArchivedMember[]> {
  return requestList('/admin/members/archived', archivedMemberSchema);
}

export async function getArchivedById(id: string): Promise<ArchivedMember | undefined> {
  const all = await getArchived();
  return all.find((a) => a.id === id);
}

export async function getArchivedByMemberId(memberId: string): Promise<ArchivedMember | undefined> {
  const all = await getArchived();
  return all.find((a) => a.memberId === memberId);
}

export async function restoreArchivedMember(archivedId: string): Promise<void> {
  const all = await getArchived();
  const record = all.find((a) => a.id === archivedId);
  if (!record) throw new Error('Archived record not found');
  await request(`/admin/members/${record.memberId}/restore`, z.object({ id: z.string() }), {
    method: 'POST',
  });
}
