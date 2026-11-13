/** Finance period summary and month-end close API client. */

import {
  accountingPeriodSchema,
  financePeriodSummarySchema,
  type AccountingPeriod,
  type FinancePeriodSummary,
} from '@afhomes/contracts';
import { z } from 'zod';

import {
  protectedRequest as request,
  protectedRequestList as requestList,
} from '../../lib/api/client';

const periodResultSchema = z.object({
  period: z.string(),
  status: z.enum(['open', 'ready_for_approval', 'closed']),
  snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const getFinanceSummary = (period?: string): Promise<FinancePeriodSummary> =>
  request(
    `/queues/finance-summary${period ? `?period=${encodeURIComponent(period)}` : ''}`,
    financePeriodSummarySchema,
  );

export const getAccountingPeriods = (): Promise<AccountingPeriod[]> =>
  requestList('/queues/periods', accountingPeriodSchema);

const act = (period: string, action: 'submit' | 'return' | 'close', body?: unknown) =>
  request(`/queues/periods/${encodeURIComponent(period)}/${action}`, periodResultSchema, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  });

export const submitPeriod = (period: string) => act(period, 'submit');
export const returnPeriod = (period: string, reason: string) => act(period, 'return', { reason });
export const closePeriod = (period: string) => act(period, 'close');
