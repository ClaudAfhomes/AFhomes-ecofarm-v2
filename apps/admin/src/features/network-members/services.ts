/**
 * AFHomes sales-network Members API client.
 *
 * Every call goes through `lib/api/client`, which validates the response
 * against `@afhomes/contracts`. Secrets (temporary password, TIN, government
 * ID number) travel to the server only; list reads carry masks and the
 * single-record read returns the identification fields for the record view.
 */
import {
  afHomesDepartmentSchema,
  memberDetailSchema,
  memberSchema,
  type AfHomesDepartment,
  type CreateMember,
  type IssueAccreditation,
  type Member,
  type MemberDetail,
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
  detail: (id: string) => ['network', 'members', 'detail', id] as const,
};

/** Typed AA numbers: AA plus 4 to 12 uppercase letters/digits, no separators. */
export const AA_MANUAL_RE = /^AA[A-Z0-9]{4,12}$/;

/**
 * The AA field always carries its prefix: typing can never remove it, and an
 * emptied field falls back to the bare prefix. Only the body after AA is
 * ever edited.
 */
export function withAaPrefix(value: string): string {
  const tail = value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 14);
  const body = (tail.startsWith('AA') ? tail.slice(2) : tail).slice(0, 12);
  return `AA${body}`;
}

export const getMembers = (params: {
  search?: string;
  position?: MemberPosition;
}): Promise<Member[]> => {
  const query = new URLSearchParams();
  if (params.search?.trim()) query.set('search', params.search.trim());
  if (params.position) query.set('position', params.position);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return requestList(`/members${suffix}`, memberSchema);
};

export const getMember = (id: string): Promise<MemberDetail> =>
  request(`/members/${id}`, memberDetailSchema);

export const getMemberUplines = (position: MemberPosition): Promise<MemberUpline[]> =>
  requestList(`/members/uplines?position=${position}`, memberUplineSchema);

export const getMemberOstReferrers = (): Promise<MemberUpline[]> =>
  requestList('/members/ost-referrers', memberUplineSchema);

export const createMember = (input: CreateMember): Promise<Member> =>
  request('/members', memberSchema, { method: 'POST', body: JSON.stringify(input) });

export const updateMember = (id: string, input: UpdateMemberProfile): Promise<Member> =>
  request(`/members/${id}`, memberSchema, { method: 'PATCH', body: JSON.stringify(input) });

export const issueMemberAccreditation = (id: string, input: IssueAccreditation): Promise<Member> =>
  request(`/members/${id}/accreditation`, memberSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const getMemberDepartments = (): Promise<AfHomesDepartment[]> =>
  requestList('/admin/afhomes/departments', afHomesDepartmentSchema);
