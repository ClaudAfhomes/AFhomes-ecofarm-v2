import { describe, expect, it } from 'vitest';
import { redemptionPreviewSchema } from './redemption';

/**
 * Every value `api/_lib/identifier.ts` can return as `matchedBy` must be
 * accepted here.
 *
 * This exists because the two drifted. The `20261028000001` membership-code
 * upgrade made the resolver return a fourth kind, `legacy_alias`, when a member
 * quotes a pre-upgrade sequential code such as `MBS-000004`, but this enum was
 * never widened. The server answered 200 with a perfectly good preview, and the
 * admin client threw it away in `safeParse` at the boundary - so the exact
 * legacy-code path that upgrade was built to support failed on the last hop,
 * in the browser, with no server error to find it by.
 *
 * A contract that lags its producer is not a contract; it is a filter. This
 * pins the two sides together so the next identifier kind cannot be added
 * without being declared.
 */
const RESOLVER_MATCH_KINDS = ['qr', 'fallback_code', 'card_number', 'legacy_alias'] as const;

function preview(matchedBy: string) {
  return {
    membershipId: '3f1c0a52-9d4b-4a71-8e2f-0b6a5c7d1e90',
    membershipNumber: 'MBS-A1B2C3D4-E5F60718-293A4B5C-6D7E8F90',
    customerDisplayName: 'SAMPLE MEMBER',
    productName: 'Gold',
    membershipStatus: 'active' as const,
    expired: false,
    redeemable: true,
    blockedReason: null,
    pointsBalance: 60000,
    matchedBy,
  };
}

describe('redemptionPreviewSchema matchedBy', () => {
  it.each(RESOLVER_MATCH_KINDS)('accepts the resolver kind %s', (kind) => {
    expect(redemptionPreviewSchema.safeParse(preview(kind)).success).toBe(true);
  });

  it('rejects an unknown kind rather than silently widening the contract', () => {
    expect(redemptionPreviewSchema.safeParse(preview('something_else')).success).toBe(false);
  });
});
