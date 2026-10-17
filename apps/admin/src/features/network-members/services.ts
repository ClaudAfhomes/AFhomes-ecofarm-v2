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
  createOstMemberResultSchema,
  memberDetailSchema,
  memberSchema,
  type AfHomesDepartment,
  type CreateMember,
  type CreateOstMember,
  type CreateOstMemberResult,
  type IssueAccreditation,
  type Member,
  type MemberDetail,
  type MemberPosition,
  type TransferMember,
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

/**
 * AA numbers are typed as issued: the official `AAI` + YYMM + sequence shape,
 * or an already-issued legacy `AA-` identifier (a recorded number is never
 * renumbered). `manualIstAaNumberSchema` from the contracts is the validator;
 * this only tidies the entry so a paste with spaces still validates.
 */
export function normalizeAaEntry(value: string): string {
  return value.toUpperCase().replace(/\s+/g, '');
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

/**
 * Create an OST directly: `complete` approves the accreditation in the same
 * act, `pending` leaves the application for the sponsored workflow. Both take
 * the same official form; neither records an endorsement.
 */
export const createOstMember = (input: CreateOstMember): Promise<CreateOstMemberResult> =>
  request('/members/ost', createOstMemberResultSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });

/**
 * Transfer a member between IST and OST. The server revokes the held AA
 * number into the accreditation history and issues the successor in one
 * transaction; the client sends no number.
 */
export const transferMember = (id: string, input: TransferMember): Promise<Member> =>
  request(`/members/${id}/transfer`, memberSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const updateMember = (id: string, input: UpdateMemberProfile): Promise<Member> =>
  request(`/members/${id}`, memberSchema, { method: 'PATCH', body: JSON.stringify(input) });

export const issueMemberAccreditation = (id: string, input: IssueAccreditation): Promise<Member> =>
  request(`/members/${id}/accreditation`, memberSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const getMemberDepartments = (): Promise<AfHomesDepartment[]> =>
  requestList('/admin/afhomes/departments', afHomesDepartmentSchema);
