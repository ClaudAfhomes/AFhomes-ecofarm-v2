import { memberProfileSchema, type MemberProfile } from '@jad/contracts';

import { request, requestList } from '../../../lib/api/client';

/** Fetch all members. */
export function getMembers(): Promise<MemberProfile[]> {
  return requestList('/admin/members', memberProfileSchema);
}

/** Fetch a single member by ID. */
export function getMember(id: string): Promise<MemberProfile> {
  return request(`/admin/members/${id}`, memberProfileSchema);
}
