/**
 * AFHomes sales-network Members API client.
 *
 * Every call goes through `lib/api/client`, which validates the response
 * against `@afhomes/contracts`. Secrets (temporary password, TIN, government
 * ID number) travel to the server only; reads carry masks.
 */
import {
  afHomesDepartmentSchema,
  memberSchema,
  type AfHomesDepartment,
  type CreateMember,
  type Member,
  type MemberPosition,
  type UpdateMemberProfile,
} from '@afhomes/contracts';
import { z } from 'zod';
import {
  protectedRequest as request,
  protectedRequestList as requestList,
} from '../../lib/api/client';

export const memberUplineSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  employeeNumber: z.string().nullable(),
  positionLabel: z.string(),
});
export type MemberUpline = z.infer<typeof memberUplineSchema>;

export const networkMemberKeys = {
  scope: ['network', 'members'] as const,
  list: (search: string, position: string) => ['network', 'members', search, position] as const,
};

export const getMembers = (params: { search?: string; position?: MemberPosition }): Promise<Member[]> => {
  const query = new URLSearchParams();
  if (params.search?.trim()) query.set('search', params.search.trim());
  if (params.position) query.set('position', params.position);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return requestList(`/members${suffix}`, memberSchema);
};

export const getMember = (id: string): Promise<Member> => request(`/members/${id}`, memberSchema);

export const getMemberUplines = (position: MemberPosition): Promise<MemberUpline[]> =>
  requestList(`/members/uplines?position=${position}`, memberUplineSchema);

export const getMemberOstReferrers = (): Promise<MemberUpline[]> =>
  requestList('/members/ost-referrers', memberUplineSchema);

export const createMember = (input: CreateMember): Promise<Member> =>
  request('/members', memberSchema, { method: 'POST', body: JSON.stringify(input) });

export const updateMember = (id: string, input: UpdateMemberProfile): Promise<Member> =>
  request(`/members/${id}`, memberSchema, { method: 'PATCH', body: JSON.stringify(input) });

export const getMemberDepartments = (): Promise<AfHomesDepartment[]> =>
  requestList('/admin/afhomes/departments', afHomesDepartmentSchema);
