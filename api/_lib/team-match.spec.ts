import { describe, expect, it } from 'vitest';
import { phase2World, STAFF2 } from './testing/phase2-fixtures.js';
import { FakeSupabase } from './testing/supabase-fake.js';
import { sameSalesTeam, verifyReferrerRecommenderTeam } from './team-match.js';

/** The same VD -> SSM -> SM -> OST chain `phase2World()` seeds by default. */
const AA_FOR: Record<string, string> = { [STAFF2.ost]: 'AAO26100001' };

function install(extraReferralRows: Record<string, unknown>[] = []) {
  const tables = phase2World({});
  tables.referral_relationships = [...tables.referral_relationships, ...extraReferralRows];
  return new FakeSupabase({
    tables,
    rpcs: [
      {
        fn: 'search_sale_team_accreditation',
        result: (args: Record<string, unknown>) => {
          const staffId = Object.entries(AA_FOR).find(([, n]) => n === args.p_aa_number)?.[0];
          return staffId ? { staffId, fullName: 'OST Seller', kind: 'OST', status: 'accredited' } : null;
        },
      },
    ],
  });
}

describe('sameSalesTeam', () => {
  it('is true for a staff member compared with themselves', async () => {
    const db = install();
    expect(await sameSalesTeam(db as never, STAFF2.ost, STAFF2.ost)).toBe(true);
  });

  it('is true for two members under the same SVD root', async () => {
    // STAFF2.ost's own chain already resolves to STAFF2.viceDirector. A second
    // OST under the same salesManager shares that same root.
    const secondOst = '10101010-0000-4000-8000-000000000099';
    const db = install([
      {
        id: 'eeeeeeee-0000-4000-8000-000000000099',
        subject_staff_id: secondOst,
        upline_staff_id: STAFF2.salesManager,
        hierarchy_role: 'ost',
        is_active: true,
      },
    ]);
    expect(await sameSalesTeam(db as never, STAFF2.ost, secondOst)).toBe(true);
  });

  it('is false for members whose chains root at different SVDs', async () => {
    const otherSvd = 'ffffffff-0000-4000-8000-000000000001';
    const otherOst = 'ffffffff-0000-4000-8000-000000000002';
    const db = install([
      {
        id: 'eeeeeeee-0000-4000-8000-000000000098',
        subject_staff_id: otherOst,
        upline_staff_id: otherSvd,
        hierarchy_role: 'ost',
        is_active: true,
      },
    ]);
    expect(await sameSalesTeam(db as never, STAFF2.ost, otherOst)).toBe(false);
  });

  it('is false when one side has no recorded upline at all', async () => {
    const rootless = 'ffffffff-0000-4000-8000-000000000003';
    const db = install();
    expect(await sameSalesTeam(db as never, STAFF2.ost, rootless)).toBe(false);
  });
});

describe('verifyReferrerRecommenderTeam', () => {
  it('is a no-op when either side is missing', async () => {
    const db = install();
    expect(await verifyReferrerRecommenderTeam(db as never, undefined, 'AAO26100001')).toEqual({
      ok: true,
    });
    expect(await verifyReferrerRecommenderTeam(db as never, STAFF2.ost, undefined)).toEqual({
      ok: true,
    });
  });

  it('rejects an AA number that resolves to no accredited member', async () => {
    const db = install();
    expect(
      await verifyReferrerRecommenderTeam(db as never, STAFF2.ost, 'AAO26199999'),
    ).toEqual({ ok: false, reason: 'RECOMMENDER_NOT_FOUND' });
  });

  it('accepts a referrer and recommender resolving to the same staff id', async () => {
    const db = install();
    expect(await verifyReferrerRecommenderTeam(db as never, STAFF2.ost, 'AAO26100001')).toEqual({
      ok: true,
    });
  });

  it('rejects a referrer and recommender on different teams', async () => {
    // A referrer with no recorded upline at all roots at itself, which never
    // matches the recommender's real SVD root (STAFF2.viceDirector).
    const unrelatedReferrer = 'ffffffff-0000-4000-8000-000000000011';
    const db = install();
    expect(
      await verifyReferrerRecommenderTeam(db as never, unrelatedReferrer, 'AAO26100001'),
    ).toEqual({ ok: false, reason: 'TEAM_MISMATCH' });
  });
});
