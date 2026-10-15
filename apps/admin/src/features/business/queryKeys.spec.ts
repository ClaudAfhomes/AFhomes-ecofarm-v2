import { describe, expect, it } from 'vitest';

import {
  applicationKeys,
  businessKeys,
  earningKeys,
  membershipKeys,
  reservationKeys,
  sharedScopes,
} from './queryKeys';

/**
 * Pinning spec: the factory must emit the exact segments the pages have
 * always used. Change a segment and this fails before any cache can go stale
 * silently (a key typo is invisible to every other spec, which mocks fetch).
 */
describe('business query keys', () => {
  it('builds the business root keys', () => {
    expect(businessKeys.all).toEqual(['business']);
    expect(businessKeys.queue).toEqual(['business', 'queue']);
    expect(businessKeys.activationQueue).toEqual(['business', 'queue', 'activation']);
    expect(businessKeys.financeQueue('gold')).toEqual(['business', 'queue', 'finance', 'gold']);
    expect(businessKeys.customers({ a: 1 }, { b: 2 }, 0)).toEqual([
      'business',
      'customers',
      { a: 1 },
      { b: 2 },
      0,
    ]);
    expect(businessKeys.customersScope).toEqual(['business', 'customers']);
    expect(businessKeys.salePayments('s-1')).toEqual(['business', 'sale-payments', 's-1']);
    expect(businessKeys.cardProducts('gold', 'all')).toEqual([
      'business',
      'card-products',
      'gold',
      'all',
    ]);
    expect(businessKeys.commissions({ status: 'pending' })).toEqual([
      'business',
      'commissions',
      { status: 'pending' },
    ]);
  });

  it('builds the earning keys', () => {
    expect(earningKeys.all).toEqual(['earning']);
    expect(earningKeys.purchases(2)).toEqual(['earning', 'purchases', 2]);
    expect(earningKeys.purchaseSummary('p-1')).toEqual(['earning', 'purchase', 'p-1', 'summary']);
    expect(earningKeys.settlement('p-1')).toEqual(['earning', 'settlement', 'p-1']);
    expect(earningKeys.settlementScope).toEqual(['earning', 'settlement']);
  });

  it('builds the application and reservation keys', () => {
    expect(applicationKeys.list('s', 't', 'q', 'f', 't2', true, 0)).toEqual([
      'customer-applications',
      's',
      't',
      'q',
      'f',
      't2',
      true,
      0,
    ]);
    expect(applicationKeys.scope).toEqual(['customer-applications']);
    expect(applicationKeys.detail('a-1')).toEqual(['customer-application', 'a-1']);
    expect(applicationKeys.reservations('a-1')).toEqual([
      'customer-application-reservations',
      'a-1',
    ]);
    expect(reservationKeys.list('s', 't', 'q', 'f', 't2', false, 1)).toEqual([
      'reservation-agreements',
      's',
      't',
      'q',
      'f',
      't2',
      false,
      1,
    ]);
    expect(reservationKeys.scope).toEqual(['reservation-agreements']);
    expect(reservationKeys.detail('r-1')).toEqual(['reservation-agreement', 'r-1']);
    expect(reservationKeys.finance('r-1')).toEqual(['reservation-finance', 'r-1']);
  });

  it('keeps every scope a prefix of the keys it clears', () => {
    const startsWith = (full: readonly unknown[], prefix: readonly unknown[]) =>
      prefix.every((segment, index) => segment === full[index]);
    expect(startsWith(businessKeys.activationQueue, businessKeys.queue)).toBe(true);
    expect(startsWith(businessKeys.financeQueue(''), businessKeys.queue)).toBe(true);
    expect(startsWith(businessKeys.customers({}, {}, 0), businessKeys.customersScope)).toBe(true);
    expect(startsWith(businessKeys.salePayments('x'), businessKeys.salePaymentsScope)).toBe(true);
    expect(startsWith(earningKeys.purchaseSummary('x'), earningKeys.purchase('x'))).toBe(true);
    expect(startsWith(earningKeys.settlement('x'), earningKeys.settlementScope)).toBe(true);
    expect(membershipKeys.customerLookupScope).toEqual(['customer-lookup']);
    expect(startsWith(membershipKeys.customerLookup('DELA'), membershipKeys.customerLookupScope)).toBe(
      true,
    );
  });

  it('documents that detail keys sit outside the list scope', () => {
    // `customer-application/:id` (singular) is not under `customer-applications`
    // (plural), so clearing the list never refreshes an open detail: detail
    // pages must invalidate their own key. Pinned so a future "cleanup" cannot
    // silently change that behavior.
    const startsWith = (full: readonly unknown[], prefix: readonly unknown[]) =>
      prefix.every((segment, index) => segment === full[index]);
    expect(startsWith(applicationKeys.detail('x'), applicationKeys.scope)).toBe(false);
  });

  it('exposes the scopes business pages share with other domains', () => {
    expect(sharedScopes.memberships).toEqual(['memberships']);
    expect(sharedScopes.memberLookup).toEqual(['member-lookup']);
    expect(sharedScopes.reports).toEqual(['reports']);
    expect(sharedScopes.documentsCustomer('c-1')).toEqual(['documents', 'customer', 'c-1']);
  });
});
