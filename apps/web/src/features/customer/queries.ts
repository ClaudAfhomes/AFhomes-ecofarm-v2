import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * Server-state hooks for the customer portal.
 *
 * Every one of these is a READ except `useReissueCredentials`, and that one is a
 * deliberate, explicitly-invoked mutation: it invalidates the member's existing
 * card code, so it must never be fired by a render, a refetch or an automatic
 * retry.
 */
import {
  activateCustomer,
  claimEarningPoints,
  getCustomerMembership,
  getCustomerPayments,
  getCustomerPoints,
  getCustomerPointsLedger,
  getCustomerPointsPosition,
  getCustomerProfile,
  reissueCardCredentials,
} from './services';
import type { ClaimEarningPointsRequest, CustomerActivationRequest } from '@afhomes/contracts';

/** The customer's own record. Also the ownership check: a 403 here means the
 *  signed-in Auth user is not a customer at all. */
export const useCustomerProfileQuery = () =>
  useQuery({ queryKey: ['customer', 'profile'], queryFn: getCustomerProfile });

export const useCustomerMembershipQuery = (enabled = true) =>
  useQuery({
    queryKey: ['customer', 'membership'],
    queryFn: getCustomerMembership,
    enabled,
  });

/**
 * The LEGACY summary. Kept because deployed clients depend on its shape.
 *
 * Separate query key from the position: two different endpoints returning two
 * different shapes must never share a cache entry, or one would satisfy the other.
 */
export const useCustomerPointsQuery = (enabled = true) =>
  useQuery({
    queryKey: ['customer', 'points', 'summary'],
    queryFn: getCustomerPoints,
    enabled,
    // Staff redemptions debit this balance from another session.
    refetchInterval: 30_000,
  });

/**
 * Balance, spendable and remaining annual earning capacity, with reversal debt
 * reported on its own. This is what any screen that needs to distinguish those
 * three figures must read.
 */
export const useCustomerPointsPositionQuery = (enabled = true) =>
  useQuery({
    queryKey: ['customer', 'points', 'position'],
    queryFn: getCustomerPointsPosition,
    enabled,
    refetchInterval: 30_000,
  });

export const useCustomerLedgerQuery = (enabled = true) =>
  useQuery({
    queryKey: ['customer', 'points', 'ledger'],
    queryFn: getCustomerPointsLedger,
    enabled,
    refetchInterval: 30_000,
  });

export const useCustomerPaymentsQuery = (enabled = true) =>
  useQuery({
    queryKey: ['customer', 'payments'],
    queryFn: getCustomerPayments,
    enabled,
  });

export const useActivateMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CustomerActivationRequest) => activateCustomer(body),
    // The profile is only resolvable once the Auth user exists, so anything
    // customer-scoped cached before activation is now stale by definition.
    onSuccess: () => client.invalidateQueries({ queryKey: ['customer'] }),
  });
};

/**
 * Redeem an earning claim.
 *
 * `retry: 0` is load-bearing, not a default. A claim is single-use and the
 * compare-and-set happens in SQL: if the response to a successful claim is lost,
 * an automatic retry returns "already used" and the member sees a failure for a
 * request that actually paid out. Never retry this.
 *
 * The balance and the ledger both change, so both are invalidated on success.
 */
export const useClaimEarningPoints = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ClaimEarningPointsRequest) => claimEarningPoints(body),
    retry: 0,
    // A claim changes the balance, so BOTH the position and the legacy summary are
    // now stale. They share a key prefix, so one invalidation covers both.
    onSuccess: () => client.invalidateQueries({ queryKey: ['customer', 'points'] }),
  });
};

export const useReissueCredentials = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: reissueCardCredentials,
    // Deliberately NOT invalidated: the plaintext is returned once, is never
    // cached, and must not be re-fetched. Only the membership summary (which
    // changes nothing visible) is left alone.
    onSuccess: () => client.invalidateQueries({ queryKey: ['customer', 'membership'] }),
  });
};
