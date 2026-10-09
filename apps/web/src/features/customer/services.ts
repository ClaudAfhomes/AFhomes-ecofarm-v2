/**
 * Customer portal API calls. Every function is thin: the path, the HTTP verb and
 * the contract schema, nothing else. No business rule and no authorization
 * decision lives in the browser.
 */
import {
  customerActivationResultSchema,
  customerCredentialsSchema,
  customerMembershipSchema,
  customerPaymentSchema,
  customerPointsEntrySchema,
  pointsBalanceSummarySchema,
  customerPointsSummarySchema,
  customerProfileSchema,
  claimEarningPointsResultSchema,
  type ClaimEarningPointsRequest,
  type ClaimEarningPointsResult,
  type CustomerActivationRequest,
  type CustomerActivationResult,
  type CustomerCredentials,
  type CustomerMembership,
  type CustomerPayment,
  type CustomerPointsEntry,
  type CustomerPointsSummary,
  type PointsBalanceSummary,
  type CustomerProfile,
} from '@afhomes/contracts';

import { request, requestList } from '../../lib/api/client';

/**
 * Redeem an onboarding token and create the customer's sign-in.
 *
 * Unauthenticated by necessity. The response contains NO session: the caller
 * must follow up with `signInWithPassword`, so no credential is ever minted or
 * proxied by this endpoint.
 */
export const activateCustomer = (
  body: CustomerActivationRequest,
): Promise<CustomerActivationResult> =>
  request('/auth/customer/activate', customerActivationResultSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const getCustomerProfile = (): Promise<CustomerProfile> =>
  request('/customer', customerProfileSchema);

export const getCustomerMembership = (): Promise<CustomerMembership> =>
  request('/customer/membership', customerMembershipSchema);

/**
 * The LEGACY points summary. Its shape is frozen because deployed clients already
 * validate against it; nothing here may be removed or re-interpreted.
 */
export const getCustomerPoints = (): Promise<CustomerPointsSummary> =>
  request('/customer/points', customerPointsSummarySchema);

/**
 * The member's points POSITION: balance, spendable, and remaining annual earning
 * capacity, with reversal debt separate.
 *
 * A separate endpoint from `getCustomerPoints` on purpose - see the API notes.
 * Every figure is computed in SQL; the browser does no points arithmetic.
 */
export const getCustomerPointsPosition = (): Promise<PointsBalanceSummary> =>
  request('/customer/points/position', pointsBalanceSummarySchema);

export const getCustomerPointsLedger = (): Promise<CustomerPointsEntry[]> =>
  requestList('/customer/points/ledger', customerPointsEntrySchema);

export const getCustomerPayments = (): Promise<CustomerPayment[]> =>
  requestList('/customer/payments', customerPaymentSchema);

/**
 * Request fresh card credentials. The previous QR and fallback code stop working
 * immediately, and the new plaintext is returned exactly once - it is never
 * cached, so this call must not be retried automatically.
 */
export const reissueCardCredentials = (): Promise<CustomerCredentials> =>
  request('/customer/membership/credentials', customerCredentialsSchema, { method: 'POST' });

/**
 * Redeem an earning claim the member was given - the QR scan, or the typed
 * fallback code.
 *
 * The body carries ONLY the credential. The member's identity comes from the
 * session, and the server refuses a claim belonging to anyone else. So this
 * cannot award points to a different account no matter what the caller sends.
 *
 * NOT auto-retried: a claim is single-use, and a retried request would turn a
 * success whose response was lost into a confusing "already used" error.
 */
export const claimEarningPoints = (
  body: ClaimEarningPointsRequest,
): Promise<ClaimEarningPointsResult> =>
  request('/earning/claim', claimEarningPointsResultSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export type {
  CustomerProfile,
  CustomerMembership,
  CustomerPointsSummary, CustomerPointsEntry, CustomerPayment, CustomerCredentials };
