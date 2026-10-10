import { describe, expect, it } from 'vitest';
import {
  adjustPointsInputSchema,
  claimEarningPointsRequestSchema,
  createDiscountQuoteSchema,
  createPurchaseInputSchema,
  pointsBalanceSummarySchema,
  pointEarningRuleInputSchema,
  pointsAmountSchema,
  purchaseSchema,
  resolvedMemberSchema,
} from './points.js';

const summary = {
  membershipId: '11111111-1111-4111-8111-111111111111',
  balance: 1000,
  annualCap: 40000,
  remainingEarningCapacity: 39000,
  spendable: 1000,
  reversalDebt: 0,
  periodStart: '2025-10-09',
  periodEnd: '2026-10-09',
  tier: 'SILVER' as const,
  earnedThisPeriod: 1000,
  redeemedThisPeriod: 0,
};

describe('points contracts', () => {
  it('keeps spendable and remaining earning capacity as separate figures', () => {
    // The two differ whenever debt is outstanding, and a member must never be
    // able to read one as the other.
    const parsed = pointsBalanceSummarySchema.parse({ ...summary, spendable: 0, reversalDebt: 800 });
    expect(parsed.spendable).toBe(0);
    expect(parsed.reversalDebt).toBe(800);
    expect(parsed.remainingEarningCapacity).toBe(39000);
    expect(parsed.spendable).not.toBe(parsed.remainingEarningCapacity);
  });

  it('rejects a fractional or negative point amount', () => {
    expect(pointsAmountSchema.safeParse(1.5).success).toBe(false);
    expect(pointsAmountSchema.safeParse(-1).success).toBe(false);
    expect(pointsAmountSchema.safeParse(1000).success).toBe(true);
  });

  it('rejects a client-supplied peso value on a quote request', () => {
    const base = {
      purchaseId: '11111111-1111-4111-8111-111111111111',
      pointsRequested: 25000,
    };
    expect(createDiscountQuoteSchema.safeParse(base).success).toBe(true);
    // A tampered body must not be able to state what the discount is worth.
    expect(createDiscountQuoteSchema.safeParse({ ...base, pesoValue: '1.00' }).success).toBe(false);
    expect(createDiscountQuoteSchema.safeParse({ ...base, pesoValuePerPoint: '1' }).success).toBe(
      false,
    );
    expect(createDiscountQuoteSchema.safeParse({ ...base, netAmount: '25000.00' }).success).toBe(
      false,
    );
  });

  it('rejects a client-supplied balance or award anywhere in a request', () => {
    const base = {
      purchaseId: '11111111-1111-4111-8111-111111111111',
      pointsRequested: 25000,
    };
    for (const forged of ['balance', 'pointsAwarded', 'annualCap', 'pesoValue', 'pointsBalance']) {
      expect(createDiscountQuoteSchema.safeParse({ ...base, [forged]: 1 }).success).toBe(false);
    }
  });

  it('exposes no cap-exemption field on an earning rule', () => {
    const rule = {
      serviceId: '11111111-1111-4111-8111-111111111111',
      pointsAmount: 1000,
      eligibleTiers: ['GOLD'],
      effectiveStart: '2026-01-01',
      effectiveEnd: '2026-12-31',
    };
    expect(pointEarningRuleInputSchema.safeParse(rule).success).toBe(true);
    // Decision 03: no cap exemption in v1, so no request may set one.
    expect(pointEarningRuleInputSchema.safeParse({ ...rule, countsTowardCap: false }).success).toBe(
      false,
    );
  });

  it('refuses an earning rule whose window is inverted', () => {
    expect(
      pointEarningRuleInputSchema.safeParse({
        serviceId: '11111111-1111-4111-8111-111111111111',
        pointsAmount: 1000,
        eligibleTiers: ['GOLD'],
        effectiveStart: '2026-12-31',
        effectiveEnd: '2026-01-01',
      }).success,
    ).toBe(false);
  });

  it('refuses an empty tier list', () => {
    expect(
      pointEarningRuleInputSchema.safeParse({
        serviceId: '11111111-1111-4111-8111-111111111111',
        pointsAmount: 1000,
        eligibleTiers: [],
        effectiveStart: '2026-01-01',
        effectiveEnd: '2026-12-31',
      }).success,
    ).toBe(false);
  });

  it('accepts a claim URL as well as a bare credential', () => {
    expect(
      claimEarningPointsRequestSchema.safeParse({
        token: 'https://example.test/customer/points/claim?c=abc123',
      }).success,
    ).toBe(true);
    expect(claimEarningPointsRequestSchema.safeParse({ token: 'abc123' }).success).toBe(true);
    expect(claimEarningPointsRequestSchema.safeParse({ token: '   ' }).success).toBe(false);
  });

  it('keeps a points discount out of the money figure it reduces', () => {
    const purchase = {
      id: '11111111-1111-4111-8111-111111111111',
      purchaseNumber: 'AF-TXN-ABCDE',
      customerId: '11111111-1111-4111-8111-111111111111',
      membershipId: '11111111-1111-4111-8111-111111111111',
      status: 'completed' as const,
      grossAmount: '50000.00',
      pointsDiscountAmount: '25000.00',
      netAmount: '25000.00',
      completedAt: '2026-01-01T00:00:00Z',
      lines: [],
    };
    const parsed = purchaseSchema.parse(purchase);
    expect(parsed.netAmount).toBe('25000.00');
    expect(Number(parsed.grossAmount) - Number(parsed.pointsDiscountAmount)).toBe(
      Number(parsed.netAmount),
    );
  });

  it('accepts every identifier kind the membership resolver can return', () => {
    // The SAME defect the 20261028000001 membership-code upgrade caused in
    // `redemptionPreviewSchema` (see redemption.spec.ts) is still live here:
    // `api/_lib/identifier.ts` returns four `IdentifierKind` values, and this
    // enum listed two of them under different names. The server answers 200 with
    // a good member and the admin client discards it in `safeParse` - so a GSD
    // who types a membership number or a pre-upgrade legacy code gets "That card
    // is not recognised" for a card that is perfectly valid.
    //
    // Pinned here so the next identifier kind cannot be added to the resolver
    // without being declared here too.
    const base = {
      membershipId: '11111111-1111-4111-8111-111111111111',
      membershipNumber: 'MBS-A1B2C3D4',
      customerDisplayName: 'SAMPLE MEMBER',
      productName: 'Gold',
      membershipStatus: 'active',
      expired: false,
      redeemable: true,
      blockedReason: null,
      pointsBalance: 60000,
    };
    for (const kind of ['qr', 'fallback_code', 'card_number', 'legacy_alias']) {
      expect(resolvedMemberSchema.safeParse({ ...base, matchedBy: kind }).success).toBe(true);
    }
    expect(resolvedMemberSchema.safeParse({ ...base, matchedBy: 'something_else' }).success).toBe(
      false,
    );
  });

  it('requires a purchase to have at least one line', () => {
    expect(
      createPurchaseInputSchema.safeParse({
        customerId: '11111111-1111-4111-8111-111111111111',
        membershipId: '11111111-1111-4111-8111-111111111111',
        lines: [],
      }).success,
    ).toBe(false);
  });

  it('requires a reason on an adjustment and refuses a zero amount', () => {
    const base = { membershipId: '11111111-1111-4111-8111-111111111111', amount: 500 };
    // A reason is mandatory: the adjustment writes a permanent ledger row.
    expect(adjustPointsInputSchema.safeParse(base).success).toBe(false);
    expect(adjustPointsInputSchema.safeParse({ ...base, reason: 'x' }).success).toBe(false);
    expect(adjustPointsInputSchema.safeParse({ ...base, amount: 0, reason: 'good reason' }).success)
      .toBe(false);
    expect(adjustPointsInputSchema.safeParse({ ...base, reason: 'good reason' }).success).toBe(true);
  });
});
