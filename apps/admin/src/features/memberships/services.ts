/**
 * AF Homes Phase 10 membership card-management API client.
 *
 * Every call goes through `lib/api/client`, which validates the response
 * against `@jad/contracts`. The browser never sees a credential hash, and
 * plaintext codes exist only in the once-only reissue response, held in React
 * state until the dialog closes.
 */
import {
  markedPrintedSchema,
  membershipCardSchema,
  membershipSchema,
  reissuedMembershipCardSchema,
  type MarkedPrinted,
  type Membership,
  type MembershipCard,
  type ReissuedMembershipCard,
} from '@jad/contracts';
import { z } from 'zod';
import { request, requestList } from '../../lib/api/client';

const post = <T>(path: string, schema: z.ZodType<T>, body: unknown) =>
  request(path, schema, { method: 'POST', body: JSON.stringify(body) });

export const getMemberships = (status = ''): Promise<Membership[]> => {
  const suffix = status ? `?status=${encodeURIComponent(status)}` : '';
  return requestList(`/memberships${suffix}`, membershipSchema);
};

export const getMembershipCard = (id: string): Promise<MembershipCard> =>
  request(`/memberships/${id}/card`, membershipCardSchema);

export const reissueMembershipCard = (
  id: string,
  reason: string,
): Promise<ReissuedMembershipCard> =>
  post(`/memberships/${id}/reissue`, reissuedMembershipCardSchema, { reason });

export const markMembershipPrinted = (id: string): Promise<MarkedPrinted> =>
  post(`/memberships/${id}/mark-printed`, markedPrintedSchema, {});
