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
  getCustomerMembership,
  getCustomerPayments,
  getCustomerPoints,
  getCustomerPointsLedger,
  getCustomerProfile,
  reissueCardCredentials,
} from './services';
import type { CustomerActivationRequest } from '@jad/contracts';

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

export const useCustomerPointsQuery = (enabled = true) =>
  useQuery({ queryKey: ['customer', 'points'], queryFn: getCustomerPoints, enabled });

export const useCustomerLedgerQuery = (enabled = true) =>
  useQuery({
    queryKey: ['customer', 'points', 'ledger'],
    queryFn: getCustomerPointsLedger,
    enabled,
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
