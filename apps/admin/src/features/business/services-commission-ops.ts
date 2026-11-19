/** Commission operations client: holds, payout records, proposed recoveries. */
import {
  commissionOpResultSchema,
  commissionPayoutSchema,
  commissionRecoveryCaseSchema,
  type CommissionPayout,
  type CommissionRecoveryCase,
  type DismissCommissionRecoveryRequest,
  type ProposeCommissionRecoveryRequest,
  type ReconcileCommissionPayoutRequest,
  type RecordCommissionPayoutFailureRequest,
  type SetCommissionHoldRequest,
} from '@afhomes/contracts';

import {
  protectedRequest as request,
  protectedRequestList as requestList,
} from '../../lib/api/client';

const post = (path: string, body: unknown) =>
  request(path, commissionOpResultSchema, { method: 'POST', body: JSON.stringify(body) });

export const setCommissionHold = (id: string, input: SetCommissionHoldRequest) =>
  post(`/commissions/${id}/hold`, input);

export const getCommissionPayouts = (id: string): Promise<CommissionPayout[]> =>
  requestList(`/commissions/${id}/payouts`, commissionPayoutSchema);

export const getCommissionRecoveries = (id: string): Promise<CommissionRecoveryCase[]> =>
  requestList(`/commissions/${id}/recoveries`, commissionRecoveryCaseSchema);

export const recordCommissionPayoutFailure = (
  id: string,
  input: RecordCommissionPayoutFailureRequest,
) => post(`/commissions/${id}/payouts/fail`, input);

export const reconcileCommissionPayout = (
  payoutId: string,
  input: ReconcileCommissionPayoutRequest,
) => post(`/commissions/payouts/${payoutId}/reconcile`, input);

export const proposeCommissionRecovery = (id: string, input: ProposeCommissionRecoveryRequest) =>
  post(`/commissions/${id}/recoveries`, input);

export const dismissCommissionRecovery = (
  caseId: string,
  input: DismissCommissionRecoveryRequest,
) => post(`/commissions/recoveries/${caseId}/dismiss`, input);
