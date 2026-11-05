import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import { createMongoMembersHandler } from './members.mongo.js';
import type { MongoRow } from './customer-activation.mongo.js';

let test: Awaited<ReturnType<typeof createTestReplica>>;
const col = (name: string) => test.db.collection<MongoRow>(name);
const ROLE = {
  vice_director: randomUUID(),
  senior_sales_manager: randomUUID(),
  sales_manager: randomUUID(),
  ost: randomUUID(),
  super_admin: randomUUID(),
};
const ids: Record<string, string> = {};
/** The runtime derives this from BETTER_AUTH_SECRET; tests use a fixed key. */
const CURSOR_KEY = Buffer.alloc(32, 7);
type Body = { data: Record<string, unknown>[]; meta: Record<string, unknown> };

async function call(userId: string, roleSlug: string, query: Record<string, string> = {}) {
  const handler = createMongoMembersHandler(
    test.db,
    test.client,
    (async () => ({
      userId,
      roleSlug,
      permissions: [],
    })) as never,
    undefined,
    CURSOR_KEY,
  );
  const res = {
    code: 0,
    body: undefined as unknown,
    setHeader() {},
    status(code: number) {
      this.code = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  await handler(
    { method: 'GET', headers: {}, query: { familyPath: '', ...query } } as never,
    res as never,
  );
  return { code: res.code, body: res.body as Body };
}
async function allPages(userId: string, roleSlug: string, query: Record<string, string>) {
  const rows: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  let total: unknown;
  for (let guard = 0; guard < 100; guard++) {
    const page = await call(userId, roleSlug, { ...query, ...(cursor ? { cursor } : {}) });
    expect(page.code, JSON.stringify(page.body)).toBe(200);
    rows.push(...page.body.data);
    total = page.body.meta.total;
    cursor = page.body.meta.nextCursor as string | undefined;
    if (!cursor) break;
  }
  return { rows, total };
}
const byNameThenId = (a: Record<string, unknown>, b: Record<string, unknown>) => {
  const [an, bn, ai, bi] = [String(a.fullName), String(b.fullName), String(a.id), String(b.id)];
  return an < bn ? -1 : an > bn ? 1 : ai < bi ? -1 : ai > bi ? 1 : 0;
};

beforeAll(async () => {
  test = await createTestReplica();
  await col('roles').insertMany(
    Object.entries(ROLE).map(([slug, _id]) => ({
      _id,
      slug,
      name: slug.toUpperCase(),
      is_active: true,
    })),
  );
  const department = randomUUID();
  await col('departments').insertOne({
    _id: department,
    name: 'Sales',
    code: 'SALES',
    is_active: true,
  });
  let n = 0;
  const add = async (key: string, slug: keyof typeof ROLE, upline?: string, name?: string) => {
    const id = randomUUID();
    ids[key] = id;
    n++;
    await col('staff_users').insertOne({
      _id: id,
      full_name: name ?? `MEMBER ${String(n).padStart(3, '0')}`,
      email: `m${n}@example.invalid`,
      status: 'active',
      employee_number: `E${n}`,
      department_id: department,
      created_at: '2026-01-01T00:00:00.000Z',
    });
    await col('staff_role_assignments').insertOne({
      _id: randomUUID(),
      staff_id: id,
      role_id: ROLE[slug],
    });
    await col('network_member_profiles').insertOne({
      _id: randomUUID(),
      staff_id: id,
      referrer_staff_id: upline ?? null,
      mobile_no: '+639170000000',
      tin: `123-456-${String(n).padStart(3, '0')}`,
      government_id_number: `P${String(n).padStart(7, '0')}`,
    });
    await col('sale_team_accreditations').insertOne({
      _id: randomUUID(),
      staff_id: id,
      aa_number: `AA-${n}`,
    });
    if (upline)
      await col('referral_relationships').insertOne({
        _id: randomUUID(),
        subject_staff_id: id,
        upline_staff_id: upline,
        is_active: true,
      });
  };
  await add('admin', 'super_admin');
  for (const team of ['a', 'b']) {
    await add(`vd-${team}`, 'vice_director');
    await add(`ssm-${team}`, 'senior_sales_manager', ids[`vd-${team}`]);
    await add(`sm-${team}`, 'sales_manager', ids[`ssm-${team}`]);
    for (let i = 0; i < 12; i++) await add(`ost-${team}-${i}`, 'ost', ids[`sm-${team}`]);
  }
  // Duplicate names exercise the id tie-breaker.
  await add('twin-1', 'ost', ids['sm-a'], 'SAME NAME');
  await add('twin-2', 'ost', ids['sm-a'], 'SAME NAME');
}, 60_000);
afterAll(async () => test?.stop());

describe('opt-in members pagination', () => {
  it('keeps the unpaged response exactly as before', async () => {
    const full = await call(ids.admin!, 'super_admin');
    expect(full.code).toBe(200);
    expect(Object.keys(full.body.meta)).toEqual(['total']);
    expect(full.body.meta.total).toBe(full.body.data.length);
  });

  it.each([
    ['super_admin', 'admin', {}],
    ['super_admin', 'admin', { position: 'ost' }],
    ['super_admin', 'admin', { search: 'member 01' }],
    ['vice_director', 'vd-a', {}],
    ['senior_sales_manager', 'ssm-b', {}],
    ['sales_manager', 'sm-a', { position: 'ost' }],
    ['ost', 'ost-a-3', {}],
  ] as const)('pages %s (%s %j) are the full list in name/id order', async (role, who, filters) => {
    const full = await call(ids[who]!, role, filters);
    expect(full.code).toBe(200);
    const paged = await allPages(ids[who]!, role, { ...filters, limit: '4' });
    expect(paged.total).toBe(full.body.meta.total);
    expect(paged.rows).toEqual([...full.body.data].sort(byNameThenId));
  });

  it('applies the default (50) and maximum (200) page sizes and rejects bad sizes', async () => {
    const first = await call(ids.admin!, 'super_admin', { limit: '200' });
    expect(first.body.meta.limit).toBe(200);
    for (const limit of ['0', '201', 'x', '2.5'])
      expect((await call(ids.admin!, 'super_admin', { limit })).code, limit).toBe(400);
    const small = await call(ids.admin!, 'super_admin', { limit: '2' });
    const next = await call(ids.admin!, 'super_admin', {
      cursor: small.body.meta.nextCursor as string,
    });
    expect(next.body.meta.limit).toBe(50);
  });

  it('rejects tampered, foreign-user and foreign-filter cursors without widening access', async () => {
    const page = await call(ids['sm-a']!, 'sales_manager', { limit: '2' });
    const cursor = page.body.meta.nextCursor as string;
    const [body, mac] = cursor.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body!, 'base64url').toString()), u: ids.admin }),
    ).toString('base64url');
    for (const bad of [`${forged}.${mac}`, `${body}.AAAA`, 'not-a-cursor', `${body}.${mac}.x`])
      expect((await call(ids['sm-a']!, 'sales_manager', { cursor: bad })).code, bad).toBe(400);
    // A valid cursor is bound to its caller and filters.
    expect((await call(ids['sm-b']!, 'sales_manager', { cursor })).code).toBe(400);
    expect((await call(ids['sm-a']!, 'sales_manager', { cursor, position: 'ost' })).code).toBe(400);
    // Seller pages never include members outside the caller's visibility.
    const seller = await allPages(ids['sm-a']!, 'sales_manager', { limit: '5' });
    expect(seller.rows.map((row) => row.id)).not.toContain(ids['ost-b-0']);
  });

  it('validates only page rows on paged reads; full lists still fail on malformed members', async () => {
    const bad = randomUUID();
    await col('staff_users').insertOne({
      _id: bad,
      full_name: 'ZZZ MALFORMED',
      status: 'active',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    await col('staff_role_assignments').insertOne({
      _id: randomUUID(),
      staff_id: bad,
      role_id: ROLE.ost,
    });
    try {
      expect((await call(ids.admin!, 'super_admin')).code).toBe(400);
      const first = await call(ids.admin!, 'super_admin', { limit: '5' });
      expect(first.code).toBe(200);
      expect(first.body.data.map((row) => row.id)).not.toContain(bad);
      // The malformed row still counts (it matches) and fails as soon as its page is requested.
      const all = await call(ids.admin!, 'super_admin', { limit: '200' });
      expect(all.code).toBe(400);
    } finally {
      await col('staff_users').deleteOne({ _id: bad });
      await col('staff_role_assignments').deleteOne({ staff_id: bad });
    }
  });

  it('does not let search match an email the caller cannot see (paged or not)', async () => {
    const upline = (await col('staff_users').findOne(
      { _id: ids['ssm-a'] },
      { projection: { email: 1, full_name: 1 } },
    ))!;
    // The SM sees its SSM upline listed (name only, email blanked); searching that email finds nothing.
    const queries: Record<string, string>[] = [
      { search: String(upline.email) },
      { search: String(upline.email), limit: '10' },
    ];
    for (const query of queries) {
      const seller = await call(ids['sm-a']!, 'sales_manager', query);
      expect(seller.code).toBe(200);
      expect(seller.body.data.map((row) => row.id)).not.toContain(ids['ssm-a']);
      expect(seller.body.meta.total).toBe(0);
    }
    const byName = await call(ids['sm-a']!, 'sales_manager', { search: String(upline.full_name) });
    expect(byName.body.data.map((row) => row.id)).toContain(ids['ssm-a']);
    expect(byName.body.data.find((row) => row.id === ids['ssm-a'])!.email).toBe('');
    // A caller who may see the email still finds the member by it.
    const admin = await call(ids.admin!, 'super_admin', { search: String(upline.email) });
    expect(admin.body.data.map((row) => row.id)).toContain(ids['ssm-a']);
  });

  it('returns masked identity numbers on paged rows exactly like the full list', async () => {
    const full = await call(ids.admin!, 'super_admin');
    const paged = await allPages(ids.admin!, 'super_admin', { limit: '7' });
    const tin = (rows: Record<string, unknown>[]) =>
      Object.fromEntries(rows.map((row) => [row.id, [row.tinMasked, row.governmentIdMasked]]));
    expect(tin(paged.rows)).toEqual(tin(full.body.data));
    expect(JSON.stringify(paged.rows)).not.toMatch(/123-456-\d{3}"|P\d{7}"/);
  });
});
