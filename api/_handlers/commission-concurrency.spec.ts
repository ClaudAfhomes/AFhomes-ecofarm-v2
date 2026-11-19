import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LINKS,
  TOKEN,
  UUID,
  phase2World,
  phase2WorldTokens,
} from '../_lib/testing/phase2-fixtures.js';
import { FakeSupabase, makeReq, makeRes, type FakeRow } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
  requireService: () => holder.db,
}));

const handler = (await import('./commissions.js')).default;
const ID = '99990000-0000-4000-8000-000000000002';

afterEach(() => vi.restoreAllMocks());

function installRace(initialStatus: string, winningDecision: FakeRow) {
  const db = new FakeSupabase({ tables: phase2World(), tokens: phase2WorldTokens(), links: [...LINKS] });
  holder.db = db;
  const row = db.rows('commissions').find((item) => item.id === ID)!;
  row.status = initialStatus;
  const from = db.from.bind(db);
  vi.spyOn(db, 'from').mockImplementation((table: string) => {
    const builder = from(table);
    if (table === 'commissions') {
      const update = builder.update.bind(builder);
      builder.update = (patch: FakeRow) => {
        // Another request commits after this handler's read and before its conditional write.
        Object.assign(row, winningDecision);
        return update(patch);
      };
    }
    return builder;
  });
  return db;
}

async function request(action: string, body: FakeRow) {
  const { res, state } = makeRes();
  await handler(
    makeReq({ method: 'POST', familyPath: `${ID}/${action}`, token: TOKEN.admin, body }) as never,
    res as never,
  );
  return state;
}

describe('commission decisions under a competing write', () => {
  it('refuses the losing qualification without replacing its actor, notes or audit', async () => {
    const winner = {
      status: 'earned',
      qualified_by: UUID.superAdminStaff,
      qualified_at: '2026-11-10T01:00:00Z',
      qualification_notes: 'Original approved qualification.',
    };
    const db = installRace('final_qualification_pending', winner);
    const response = await request('qualify', {
      decision: 'cancelled',
      notes: 'A competing qualification decision.',
    });
    expect(response.status).toBe(409);
    expect(db.rows('commissions').find((row) => row.id === ID)).toMatchObject(winner);
    expect(
      db.rows('audit_events').filter((row) => row.action === 'COMMISSION_QUALIFIED'),
    ).toHaveLength(0);
  });

  it('returns the first paid decision and skips a duplicate audit when another payment wins', async () => {
    const winner = {
      status: 'paid',
      paid_by: UUID.superAdminStaff,
      paid_at: '2026-11-10T01:00:00Z',
      paid_reference: 'ORIGINAL-REFERENCE',
    };
    const db = installRace('earned', winner);
    const response = await request('pay', {
      reference: 'COMPETING-REFERENCE',
      method: 'Bank transfer',
      paidOn: '2026-11-01',
      evidenceReference: 'Bank advice COMPETING-REFERENCE',
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'paid' });
    expect(db.rows('commissions').find((row) => row.id === ID)).toMatchObject(winner);
    expect(db.rows('audit_events').filter((row) => row.action === 'COMMISSION_PAID')).toHaveLength(
      0,
    );
  });

  it('refuses payment when the earned commission changed to a different state', async () => {
    const db = installRace('earned', { status: 'cancelled' });
    const response = await request('pay', {
      reference: 'COMPETING-REFERENCE',
      method: 'Bank transfer',
      paidOn: '2026-11-01',
      evidenceReference: 'Bank advice COMPETING-REFERENCE',
    });
    expect(response.status).toBe(409);
    expect(db.rows('commissions').find((row) => row.id === ID)?.status).toBe('cancelled');
    expect(db.rows('audit_events').filter((row) => row.action === 'COMMISSION_PAID')).toHaveLength(
      0,
    );
  });
});
