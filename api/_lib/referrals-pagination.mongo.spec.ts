import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import { createMongoReferralsHandler } from './referrals.mongo.js';
import type { MongoRow } from './customer-activation.mongo.js';

let test: Awaited<ReturnType<typeof createTestReplica>>;
const col = (name: string) => test.db.collection<MongoRow>(name);
/** The runtime derives this from BETTER_AUTH_SECRET; tests use a fixed key. */
const CURSOR_KEY = Buffer.alloc(32, 9);
type Row = Record<string, unknown>;
type Body = { data: Row[]; meta: Record<string, unknown>; error?: unknown };
const staff: Record<string, string> = {};
const nameLookups: number[] = [];

async function call(userId: string, roleSlug: string, query: Record<string, string> = {}) {
  const handler = createMongoReferralsHandler(
    test.db,
    test.client,
    (async () => ({ userId, roleSlug, permissions: [] })) as never,
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
async function allPages(userId: string, roleSlug: string, limit: number) {
  const rows: Row[] = [];
  let cursor: string | undefined;
  let total: unknown;
  for (let guard = 0; guard < 100; guard++) {
    const page = await call(userId, roleSlug, {
      limit: String(limit),
      ...(cursor ? { cursor } : {}),
    });
    expect(page.code, JSON.stringify(page.body)).toBe(200);
    expect(page.body.data.length).toBeLessThanOrEqual(limit);
    expect(page.body.meta.limit).toBe(limit);
    rows.push(...page.body.data);
    total = page.body.meta.total;
    cursor = (page.body.meta.nextCursor as string | null) ?? undefined;
    if (!cursor) break;
  }
  return { rows, total };
}
const pageOrder = (rows: Row[]) =>
  [...rows].sort((a, b) =>
    String(a.assignedAt) !== String(b.assignedAt)
      ? String(a.assignedAt) > String(b.assignedAt)
        ? -1
        : 1
      : String(a.id) < String(b.id)
        ? -1
        : 1,
  );

beforeAll(async () => {
  test = await createTestReplica({ timeoutMS: 15_000, monitorCommands: true } as never);
  test.client.on('commandStarted', (event) => {
    const command = event.command as { find?: string; filter?: { _id?: { $in?: unknown[] } } };
    if (event.commandName === 'find' && command.find === 'staff_users')
      nameLookups.push(command.filter?._id?.$in?.length ?? -1);
  });
  for (const key of ['vd', 'ssm', 'sm', 'sm2', 'ost1', 'ost2', 'ost3', 'vd2', 'sm3', 'ost4'])
    staff[key] = randomUUID();
  await col('staff_users').insertMany(
    Object.entries(staff).map(([key, id]) => ({ _id: id, full_name: `NAME ${key.toUpperCase()}` })),
  );
  const edge = (subject: string, upline: string, active: boolean, at: string) => ({
    _id: randomUUID(),
    subject_staff_id: staff[subject],
    upline_staff_id: staff[upline],
    hierarchy_role: 'sales_manager',
    is_authoritative: true,
    is_active: active,
    assigned_at: at,
  });
  // Several rows share one timestamp so the id tie-break decides their order.
  const same = '2026-10-01T00:00:00.000Z';
  await col('referral_relationships').insertMany([
    edge('ssm', 'vd', true, same),
    edge('sm', 'ssm', true, same),
    edge('sm2', 'ssm', true, same),
    edge('ost1', 'sm', true, '2026-10-03T00:00:00.000Z'),
    edge('ost2', 'sm', true, same),
    edge('ost3', 'sm2', true, '2026-10-02T00:00:00.000Z'),
    edge('ost1', 'sm2', false, '2026-09-01T00:00:00.000Z'), // OST1's retired history
    edge('ost3', 'ssm', false, same), // retired, SM is not a party
    edge('sm3', 'vd2', true, same), // another branch
    edge('ost4', 'sm3', true, '2026-10-04T00:00:00.000Z'),
    edge('ost4', 'sm', false, same), // retired into SM: SM is a party
  ] as MongoRow[]);
}, 30_000);
afterAll(async () => test?.stop());

describe('GET /referrals opt-in pagination', () => {
  it('returns exactly the authorized full list, in a deterministic order, for every role', async () => {
    for (const [who, role] of [
      ['vd', 'super_admin'],
      ['vd', 'vice_director'],
      ['ssm', 'senior_sales_manager'],
      ['sm', 'sales_manager'],
      ['ost1', 'ost'],
      ['ost4', 'ost'],
    ] as const) {
      const full = await call(staff[who]!, role);
      expect(full.code).toBe(200);
      expect(Object.keys(full.body.meta)).toEqual(['total']);
      for (const limit of [1, 2, 200]) {
        const paged = await allPages(staff[who]!, role, limit);
        expect(paged.total, `${role} total`).toBe(full.body.data.length);
        expect(paged.rows, `${role} limit ${limit}`).toEqual(pageOrder(full.body.data));
      }
    }
  });

  it('keeps U8 on every page: sellers never see sibling, unrelated or non-party retired rows', async () => {
    const { rows, total } = await allPages(staff.sm!, 'sales_manager', 1);
    const pairs = rows.map((row) => `${row.subjectName}->${row.uplineName}:${row.isActive}`);
    expect(new Set(pairs)).toEqual(
      new Set([
        'NAME SSM->NAME VD:true',
        'NAME SM->NAME SSM:true',
        'NAME OST1->NAME SM:true',
        'NAME OST2->NAME SM:true',
        'NAME OST4->NAME SM:false',
      ]),
    );
    expect(total).toBe(5);
    const body = JSON.stringify(rows);
    for (const hidden of ['NAME SM2', 'NAME OST3', 'NAME VD2', 'NAME SM3'])
      expect(body).not.toContain(hidden);
    // OST sees its own chain and only the retired rows it was a party to.
    const ost = await allPages(staff.ost1!, 'ost', 2);
    expect(
      ost.rows.map((row) => `${row.subjectName}->${row.uplineName}:${row.isActive}`).sort(),
    ).toEqual(
      [
        'NAME OST1->NAME SM2:false',
        'NAME OST1->NAME SM:true',
        'NAME SM->NAME SSM:true',
        'NAME SSM->NAME VD:true',
      ].sort(),
    );
  });

  it('rejects tampered, foreign and malformed page requests without returning rows', async () => {
    const first = await call(staff.sm!, 'sales_manager', { limit: '1' });
    const cursor = String(first.body.meta.nextCursor);
    expect(cursor).toContain('.');
    const [body, mac] = cursor.split('.');
    const forged = Buffer.from(
      JSON.stringify({ v: 1, l: 'referrals', u: staff.sm, k: ['9999', ''] }),
    ).toString('base64url');
    for (const bad of [
      `${body}.${mac}x`,
      `${forged}.${mac}`,
      `${body}.${mac}.extra`,
      'not-a-cursor',
    ]) {
      const result = await call(staff.sm!, 'sales_manager', { cursor: bad });
      expect(result.code, bad).toBe(400);
      expect(result.body.data).toBeUndefined();
    }
    // Bound to the caller: another user (even a Super Admin) cannot reuse it.
    expect((await call(staff.vd!, 'super_admin', { cursor })).code).toBe(400);
    for (const limit of ['0', '201', 'abc', '1.5'])
      expect((await call(staff.sm!, 'sales_manager', { limit })).code, limit).toBe(400);
  });

  it('continues after the cursor position when rows change between pages', async () => {
    const first = await call(staff.vd!, 'super_admin', { limit: '2' });
    const all = await allPages(staff.vd!, 'super_admin', 200);
    const removed = first.body.data[1]!;
    await col('referral_relationships').deleteOne({ _id: removed.id as string });
    try {
      const next = await call(staff.vd!, 'super_admin', {
        limit: '2',
        cursor: String(first.body.meta.nextCursor),
      });
      expect(next.code).toBe(200);
      expect(next.body.data.map((row) => row.id)).toEqual(
        all.rows.slice(2, 4).map((row) => row.id),
      );
      expect(next.body.meta.total).toBe(all.rows.length - 1);
    } finally {
      const { id, ...rest } = removed;
      await col('referral_relationships').insertOne({
        _id: id as string,
        subject_staff_id: rest.subjectStaffId,
        upline_staff_id: rest.uplineStaffId,
        hierarchy_role: rest.hierarchyRole,
        is_authoritative: rest.isAuthoritative,
        is_active: rest.isActive,
        assigned_at: rest.assignedAt,
      } as MongoRow);
    }
  });

  it('resolves names for the page rows only and fails closed without a caller identity', async () => {
    nameLookups.length = 0;
    const page = await call(staff.vd!, 'super_admin', { limit: '1' });
    expect(page.body.data).toHaveLength(1);
    expect(nameLookups).toEqual([2]);
    const anonymous = await call('', 'sales_manager', { limit: '5' });
    expect(anonymous.code).toBe(200);
    expect(anonymous.body).toEqual({ data: [], meta: { total: 0, limit: 5, nextCursor: null } });
  });
});
