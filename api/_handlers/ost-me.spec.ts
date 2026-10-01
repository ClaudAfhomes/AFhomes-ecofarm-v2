/**
 * `GET /ost/me` - the OST portal's own record.
 *
 * Authenticated (any valid session), self-scoped by Auth id. Returns only
 * the caller's safe member fields; a non-OST caller gets the same 404 as an
 * unknown member, with no oracle.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
}));

const ost = (await import('./ost.js')).default;
const { resetIdentifierRateLimit } = await import('../_lib/rate-limit.js');

const OST_ID = '55555555-5555-4555-8555-555555555555';
const SM_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '99999999-9999-4999-8999-999999999999';

type Row = Record<string, unknown>;

function install() {
  resetIdentifierRateLimit();
  holder.db = new FakeSupabase({
    tables: {
      modules: [],
      roles: [],
      role_permissions: [],
      staff_users: [
        { id: SM_ID, email: 'sm@afhomes.test', full_name: 'Sam Manager', status: 'active' },
        { id: OTHER_ID, email: 'other@afhomes.test', full_name: 'Other Person', status: 'active' },
      ],
      staff_role_assignments: [],
      staff_permission_restrictions: [],
      staff_invitations: [],
      referral_codes: [],
      ost_applications: [],
      ost_members: [
        {
          id: OST_ID,
          application_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb0',
          sponsor_staff_id: SM_ID,
          ost_number: 'OST-000007',
          full_name: 'Ollie Seller',
          email: 'ost@afhomes.test',
          phone: '+639170000007',
          status: 'active',
          approved_by: SM_ID,
          approved_at: '2026-09-01T00:00:00.000Z',
          created_at: '2026-09-01T00:00:00.000Z',
        },
      ],
      referral_relationships: [],
      audit_events: [],
    } as never,
    tokens: {
      'tok-ost': { id: OST_ID, email: 'ost@afhomes.test', email_confirmed_at: '2026-09-01T00:00:00.000Z' },
      'tok-other': { id: OTHER_ID, email: 'other@afhomes.test', email_confirmed_at: '2026-09-01T00:00:00.000Z' },
    },
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

async function call(token?: string) {
  const { res, state } = makeRes();
  await ost(
    makeReq({ method: 'GET', familyPath: 'me', ...(token ? { token } : {}) }) as never,
    res as never,
  );
  return state as { status: number; body: unknown };
}

describe('GET /ost/me', () => {
  it('returns the caller own safe record with the sponsor name', async () => {
    install();
    const s = await call('tok-ost');
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({
      ostNumber: 'OST-000007',
      fullName: 'Ollie Seller',
      status: 'active',
      sponsorName: 'Sam Manager',
    });
    const serialised = JSON.stringify(s.body);
    expect(serialised).not.toContain(OST_ID);
    expect(serialised).not.toContain(SM_ID);
    expect(serialised).not.toContain('ost@afhomes.test');
  });

  it('a non-OST caller gets the same 404', async () => {
    install();
    const s = await call('tok-other');
    expect(s.status).toBe(404);
  });

  it('requires a session', async () => {
    install();
    expect((await call()).status).toBe(401);
    expect((await call('tok-bogus')).status).toBe(401);
  });
});
