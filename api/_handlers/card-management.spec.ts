/**
 * Membership-card issuance and management regression (Phase 20).
 *
 * Issuance happens atomically inside `activate_card_sale` on real PostgreSQL
 * (proven by `pnpm test:db:local` §§11-13); this suite drives the real
 * staff handlers against the seeded post-activation world and proves the
 * management surface: list, detail, printable card, print tracking,
 * credential rotation with immediate invalidation, permission gates, hash
 * discipline, and customer isolation through the real portal handler.
 *
 * The rotation RPC is scripted with a result FUNCTION that performs the same
 * side effects the SQL function performs (guard on customer + membership
 * status, hash replacement, plaintext returned once). The in-RPC guards
 * themselves are proven on real PostgreSQL (db-integration §§23-24); what is
 * proven here is everything the handlers own around them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CUSTOMER,
  LINKS,
  MEMBERSHIP,
  PRODUCT,
  SALE,
  TOKEN,
  TOKEN2,
  UNIQUE,
  UUID,
  phase2World,
  phase2WorldTokens,
} from '../_lib/testing/phase2-fixtures.js';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';
import { hashIdentifier } from './memberships.js';

const holder = vi.hoisted(() => ({ db: null as unknown, rotations: 0 }));

vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
  requireService: () => holder.db,
  okList: (res: { status: (c: number) => { json: (b: unknown) => void } }, rows: unknown[]) =>
    res.status(200).json({ data: rows, meta: { total: rows.length } }),
  methodNotAllowed: () => {},
  readJsonBody: (req: { body?: unknown }) => ({ ok: true as const, body: req.body }),
}));

const handlers = {
  memberships: (await import('./memberships.js')).default,
  portal: (await import('./customer-portal.js')).default,
};

const OLD_QR = 'qr-old-plaintext-value-0001';
const OLD_FB = 'AFH-OLD1-OLD2';

/**
 * The rotation the SQL function performs, faithfully emulated: both the
 * membership and its customer must be active, the hashes are replaced (old
 * codes die immediately), balances and identity are untouched, and the new
 * plaintext is returned exactly once.
 */
function rotationRpc() {
  return {
    fn: 'reissue_membership_credentials',
    result: (args: Record<string, unknown>) => {
      const db = holder.db as FakeSupabase;
      const row = db.rows('memberships').find((r) => r.id === args.p_membership_id);
      const customer = db.rows('customers').find((r) => r.id === row?.customer_id);
      if (!row || row.status !== 'active' || !customer || customer.status !== 'active')
        throw new Error('MEMBERSHIP_NOT_ACTIVE:refused');
      holder.rotations += 1;
      const qr = `qr-new-plaintext-value-${String(holder.rotations).padStart(4, '0')}`;
      const fb = `AFH-NEW${holder.rotations}-CODE`;
      row.qr_token_hash = hashIdentifier(qr);
      row.fallback_code_hash = hashIdentifier(fb);
      return [{ qr_token: qr, fallback_code: fb }];
    },
  };
}

function install(
  rpcs: { fn: string; result: unknown }[] = [],
  rpcErrors: Record<string, { code?: string; message: string }> = {},
  extraTokens: Record<string, { id: string; email: string; email_confirmed_at: string }> = {},
) {
  holder.rotations = 0;
  holder.db = new FakeSupabase({
    tables: phase2World(),
    tokens: { ...phase2WorldTokens(), ...extraTokens },
    unique: UNIQUE,
    links: LINKS as never,
    rpcs,
    rpcErrors,
  });
  const db = holder.db as FakeSupabase;
  // The seeded world carries placeholder hashes; pin them to known plaintext
  // so old/new credential assertions are exact.
  const member = db.rows('memberships').find((r) => r.id === MEMBERSHIP.active)!;
  member.qr_token_hash = hashIdentifier(OLD_QR);
  member.fallback_code_hash = hashIdentifier(OLD_FB);
  return db;
}

type State = { status: number; body: unknown };

async function call(
  family: keyof typeof handlers,
  options: {
    path: string;
    method?: string;
    token?: string;
    body?: unknown;
    query?: Record<string, string>;
  },
): Promise<State> {
  const { res, state } = makeRes();
  await handlers[family](
    makeReq({
      method: options.method ?? 'GET',
      familyPath: options.path,
      body: options.body,
      token: options.token,
      query: options.query,
    }) as never,
    res as never,
  );
  return state;
}

const data = (body: unknown) => (body as { data: Record<string, unknown>[] }).data;
const serialised = (body: unknown) => JSON.stringify(body);

describe('activated membership appears with full card metadata', () => {
  beforeEach(() => {
    const db = install();
    const member = db.rows('memberships').find((r) => r.id === MEMBERSHIP.active)!;
    member.card_issued_at = '2026-09-28T01:00:00.000Z';
    member.card_issued_by = UUID.adminStaff;
    member.last_printed_at = '2026-09-28T02:00:00.000Z';
    member.print_count = 2;
  });

  it('lists the membership with customer, plan, category and issuance columns', async () => {
    const state = await call('memberships', { path: '', token: TOKEN.admin });
    expect(state.status).toBe(200);
    expect(data(state.body)).toHaveLength(1);
    expect(data(state.body)[0]).toMatchObject({
      membershipNumber: 'MBS-000001',
      customerName: 'Pedro Reyes',
      customerStatus: 'active',
      productName: 'Gold',
      categoryName: 'Membership Cards',
      status: 'active',
      pointsBalance: 60000,
      yearlyPointsAllocated: 60000,
      cardIssuedAt: '2026-09-28T01:00:00.000Z',
      issuedBy: 'Ops Admin',
      lastPrintedAt: '2026-09-28T02:00:00.000Z',
      printCount: 2,
    });
  });

  it('loads the same metadata on detail', async () => {
    const state = await call('memberships', { path: MEMBERSHIP.active, token: TOKEN.admin });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({
      membershipNumber: 'MBS-000001',
      saleId: SALE.active,
      productId: PRODUCT.gold,
      status: 'active',
      pointsBalance: 60000,
      printCount: 2,
    });
  });

  it('filters the list by status', async () => {
    const active = await call('memberships', {
      path: '',
      token: TOKEN.admin,
      query: { status: 'active' },
    });
    expect(data(active.body)).toHaveLength(1);
    const suspended = await call('memberships', {
      path: '',
      token: TOKEN.admin,
      query: { status: 'suspended' },
    });
    expect(data(suspended.body)).toHaveLength(0);
  });

  it('returns 404 for an unknown membership', async () => {
    const state = await call('memberships', {
      path: '00000000-0000-4000-8000-000000000099',
      token: TOKEN.admin,
    });
    expect(state.status).toBe(404);
  });
});

describe('printable card and print tracking', () => {
  beforeEach(() => {
    install();
  });

  it('loads safe card-display data with no hashes or codes', async () => {
    const state = await call('memberships', {
      path: `${MEMBERSHIP.active}/card`,
      token: TOKEN.admin,
    });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({
      membershipId: MEMBERSHIP.active,
      membershipNumber: 'MBS-000001',
      memberName: 'Pedro Reyes',
      customerStatus: 'active',
      tierName: 'Gold',
      tierCode: 'GOLD',
      categoryName: 'Membership Cards',
      status: 'active',
      pointsBalance: 60000,
      yearlyPointsAllocated: 60000,
    });
    expect(serialised(state.body)).not.toMatch(/hash|qr_token|fallback_code|AFH-|qr-old/i);
  });

  it('records a first print then a reprint without touching credentials', async () => {
    const db = holder.db as FakeSupabase;
    const first = await call('memberships', {
      method: 'POST',
      path: `${MEMBERSHIP.active}/mark-printed`,
      token: TOKEN.admin,
    });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ printCount: 1, reprint: false });
    const firstAt = (first.body as { lastPrintedAt: string }).lastPrintedAt;

    const second = await call('memberships', {
      method: 'POST',
      path: `${MEMBERSHIP.active}/mark-printed`,
      token: TOKEN.admin,
    });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ printCount: 2, reprint: true });

    const row = db.rows('memberships').find((r) => r.id === MEMBERSHIP.active)!;
    expect(row.print_count).toBe(2);
    expect(row.last_printed_at).toBe((second.body as { lastPrintedAt: string }).lastPrintedAt);
    expect(firstAt.length).toBeGreaterThan(0);
    // Credentials untouched: the old pair still resolves.
    const resolve = await call('memberships', {
      path: 'resolve',
      token: TOKEN.admin,
      query: { identifier: OLD_QR },
    });
    expect(resolve.status).toBe(200);
    expect(
      db.rows('audit_events').filter((e) => String(e.action).includes('PRINT')).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('denies print recording without a card grant', async () => {
    const state = await call('memberships', {
      method: 'POST',
      path: `${MEMBERSHIP.active}/mark-printed`,
      token: TOKEN.viewer,
    });
    expect(state.status).toBe(403);
  });
});

describe('credential reissue and invalidation', () => {
  beforeEach(() => {
    install([rotationRpc()]);
  });

  it('requires a reason', async () => {
    for (const body of [undefined, {}, { reason: 'lost' }, { reason: '   ' }]) {
      const state = await call('memberships', {
        method: 'POST',
        path: `${MEMBERSHIP.active}/reissue`,
        token: TOKEN.admin,
        body,
      });
      expect(state.status).toBe(400);
    }
  });

  it('rotates both credentials, returns the new pair once, and audits without plaintext', async () => {
    const db = holder.db as FakeSupabase;
    const state = await call('memberships', {
      method: 'POST',
      path: `${MEMBERSHIP.active}/reissue`,
      token: TOKEN.admin,
      body: { reason: 'Card was lost in transit.' },
    });
    expect(state.status).toBe(201);
    const body = state.body as { fallbackCode: string; qrToken: string };
    expect(body.fallbackCode).toBe('AFH-NEW1-CODE');
    expect(typeof body.qrToken).toBe('string');
    expect(body).toMatchObject({
      membershipId: MEMBERSHIP.active,
      membershipNumber: 'MBS-000001',
      previousCodesInvalidated: true,
    });

    const audits = db
      .rows('audit_events')
      .filter((e) => e.action === 'MEMBERSHIP_CREDENTIALS_REISSUED');
    expect(audits).toHaveLength(1);
    expect(serialised(db.rows('audit_events'))).not.toContain(body.fallbackCode);
    expect(serialised(db.rows('audit_events'))).not.toContain(body.qrToken);
    expect(serialised(db.rows('audit_events'))).not.toContain(OLD_QR);
    expect(serialised(db.rows('audit_events'))).not.toContain(OLD_FB);
  });

  it('invalidates the old pair and resolves the new pair to the same membership', async () => {
    const reissued = await call('memberships', {
      method: 'POST',
      path: `${MEMBERSHIP.active}/reissue`,
      token: TOKEN.admin,
      body: { reason: 'Damaged card.' },
    });
    const { fallbackCode, qrToken } = reissued.body as {
      fallbackCode: string;
      qrToken: string;
    };

    for (const dead of [OLD_QR, OLD_FB]) {
      const gone = await call('memberships', {
        path: 'resolve',
        token: TOKEN.admin,
        query: { identifier: dead },
      });
      expect(gone.status).toBe(404);
    }
    for (const live of [qrToken, fallbackCode]) {
      const found = await call('memberships', {
        path: 'resolve',
        token: TOKEN.admin,
        query: { identifier: live },
      });
      expect(found.status).toBe(200);
      expect(found.body).toMatchObject({
        membershipId: MEMBERSHIP.active,
        membershipNumber: 'MBS-000001',
        status: 'active',
        pointsBalance: 60000,
      });
    }
  });

  it('preserves identity, plan, points, sale and payment history', async () => {
    const db = holder.db as FakeSupabase;
    const snap = {
      sale: JSON.stringify(db.rows('card_sales').find((r) => r.id === SALE.active)),
      payments: JSON.stringify(db.rows('payments')),
      account: JSON.stringify(
        db.rows('points_accounts').find((r) => r.membership_id === MEMBERSHIP.active),
      ),
      ledger: db.rows('points_ledger').length,
    };
    await call('memberships', {
      method: 'POST',
      path: `${MEMBERSHIP.active}/reissue`,
      token: TOKEN.admin,
      body: { reason: 'Routine rotation.' },
    });
    const row = db.rows('memberships').find((r) => r.id === MEMBERSHIP.active)!;
    expect(row.membership_number).toBe('MBS-000001');
    expect(row.customer_id).toBe(CUSTOMER.active);
    expect(row.product_id).toBe(PRODUCT.gold);
    expect(row.points_balance).toBe(60000);
    expect(JSON.stringify(db.rows('card_sales').find((r) => r.id === SALE.active))).toBe(snap.sale);
    expect(JSON.stringify(db.rows('payments'))).toBe(snap.payments);
    expect(
      JSON.stringify(db.rows('points_accounts').find((r) => r.membership_id === MEMBERSHIP.active)),
    ).toBe(snap.account);
    expect(db.rows('points_ledger')).toHaveLength(snap.ledger);
    expect(db.rows('memberships').filter((r) => r.customer_id === CUSTOMER.active)).toHaveLength(1);
  });

  it('refuses rotation for a suspended membership without changing anything', async () => {
    const db = holder.db as FakeSupabase;
    db.rows('customers').find((r) => r.id === CUSTOMER.prospect)!.status = 'active';
    db.rows('memberships').push({
      id: 'dddddddd-0000-4000-8000-000000000002',
      customer_id: CUSTOMER.prospect,
      sale_id: SALE.unpaid,
      membership_number: 'MBS-000002',
      product_id: PRODUCT.bronze,
      fallback_code_hash: hashIdentifier('AFH-SUSP-ENDED'),
      qr_token_hash: hashIdentifier('qr-suspended-0001'),
      status: 'suspended',
      points_balance: 25000,
      yearly_points_allocated: 25000,
      activated_by: UUID.adminStaff,
      activated_at: '2026-09-27T01:00:00.000Z',
      expires_at: '2027-09-27T01:00:00.000Z',
      renewal_due_at: '2027-09-27T01:00:00.000Z',
      issued_at: '2026-09-27T01:00:00.000Z',
    });
    const before = JSON.stringify(
      db.rows('memberships').find((r) => r.membership_number === 'MBS-000002'),
    );
    const state = await call('memberships', {
      method: 'POST',
      path: 'dddddddd-0000-4000-8000-000000000002/reissue',
      token: TOKEN.admin,
      body: { reason: 'Should be refused.' },
    });
    expect(state.status).not.toBe(201);
    expect(
      JSON.stringify(db.rows('memberships').find((r) => r.membership_number === 'MBS-000002')),
    ).toBe(before);

    // The suspended card is still resolvable as a read, but reports its real
    // status so no caller can treat it as usable.
    const resolve = await call('memberships', {
      path: 'resolve',
      token: TOKEN.admin,
      query: { identifier: 'qr-suspended-0001' },
    });
    expect(resolve.status).toBe(200);
    expect(resolve.body).toMatchObject({ membershipNumber: 'MBS-000002', status: 'suspended' });
  });

  it('lets Finance reissue under its explicit update grant, never a stranger', async () => {
    const finance = await call('memberships', {
      method: 'POST',
      path: `${MEMBERSHIP.active}/reissue`,
      token: TOKEN2.finance,
      body: { reason: 'Finance-assisted rotation.' },
    });
    expect(finance.status).toBe(201);
    expect(
      (await call('memberships', {
        method: 'POST',
        path: `${MEMBERSHIP.active}/reissue`,
        token: TOKEN.viewer,
        body: { reason: 'No grant at all.' },
      })).status,
    ).toBe(403);
  });
});

describe('credential and isolation discipline', () => {
  beforeEach(() => {
    install([rotationRpc()]);
  });

  it('never returns hashes, codes or PII from reads', async () => {
    for (const target of [
      { path: '', token: TOKEN.admin },
      { path: MEMBERSHIP.active, token: TOKEN.admin },
      { path: `${MEMBERSHIP.active}/card`, token: TOKEN.admin },
      { path: 'resolve', token: TOKEN.admin, query: { identifier: OLD_FB } },
    ]) {
      const state = await call('memberships', target);
      expect(state.status).toBe(200);
      expect(serialised(state.body)).not.toMatch(/qr_token_hash|fallback_code_hash/);
      expect(serialised(state.body)).not.toContain(OLD_QR);
      expect(serialised(state.body)).not.toContain(OLD_FB);
      expect(serialised(state.body)).not.toContain('juan@example.com');
      expect(serialised(state.body)).not.toContain('0011-2233-4455');
    }
  });

  it('exposes no NFC route, path or field anywhere in the card surface', async () => {
    const unknown = await call('memberships', { path: 'nfc/tap', token: TOKEN.admin });
    expect(unknown.status).toBe(404);
    const bodies = [
      await call('memberships', { path: '', token: TOKEN.admin }),
      await call('memberships', { path: `${MEMBERSHIP.active}/card`, token: TOKEN.admin }),
    ];
    for (const state of bodies) expect(serialised(state.body)).not.toMatch(/nfc/i);
  });

  it('denies every card read without a card grant', async () => {
    for (const target of [
      { path: '', token: TOKEN.viewer },
      { path: MEMBERSHIP.active, token: TOKEN.viewer },
      { path: `${MEMBERSHIP.active}/card`, token: TOKEN.viewer },
      { path: 'resolve', token: TOKEN.viewer, query: { identifier: OLD_QR } },
    ]) {
      expect((await call('memberships', target)).status).toBe(403);
    }
  });

  it('a customer reaches only their own card through the portal', async () => {
    install(
      [rotationRpc()],
      {},
      {
        'tok-cust-a': {
          id: 'auth-user-a',
          email: 'a@example.com',
          email_confirmed_at: '2026-09-01T00:00:00.000Z',
        },
        'tok-cust-b': {
          id: 'auth-user-b',
          email: 'b@example.com',
          email_confirmed_at: '2026-09-01T00:00:00.000Z',
        },
      },
    );
    const db = holder.db as FakeSupabase;
    db.rows('customers').find((r) => r.id === CUSTOMER.active)!.auth_user_id = 'auth-user-a';
    const prospect = db.rows('customers').find((r) => r.id === CUSTOMER.prospect)!;
    prospect.auth_user_id = 'auth-user-b';
    prospect.status = 'active';

    const own = await call('portal', { path: 'membership', token: 'tok-cust-a' });
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({
      membershipNumber: 'MBS-000001',
      credentialsAvailable: false,
    });
    expect(serialised(own.body)).not.toMatch(/qr_token_hash|fallback_code_hash/);
    expect(serialised(own.body)).not.toContain(OLD_QR);
    expect(serialised(own.body)).not.toContain(OLD_FB);

    // The second customer owns no membership: they see nothing of the first.
    const other = await call('portal', { path: 'membership', token: 'tok-cust-b' });
    expect(other.status).toBe(404);
  });
});
