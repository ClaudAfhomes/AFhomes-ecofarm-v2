/**
 * Customer portal API calls. Every function is thin: the path, the HTTP verb and
 * the contract schema, nothing else. No business rule and no authorization
 * decision lives in the browser.
 */
import {
  customerActivationResultSchema,
  customerCredentialsSchema,
  customerMembershipSchema,
  customerPointsEntrySchema,
  customerPointsSummarySchema,
  customerProfileSchema,
  type CustomerActivationRequest,
  type CustomerActivationResult,
  type CustomerCredentials,
  type CustomerMembership,
  type CustomerPointsEntry,
  type CustomerPointsSummary,
  type CustomerProfile,
} from '@jad/contracts';

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

export const getCustomerPoints = (): Promise<CustomerPointsSummary> =>
  request('/customer/points', customerPointsSummarySchema);

export const getCustomerPointsLedger = (): Promise<CustomerPointsEntry[]> =>
  requestList('/customer/points/ledger', customerPointsEntrySchema);

/**
 * Request fresh card credentials. The previous QR and fallback code stop working
 * immediately, and the new plaintext is returned exactly once - it is never
 * cached, so this call must not be retried automatically.
 */
export const reissueCardCredentials = (): Promise<CustomerCredentials> =>
  request('/customer/membership/credentials', customerCredentialsSchema, { method: 'POST' });

export type { CustomerProfile, CustomerMembership, CustomerPointsSummary, CustomerPointsEntry, CustomerCredentials };
