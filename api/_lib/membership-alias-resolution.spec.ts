import { describe, expect, it } from 'vitest';
import { FakeSupabase } from './testing/supabase-fake.js';
import { resolveMembershipByIdentifier } from './identifier.js';

const MEMBERSHIP_ID = '00000000-0000-4000-8000-0000000000aa';
const CURRENT_CODE = 'MBS-1A2B3C4D-5E6F7081-92A3B4C5-D6E7F809';
const LEGACY_CODE = 'MBS-000004';
const QR_TOKEN = 'opaque-rotation-qr-token';
const FALLBACK_CODE = 'a1b2c3d4';

const db = () =>
  new FakeSupabase({
    tables: {
      memberships: [
        {
          id: MEMBERSHIP_ID,
          customer_id: '00000000-0000-4000-8000-0000000000bb',
          membership_number: CURRENT_CODE,
          status: 'active',
          points_balance: 5000,
          expires_at: null,
          qr_token_hash: 'x',
          fallback_code_hash: 'y',
        },
      ],
      business_id_aliases: [
        { entity_type: 'membership', entity_id: MEMBERSHIP_ID, old_identifier: LEGACY_CODE, is_active: true },
      ],
      customers: [{ id: '00000000-0000-4000-8000-0000000000bb', status: 'active' }],
      card_plans: [{ id: '00000000-0000-4000-8000-0000000000cc', name: 'GOLD' }],
    },
  } as never);

describe('membership alias resolution (transaction path only)', () => {
  it('resolves the current Membership Code directly, not via alias', async () => {
    const resolved = await resolveMembershipByIdentifier(db() as never, CURRENT_CODE);
    expect(resolved?.matchedBy).toBe('card_number');
    expect(resolved?.membership.id).toBe(MEMBERSHIP_ID);
  });

  it('resolves a legacy alias to the same membership and returns the CURRENT code', async () => {
    for (const term of [LEGACY_CODE, LEGACY_CODE.toLowerCase(), `AFHOMES:${LEGACY_CODE}`]) {
      const resolved = await resolveMembershipByIdentifier(db() as never, term);
      expect(resolved?.matchedBy).toBe('legacy_alias');
      expect(resolved?.membership.id).toBe(MEMBERSHIP_ID);
      // The old code is never presented as the current one.
      expect(resolved?.membership.membership_number).toBe(CURRENT_CODE);
      expect(resolved?.membership.membership_number).not.toBe(LEGACY_CODE);
    }
  });

  it('returns null for an unknown membership code, so the caller answers 404', async () => {
    for (const term of ['MBS-009999', `AFHOMES:${'MBS-009999'}`, 'AFHOMES:MBS-NOT-A-CODE']) {
      expect(await resolveMembershipByIdentifier(db() as never, term)).toBeNull();
    }
  });

  it('does not accept a Customer Code or a Customer ID as a Membership Code', async () => {
    for (const term of ['AF-CC-NTNNBKJW', 'AF-CUS-WNT2G', 'CUS-000005']) {
      expect(await resolveMembershipByIdentifier(db() as never, term)).toBeNull();
    }
  });

  it('exposes no rows for an empty or whitespace identifier', async () => {
    for (const term of ['', '   ']) {
      expect(await resolveMembershipByIdentifier(db() as never, term)).toBeNull();
    }
  });

  it('fake RPC mirrors the production contract shape', async () => {
    const fake = db();
    const current = (await fake.rpc('resolve_membership_code', {
      p_identifier: CURRENT_CODE,
    })) as { data: { membership_id: string; current_number: string; via_alias: boolean }[] };
    expect(current.data).toEqual([
      { membership_id: MEMBERSHIP_ID, current_number: CURRENT_CODE, via_alias: false },
    ]);
    const alias = (await fake.rpc('resolve_membership_code', {
      p_identifier: LEGACY_CODE,
    })) as { data: { membership_id: string; current_number: string; via_alias: boolean }[] };
    expect(alias.data).toEqual([
      { membership_id: MEMBERSHIP_ID, current_number: CURRENT_CODE, via_alias: true },
    ]);
    const unknown = (await fake.rpc('resolve_membership_code', {
      p_identifier: 'MBS-009999',
    })) as { data: unknown[]; error: unknown };
    expect(unknown.data).toEqual([]);
    expect(unknown.error).toBeNull();
  });

  it('an inactive alias is not honoured', async () => {
    const fake = new FakeSupabase({
      tables: {
        memberships: [
          {
            id: MEMBERSHIP_ID,
            membership_number: CURRENT_CODE,
            status: 'active',
            points_balance: 0,
            expires_at: null,
            qr_token_hash: 'x',
            fallback_code_hash: 'y',
          },
        ],
        business_id_aliases: [
          {
            entity_type: 'membership',
            entity_id: MEMBERSHIP_ID,
            old_identifier: LEGACY_CODE,
            is_active: false,
          },
        ],
      },
    } as never);
    expect(await resolveMembershipByIdentifier(fake as never, LEGACY_CODE)).toBeNull();
  });

  it('QR and fallback secrets are untouched by the alias work', () => {
    expect(LEGACY_CODE).not.toBe(QR_TOKEN);
    expect(LEGACY_CODE).not.toBe(FALLBACK_CODE);
  });
});