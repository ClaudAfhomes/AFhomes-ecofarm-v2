/**

 * Commission API client.

 * 

 * Earnings, qualification and payout decisions, rules, and rule history.

 */

import {
  commissionRuleSchema,
  commissionSchema,
  type Commission,
  type CommissionRule,
  type CreateCommissionRuleRequest,
  type MarkCommissionPaidRequest,
  type QualifyCommissionRequest,
  type UpdateCommissionRuleRequest,
} from '@afhomes/contracts';

import { z } from 'zod';

import {
  protectedRequest as request,
  protectedRequestList as requestList,
} from '../../lib/api/client';

const post = <T>(path: string, schema: z.ZodType<T>, body: unknown) =>
  request(path, schema, { method: 'POST', body: JSON.stringify(body) });

const patch = <T>(path: string, schema: z.ZodType<T>, body: unknown) =>
  request(path, schema, { method: 'PATCH', body: JSON.stringify(body) });

/* ------------------------------------------------------------------ */
/* Commissions                                                         */
/* ------------------------------------------------------------------ */

export const getCommissions = (
  params: { status?: string; search?: string; seller?: string } = {},
): Promise<Commission[]> => {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.search) query.set('search', params.search);
  if (params.seller) query.set('seller', params.seller);
  const suffix = query.toString();
  return requestList(`/commissions${suffix ? `?${suffix}` : ''}`, commissionSchema);
};

export const qualifyCommission = (
  id: string,
  input: QualifyCommissionRequest,
): Promise<Commission> => post(`/commissions/${id}/qualify`, commissionSchema, input);

export const markCommissionPaid = (
  id: string,
  input: MarkCommissionPaidRequest = {},
): Promise<Commission> => post(`/commissions/${id}/pay`, commissionSchema, input);

export const getCommissionRules = (): Promise<CommissionRule[]> =>
  requestList('/commissions/rules', commissionRuleSchema);
export const createCommissionRule = (input: CreateCommissionRuleRequest): Promise<CommissionRule> =>
  post('/commissions/rules', commissionRuleSchema, input);
export const updateCommissionRule = (
  id: string,
  input: UpdateCommissionRuleRequest,
): Promise<CommissionRule> => patch(`/commissions/rules/${id}`, commissionRuleSchema, input);
const commissionRuleHistorySchema = z.object({
  id: z.union([z.string(), z.number()]),
  action: z.string(),
  actorId: z.string().nullable(),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type CommissionRuleHistory = z.infer<typeof commissionRuleHistorySchema>;
export const getCommissionRuleHistory = (id: string): Promise<CommissionRuleHistory[]> =>
  requestList(`/commissions/rules/${id}/history`, commissionRuleHistorySchema);
