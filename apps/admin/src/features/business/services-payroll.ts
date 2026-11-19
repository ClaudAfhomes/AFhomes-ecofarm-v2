/** IST payroll API client (queues family, `payroll/*`). Contracts are the single source. */

import {
  governedActionResultSchema,
  istEngagementSchema,
  istPeriodPerformanceSchema,
  istPerformanceRuleSchema,
  istStaffPerformanceEvidenceSchema,
  payrollBatchDetailSchema,
  payrollLineCalculationSchema,
  payrollBatchSchema,
  payrollGateSchema,
  payrollPoliciesResponseSchema,
  payrollRosterEntrySchema,
  pendingPayrollApprovalSchema,
  type PayrollBatch,
  type PayrollBatchDetail,
  type PayrollDisbursementRequest,
  type PayrollGate,
  type PayrollPoliciesResponse,
  type PayrollRosterEntry,
  type PendingPayrollApproval,
  type ApprovePolicyInput,
  type EndPolicyInput,
  type EngagementDraftInput,
  type EngagementEndInput,
  type GovernedActionResult,
  type IstEngagement,
  type IstPeriodPerformance,
  type IstPerformanceRule,
  type IstStaffPerformanceEvidence,
  type PerformanceRuleDraftInput,
  type PerformanceRuleEndInput,
  type PolicyDraftInput,
  type ReviewPayrollLineInput,
  type SimulatePayrollRequest,
} from '@afhomes/contracts';
import { z } from 'zod';

import {
  protectedRequest as request,
  protectedRequestList as requestList,
} from '../../lib/api/client';

/** Every payroll query lives under `['payroll']` so one invalidation refreshes all of them. */
export const payrollKeys = {
  all: ['payroll'] as const,
  gate: ['payroll', 'gate'] as const,
  batches: (period: string) => ['payroll', 'batches', period] as const,
  batch: (id: string) => ['payroll', 'batch', id] as const,
  approvals: ['payroll', 'approvals'] as const,
  roster: (q: string) => ['payroll', 'roster', q] as const,
  policies: ['payroll', 'policies'] as const,
  engagements: ['payroll', 'engagements'] as const,
  rules: ['payroll', 'performance-rules'] as const,
  performance: (period: string) => ['payroll', 'performance', period] as const,
  evidence: (period: string, staffId: string) =>
    ['payroll', 'performance', period, 'evidence', staffId] as const,
};

const ack = z.object({}).passthrough();
const send = (path: string, body?: unknown) =>
  request(path, ack, { method: 'POST', body: JSON.stringify(body ?? {}) });

export const getPayrollGate = (): Promise<PayrollGate> =>
  request('/queues/payroll/gate', payrollGateSchema);

export const getPayrollRoster = (q: string): Promise<PayrollRosterEntry[]> =>
  requestList(
    `/queues/payroll/roster?q=${encodeURIComponent(q)}&limit=20`,
    payrollRosterEntrySchema,
  );

export const getPayrollPolicies = (): Promise<PayrollPoliciesResponse> =>
  request('/queues/payroll/policies', payrollPoliciesResponseSchema);

export const getPayrollBatches = (period: string): Promise<PayrollBatch[]> =>
  requestList(`/queues/payroll/batches?period=${encodeURIComponent(period)}`, payrollBatchSchema);

export const getPayrollBatch = (id: string): Promise<PayrollBatchDetail> =>
  request(`/queues/payroll/batches/${encodeURIComponent(id)}`, payrollBatchDetailSchema);

export const getPayrollApprovals = (): Promise<PendingPayrollApproval[]> =>
  requestList('/queues/payroll/approvals', pendingPayrollApprovalSchema);

export const generatePayrollDraft = (period: string) => send('/queues/payroll/batches', { period });

export const simulatePayroll = (input: SimulatePayrollRequest): Promise<PayrollBatchDetail> =>
  request('/queues/payroll/simulations', payrollBatchDetailSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });

const batchAction = (
  id: string,
  action: 'submit' | 'approve' | 'return' | 'close',
  body?: unknown,
) => send(`/queues/payroll/batches/${encodeURIComponent(id)}/${action}`, body);

export const submitPayrollBatch = (id: string) => batchAction(id, 'submit');
export const approvePayrollBatch = (id: string) => batchAction(id, 'approve');
export const closePayrollBatch = (id: string) => batchAction(id, 'close');
export const returnPayrollBatch = (id: string, reason: string) =>
  batchAction(id, 'return', { reason });

/** Simulation lines only; a live line must never be sent here (and vice versa). */
export const recordSimulatedPayrollDisbursement = (
  lineId: string,
  input: PayrollDisbursementRequest,
) => send(`/queues/payroll/simulations/lines/${encodeURIComponent(lineId)}/disbursements`, input);

export const recordPayrollDisbursement = (lineId: string, input: PayrollDisbursementRequest) =>
  send(`/queues/payroll/lines/${encodeURIComponent(lineId)}/disbursements`, input);

export const reconcilePayrollDisbursement = (
  id: string,
  input: { note: string; evidenceReference: string },
) => send(`/queues/payroll/disbursements/${encodeURIComponent(id)}/reconcile`, input);

const policyPath = (id: string, action?: string) =>
  `/queues/payroll/policies/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;

export const createPayrollPolicyDraft = (input: PolicyDraftInput, idempotencyKey?: string) =>
  request('/queues/payroll/policies', ack, {
    method: 'POST',
    body: JSON.stringify(input),
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
  });
export const updatePayrollPolicyDraft = (id: string, input: PolicyDraftInput) =>
  request(policyPath(id), ack, { method: 'PUT', body: JSON.stringify(input) });
export const submitPayrollPolicy = (id: string) => send(policyPath(id, 'submit'));
export const returnPayrollPolicy = (id: string, reason: string) =>
  send(policyPath(id, 'return'), { reason });
export const approvePayrollPolicy = (id: string, input: ApprovePolicyInput) =>
  send(policyPath(id, 'approve'), input);
export const endPayrollPolicy = (id: string, input: EndPolicyInput) =>
  send(policyPath(id, 'end'), input);
/* ---- IST engagements, performance rules and performance evidence ---- */

export type GovernedKind = 'engagements' | 'performance-rules';

const governedPath = (kind: GovernedKind, id?: string, action?: string) =>
  `/queues/payroll/${kind}${id ? `/${encodeURIComponent(id)}` : ''}${action ? `/${action}` : ''}`;
const governedSend = (path: string, body?: unknown): Promise<GovernedActionResult> =>
  request(path, governedActionResultSchema, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  });

export const getIstEngagements = (): Promise<IstEngagement[]> =>
  requestList('/queues/payroll/engagements', istEngagementSchema);
export const getIstPerformanceRules = (): Promise<IstPerformanceRule[]> =>
  requestList('/queues/payroll/performance-rules', istPerformanceRuleSchema);

export const createGovernedDraft = (
  kind: GovernedKind,
  input: EngagementDraftInput | PerformanceRuleDraftInput,
  idempotencyKey?: string,
): Promise<GovernedActionResult> =>
  request(governedPath(kind), governedActionResultSchema, {
    method: 'POST',
    body: JSON.stringify(input),
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
  });
export const updateGovernedDraft = (
  kind: GovernedKind,
  id: string,
  input: EngagementDraftInput | PerformanceRuleDraftInput,
): Promise<GovernedActionResult> =>
  request(governedPath(kind, id), governedActionResultSchema, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
export const submitGoverned = (kind: GovernedKind, id: string) =>
  governedSend(governedPath(kind, id, 'submit'));
export const returnGoverned = (kind: GovernedKind, id: string, reason: string) =>
  governedSend(governedPath(kind, id, 'return'), { reason });
export const approveGoverned = (kind: GovernedKind, id: string, input: ApprovePolicyInput) =>
  governedSend(governedPath(kind, id, 'approve'), input);
export const endGoverned = (
  kind: GovernedKind,
  id: string,
  input: EngagementEndInput | PerformanceRuleEndInput,
) => governedSend(governedPath(kind, id, 'end'), input);

export const getIstPerformance = (period: string): Promise<IstPeriodPerformance> =>
  request(
    `/queues/payroll/performance?period=${encodeURIComponent(period)}`,
    istPeriodPerformanceSchema,
  );
export const getIstStaffEvidence = (
  period: string,
  staffId: string,
): Promise<IstStaffPerformanceEvidence> =>
  request(
    `/queues/payroll/performance/${encodeURIComponent(staffId)}/evidence?period=${encodeURIComponent(period)}`,
    istStaffPerformanceEvidenceSchema,
  );

export const reviewPayrollLine = (lineId: string, input: ReviewPayrollLineInput) =>
  send(`/queues/payroll/lines/${encodeURIComponent(lineId)}/review`, input);

export const getPayrollLineCalculation = (lineId: string) =>
  request(
    `/queues/payroll/lines/${encodeURIComponent(lineId)}/calculation`,
    payrollLineCalculationSchema,
  );
