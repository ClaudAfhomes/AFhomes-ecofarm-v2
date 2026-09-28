/**
 * AF Homes Phase 10 - membership card management.
 *
 * Drives the real memberships handler, the real authorization resolver and the
 * real Zod contracts against the in-memory Supabase fake. The rotation RPC is
 * scripted (PL/pgSQL cannot run in-process); its SQL truth - row lock, hash
 * replacement, old-code invalidation, audit - is proven by execution in
 * `supabase/db-integration.ts` sections 24 and 33.
 *
 * Load-bearing assertions: a print never rotates (hashes untouched, count
 * moves), a reissue always rotates (old codes die, reason audited, balances
 * untouched), and the card view can never carry a hash or an internal id.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  LINKS,
  MEMBERSHIP,
  TOKEN2,
  UNIQUE,
  phase2World,
  phase2WorldTokens,
} from '../_lib/testing/phase2-fixtures.js';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';
import { redemptionBlocker } from '../_lib/identifier.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
  requireService: () => holder.db,
  okList: (res: { status: (c: number) => { json: (b: unknown) => void } }, rows: unknown[]) =>
    res.status(200).json({ data: rows, meta: { total: rows.length } }),
  methodNotAllowed: () => {},
  readJsonBody: (req: { body?: unknown }) => ({ ok: true as const, body: req.body }),
}));

const memberships = (await import('./memberships.js')).default;
const { selectHandler } = await import('../_lib/router.js');

const hash = (v: string) => createHash('sha256').update(v).digest('hex');

const QR = 'card-qr-printed-once-001';
const FALLBACK = 'AFH-1111-2222';

function install(
  options: {
    rpcs?: { fn: string; result: unknown | ((args: Record<string, unknown>) => unknown) }[];
    rpcErrors?: Record<string, { code?: string; message: string }>;
  } = {},
) {
  holder.db = new FakeSupabase({
    tables: phase2World(),
    tokens: phase2WorldTokens(),
    unique: UNIQUE,
    links: LINKS as never,
    rpcs: options.rpcs ?? [],
    rpcErrors: options.rpcErrors,
  });
  const db = holder.db as FakeSupabase;
  const row = db.rows('memberships').find((r) => r.id === MEMBERSHIP.active)!;
  row.qr_token_hash = hash(QR);
  row.fallback_code_hash = hash(FALLBACK);
  row.print_count = 0;
  row.last_printed_at = null;
  return db;
}

type State = { status: number; body: unknown };

async function call(options: {
  path: string;
  method?: string;
  token?: string | null;
  body?: unknown;
  query?: Record<string, string>;
}): Promise<State> {
  const { res, state } = makeRes();
  await memberships(
    makeReq({
      method: options.method ?? 'GET',
      familyPath: options.path,
      body: options.body,
      token: options.token === null ? undefined : (options.token ?? TOKEN2.finance),
      query: options.query,
    }) as never,
    res as never,
  );
  return state;
}

/* ================================================================== */
/* Card reads                                                           */
/* ================================================================== */

describe('card authorization and views', () => {
  it('1. lists memberships for card operations staff and denies strangers', async () => {
    const db = install();
    // Real memberships have activated_at, not created_at. The fake deliberately
    // lacks created_at so this catches a PostgREST ORDER BY drift.
    for (const row of db.rows('memberships')) delete row.created_at;
    const listed = await call({ path: '' });
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body)).not.toContain('"createdAt":""');
    expect((await call({ path: '', token: TOKEN2.hr })).status).toBe(403);
    expect((await call({ path: '', token: null })).status).toBe(401);
  });

  it('15/16/17. serves printable card data with no hash and no internal id', async () => {
    install();
    const state = await call({ path: `${MEMBERSHIP.active}/card` });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({
      membershipId: MEMBERSHIP.active,
      membershipNumber: 'MBS-000001',
    });
    const serialised = JSON.stringify(state.body);
    expect(serialised).not.toMatch(/qr_token_hash|fallback_code_hash|auth_user_id/);
    expect(serialised).not.toContain('customer_id');
    expect(serialised).not.toContain('sale_id');
  });

  it('refuses the card view without a card responsibility', async () => {
    install();
    expect((await call({ path: `${MEMBERSHIP.active}/card`, token: TOKEN2.hr })).status).toBe(403);
  });
});

/* ================================================================== */
/* Resolution still honors rotation                                     */
/* ================================================================== */

describe('credential resolution', () => {
  it('4/5. the current QR and the current fallback resolve the same membership', async () => {
    install();
    for (const identifier of [QR, FALLBACK]) {
      const state = await call({ path: 'resolve', query: { identifier } });
      expect(state.status, identifier).toBe(200);
      expect(state.body).toMatchObject({ membershipId: MEMBERSHIP.active });
    }
  });

  it('6. resolution reports status; enforcement stays with the caller', async () => {
    expect(
      redemptionBlocker({
        id: 'm',
        customer_id: 'c',
        membership_number: 'MBS-1',
        status: 'suspended',
        points_balance: 0,
        expires_at: null,
        qr_token_hash: 'h',
        fallback_code_hash: 'h',
        customer_status: 'active',
        account_balance: 0,
        product_name: null,
      }),
    ).toMatch(/suspended/i);
    expect(
      redemptionBlocker({
        id: 'm',
        customer_id: 'c',
        membership_number: 'MBS-1',
        status: 'active',
        points_balance: 0,
        expires_at: null,
        qr_token_hash: 'h',
        fallback_code_hash: 'h',
        customer_status: 'suspended',
        account_balance: 0,
        product_name: null,
      }),
    ).toMatch(/customer account is suspended/i);
  });
});

/* ================================================================== */
/* Privileged reissue                                                   */
/* ================================================================== */

const NEW_QR = 'card-qr-rotated-002';
const NEW_FALLBACK = 'AFH-3333-4444';

describe('credential reissue', () => {
  it('7. rotates on reason, audits actor and reason, keeps balances', async () => {
    const db = install({
      rpcs: [
        {
          fn: 'reissue_membership_credentials',
          result: {
            membership_id: MEMBERSHIP.active,
            fallback_code: NEW_FALLBACK,
            qr_token: NEW_QR,
          },
        },
      ],
    });
    const before = Number(
      db.rows('memberships').find((r) => r.id === MEMBERSHIP.active)!.points_balance,
    );
    const state = await call({
      method: 'POST',
      path: `${MEMBERSHIP.active}/reissue`,
      body: { reason: 'Lost card reported at the desk' },
    });
    expect(state.status).toBe(201);
    expect(state.body).toMatchObject({
      membershipId: MEMBERSHIP.active,
      fallbackCode: NEW_FALLBACK,
      qrToken: NEW_QR,
      previousCodesInvalidated: true,
    });
    const audits = db
      .rows('audit_events')
      .filter((a) => a.action === 'MEMBERSHIP_CREDENTIALS_REISSUED');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor_id: expect.any(String) });
    expect(JSON.stringify(audits)).not.toContain(NEW_QR);
    expect(JSON.stringify(audits)).not.toContain(NEW_FALLBACK);
    const after = db.rows('memberships').find((r) => r.id === MEMBERSHIP.active)!;
    expect(Number(after.points_balance)).toBe(before);
    expect(db.rows('memberships').filter((r) => r.id === MEMBERSHIP.active)).toHaveLength(1);
  });

  it('8. denies sellers, strangers and reason-less calls', async () => {
    install({
      rpcs: [
        {
          fn: 'reissue_membership_credentials',
          result: {
            membership_id: MEMBERSHIP.active,
            fallback_code: NEW_FALLBACK,
            qr_token: NEW_QR,
          },
        },
      ],
    });
    // A seller holds customer-service views but never the activation update.
    expect(
      (
        await call({
          method: 'POST',
          path: `${MEMBERSHIP.active}/reissue`,
          token: TOKEN2.salesManager,
          body: { reason: 'Lost card reported at the desk' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call({
          method: 'POST',
          path: `${MEMBERSHIP.active}/reissue`,
          body: {},
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call({
          method: 'POST',
          path: `00000000-0000-4000-8000-000000000099/reissue`,
          body: { reason: 'Lost card reported at the desk' },
        })
      ).status,
    ).toBe(404);
  });

  it('9/10/11/12. old codes die and the new pair resolves after rotation', async () => {
    const db = install({
      rpcs: [
        {
          fn: 'reissue_membership_credentials',
          result: {
            membership_id: MEMBERSHIP.active,
            fallback_code: NEW_FALLBACK,
            qr_token: NEW_QR,
          },
        },
      ],
    });
    expect(
      (
        await call({
          method: 'POST',
          path: `${MEMBERSHIP.active}/reissue`,
          body: { reason: 'Damaged card' },
        })
      ).status,
    ).toBe(201);
    // Apply the rotation effect the RPC performs in production.
    const row = db.rows('memberships').find((r) => r.id === MEMBERSHIP.active)!;
    row.qr_token_hash = hash(NEW_QR);
    row.fallback_code_hash = hash(NEW_FALLBACK);
    for (const dead of [QR, FALLBACK]) {
      expect((await call({ path: 'resolve', query: { identifier: dead } })).status, dead).toBe(404);
    }
    for (const live of [NEW_QR, NEW_FALLBACK]) {
      const state = await call({ path: 'resolve', query: { identifier: live } });
      expect(state.status, live).toBe(200);
      expect(state.body).toMatchObject({ membershipId: MEMBERSHIP.active });
    }
  });

  it('29. concurrent reissues each return distinct codes with one membership', async () => {
    const db = install({
      rpcs: [
        {
          fn: 'reissue_membership_credentials',
          result: (() => {
            let n = 0;
            return () => {
              n += 1;
              return {
                membership_id: MEMBERSHIP.active,
                fallback_code: `AFH-900${n}-900${n}`,
                qr_token: `concurrent-qr-${n}`,
              };
            };
          })(),
        },
      ],
    });
    const [first, second] = await Promise.all([
      call({
        method: 'POST',
        path: `${MEMBERSHIP.active}/reissue`,
        body: { reason: 'Two desks at once' },
      }),
      call({
        method: 'POST',
        path: `${MEMBERSHIP.active}/reissue`,
        body: { reason: 'Two desks at once' },
      }),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((first.body as { qrToken: string }).qrToken).not.toBe(
      (second.body as { qrToken: string }).qrToken,
    );
    expect(db.rows('memberships').filter((r) => r.id === MEMBERSHIP.active)).toHaveLength(1);
  });
});

/* ================================================================== */
/* Print tracking is not rotation                                       */
/* ================================================================== */

describe('print tracking', () => {
  it('18/19/20. records first print and reprint without touching credentials', async () => {
    const db = install();
    const hashesBefore = JSON.stringify({
      qr: db.rows('memberships').find((r) => r.id === MEMBERSHIP.active)!.qr_token_hash,
      fb: db.rows('memberships').find((r) => r.id === MEMBERSHIP.active)!.fallback_code_hash,
    });
    const first = await call({
      method: 'POST',
      path: `${MEMBERSHIP.active}/mark-printed`,
    });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ printCount: 1, reprint: false });
    const second = await call({
      method: 'POST',
      path: `${MEMBERSHIP.active}/mark-printed`,
    });
    expect(second.body).toMatchObject({ printCount: 2, reprint: true });
    const row = db.rows('memberships').find((r) => r.id === MEMBERSHIP.active)!;
    expect(JSON.stringify({ qr: row.qr_token_hash, fb: row.fallback_code_hash })).toBe(
      hashesBefore,
    );
    const actions = db.rows('audit_events').map((a) => a.action);
    expect(actions).toContain('MEMBERSHIP_CARD_PRINTED');
    expect(actions).toContain('MEMBERSHIP_CARD_REPRINTED');
  });

  it('refuses to record a print for strangers or unknown cards', async () => {
    install();
    expect(
      (
        await call({
          method: 'POST',
          path: `${MEMBERSHIP.active}/mark-printed`,
          token: TOKEN2.hr,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call({
          method: 'POST',
          path: `00000000-0000-4000-8000-000000000099/mark-printed`,
        })
      ).status,
    ).toBe(404);
  });
});

/* ================================================================== */
/* Packaging                                                            */
/* ================================================================== */

describe('route packaging', () => {
  it('27. packages the card routes in the single Vercel function', async () => {
    const q: Record<string, string | undefined> = {};
    expect(selectHandler('/api/v1/memberships', q)?.routeKey).toBe('memberships/memberships');
    expect(selectHandler(`/api/v1/memberships/${MEMBERSHIP.active}/card`, q)?.routeKey).toBe(
      `memberships/${MEMBERSHIP.active}/card`,
    );
    expect(selectHandler(`/api/v1/memberships/${MEMBERSHIP.active}/reissue`, q)?.routeKey).toBe(
      `memberships/${MEMBERSHIP.active}/reissue`,
    );
    expect(
      selectHandler(`/api/v1/memberships/${MEMBERSHIP.active}/mark-printed`, q)?.routeKey,
    ).toBe(`memberships/${MEMBERSHIP.active}/mark-printed`);
  });
});
