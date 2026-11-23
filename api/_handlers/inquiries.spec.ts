/**
 * Website inquiries inbox: the public form stores one row per submission (no
 * session, honeypot, rate limit, idempotent on requestId); only `sales.inquiries`
 * holders read or work the inbox, and every staff change is audited without the
 * note text. Drives the REAL handler, resolver and contracts on the fake.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';
import { baseTables, baseTokens, TOKEN, UUID } from '../_lib/testing/fixtures.js';
import { resetIdentifierRateLimit } from '../_lib/rate-limit.js';

const holder = vi.hoisted(() => ({ db: null as unknown as FakeSupabase }));
vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
}));

const handler = (await import('./inquiries.js')).default;

let seq = 0;
function setup() {
  seq = 0;
  holder.db = new FakeSupabase({
    tables: baseTables({ website_inquiries: [] }),
    tokens: baseTokens(),
    unique: { website_inquiries: [['client_request_id']] },
    defaults: { website_inquiries: { status: 'new', staff_notes: '', assigned_to: null, handled_at: null } },
  });
  // Postgres generates `reference` from an identity column; mirror it.
  const insert = holder.db.from.bind(holder.db);
  holder.db.from = ((table: string) => {
    const q = insert(table);
    if (table !== 'website_inquiries') return q;
    const original = q.insert.bind(q);
    q.insert = (row: Record<string, unknown>) => {
      seq += 1;
      const now = new Date().toISOString();
      return original({ reference: `INQ-${String(seq).padStart(6, '0')}`, created_at: now, updated_at: now, ...row });
    };
    return q;
  }) as typeof holder.db.from;
  return holder.db;
}

const run = async (opts: Parameters<typeof makeReq>[0]) => {
  const res = makeRes();
  await handler(makeReq({ familyPath: '', ...opts }) as never, res.res as never);
  return res.state;
};

const form = (over: Record<string, unknown> = {}) => ({
  requestId: '9b2f4c1e-7a3d-4e5f-9a1b-2c3d4e5f6a7b',
  kind: 'inquiry',
  name: 'Juan dela Cruz',
  email: 'Juan@Example.COM',
  contactNumber: '0917 123 4567',
  inquiryType: 'Smart Wellness Hotel',
  message: 'Do you have rooms for two adults next weekend?',
  ...over,
});

beforeEach(() => {
  resetIdentifierRateLimit();
  setup();
});

describe('POST inquiries (public website form)', () => {
  it('stores a submission without a session and returns its reference', async () => {
    const state = await run({ method: 'POST', body: form() });
    expect(state.status).toBe(201);
    expect(state.body).toMatchObject({ reference: 'INQ-000001' });
    const row = holder.db.tables.website_inquiries![0]!;
    expect(row).toMatchObject({
      client_request_id: '9b2f4c1e-7a3d-4e5f-9a1b-2c3d4e5f6a7b',
      name: 'JUAN DELA CRUZ',
      email: 'juan@example.com',
      contact_number: '+639171234567',
      kind: 'inquiry',
      status: 'new',
    });
  });

  it('keeps a foreign number as typed and refuses letters in it', async () => {
    expect((await run({ method: 'POST', body: form({ contactNumber: '+1 (415) 555-0100' }) })).status).toBe(201);
    expect(holder.db.tables.website_inquiries![0]!.contact_number).toBe('+1 (415) 555-0100');
    const bad = await run({
      method: 'POST',
      body: form({ requestId: '1b2f4c1e-7a3d-4e5f-9a1b-2c3d4e5f6a7b', contactNumber: 'call me maybe' }),
    });
    expect(bad.status).toBe(400);
  });

  it('returns the same reference for a retried submission and stores one row', async () => {
    await run({ method: 'POST', body: form() });
    const retry = await run({ method: 'POST', body: form() });
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ reference: 'INQ-000001' });
    expect(holder.db.tables.website_inquiries).toHaveLength(1);
  });

  it('requires a visit date and guests for a reservation request', async () => {
    const state = await run({ method: 'POST', body: form({ kind: 'reservation' }) });
    expect(state.status).toBe(400);
    expect(holder.db.tables.website_inquiries).toHaveLength(0);
    const ok = await run({
      method: 'POST',
      body: form({ kind: 'reservation', visitDate: '2099-01-10', endDate: '2099-01-12', guests: 2 }),
    });
    expect(ok.status).toBe(201);
  });

  it('answers a filled honeypot like a success and stores nothing', async () => {
    const state = await run({ method: 'POST', body: form({ website: 'http://spam.example' }) });
    expect(state.status).toBe(201);
    // Indistinguishable from a real reply: same reference shape.
    expect((state.body as { reference: string }).reference).toMatch(/^INQ-\d{6}$/);
    expect(holder.db.tables.website_inquiries).toHaveLength(0);
  });

  it('limits one connection to five submissions a minute', async () => {
    for (let i = 0; i < 5; i += 1) {
      const id = `${i}b2f4c1e-7a3d-4e5f-9a1b-2c3d4e5f6a7b`;
      expect((await run({ method: 'POST', body: form({ requestId: id }) })).status).toBe(201);
    }
    const sixth = await run({
      method: 'POST',
      body: form({ requestId: '6b2f4c1e-7a3d-4e5f-9a1b-2c3d4e5f6a7b' }),
    });
    expect(sixth.status).toBe(429);
    expect(holder.db.tables.website_inquiries).toHaveLength(5);
  });
});

describe('GET inquiries (staff inbox)', () => {
  it('requires a session and sales.inquiries view', async () => {
    expect((await run({})).status).toBe(401);
    expect((await run({ token: TOKEN.viewer })).status).toBe(403);
  });

  it('lists open inquiries newest first with the new count', async () => {
    await run({ method: 'POST', body: form() });
    await run({ method: 'POST', body: form({ requestId: '2b2f4c1e-7a3d-4e5f-9a1b-2c3d4e5f6a7b', name: 'Ana Reyes' }) });
    holder.db.tables.website_inquiries![0]!.status = 'closed';
    const state = await run({ token: TOKEN.admin });
    expect(state.status).toBe(200);
    const body = state.body as { data: { name: string }[]; meta: { total: number; newCount: number } };
    expect(body.data.map((r) => r.name)).toEqual(['ANA REYES']);
    expect(body.meta).toMatchObject({ total: 1, newCount: 1 });
    const all = (await run({ token: TOKEN.admin, query: { status: 'all' } })).body as { data: unknown[] };
    expect(all.data).toHaveLength(2);
  });

  it('searches by name and ignores filter syntax in the term', async () => {
    await run({ method: 'POST', body: form() });
    const hit = (await run({ token: TOKEN.admin, query: { search: 'dela' } })).body as { data: unknown[] };
    expect(hit.data).toHaveLength(1);
    const injected = await run({ token: TOKEN.admin, query: { search: 'x),status.eq.spam,(name' } });
    expect(injected.status).toBe(200);
  });
});

describe('PATCH inquiries/:id (staff update)', () => {
  const firstId = () => holder.db.tables.website_inquiries![0]!.id as string;

  it('requires sales.inquiries update', async () => {
    await run({ method: 'POST', body: form() });
    expect((await run({ method: 'PATCH', familyPath: firstId(), body: { status: 'contacted' } })).status).toBe(401);
    expect(
      (await run({ method: 'PATCH', familyPath: firstId(), token: TOKEN.viewer, body: { status: 'contacted' } })).status,
    ).toBe(403);
  });

  it('updates status, notes and assignee, and audits without the note text', async () => {
    await run({ method: 'POST', body: form() });
    const state = await run({
      method: 'PATCH',
      familyPath: firstId(),
      token: TOKEN.admin,
      body: { status: 'contacted', staffNotes: 'Called, wants Saturday.', assignToMe: true },
    });
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({
      status: 'contacted',
      staffNotes: 'Called, wants Saturday.',
      assignedTo: UUID.adminStaff,
      assignedToName: expect.any(String),
    });
    const row = holder.db.tables.website_inquiries![0]!;
    expect(row.handled_by).toBe(UUID.adminStaff);
    const auditRow = holder.db.tables.audit_events!.find((a) => a.action === 'INQUIRY_UPDATED')!;
    expect(auditRow).toMatchObject({ actor_id: UUID.adminStaff, entity_id: firstId() });
    expect(JSON.stringify(auditRow)).not.toContain('Saturday');
    expect(auditRow.after_data).toMatchObject({ status: 'contacted', notesChanged: true });
  });

  it('writes no audit when nothing changes, refuses empty and unknown fields', async () => {
    await run({ method: 'POST', body: form() });
    const same = await run({ method: 'PATCH', familyPath: firstId(), token: TOKEN.admin, body: { status: 'new' } });
    expect(same.status).toBe(200);
    expect(holder.db.tables.audit_events).toHaveLength(0);
    expect((await run({ method: 'PATCH', familyPath: firstId(), token: TOKEN.admin, body: {} })).status).toBe(400);
    expect(
      (await run({ method: 'PATCH', familyPath: firstId(), token: TOKEN.admin, body: { email: 'x@y.z' } })).status,
    ).toBe(400);
  });

  it('returns 404 for an unknown inquiry', async () => {
    const state = await run({
      method: 'PATCH',
      familyPath: '00000000-0000-4000-8000-000000000999',
      token: TOKEN.admin,
      body: { status: 'closed' },
    });
    expect(state.status).toBe(404);
  });
});
