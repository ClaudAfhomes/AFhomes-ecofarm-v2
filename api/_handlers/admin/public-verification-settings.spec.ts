import { beforeEach, expect, it, vi } from 'vitest';
import { FakeSupabase, makeReq, makeRes } from '../../_lib/testing/supabase-fake.js';
import { baseTables, baseTokens, TOKEN, UUID, moduleId } from '../../_lib/testing/fixtures.js';
const holder = vi.hoisted(() => ({ db: null as FakeSupabase | null }));
vi.mock('../../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
  userClient: () => holder.db,
}));
const handler = (await import('./afhomes.js')).default;
const initial = {
  enabled: false,
  verificationPhone: '+639604316867',
  privacyNotice: 'Synthetic finalized privacy notice. '.repeat(8),
  retentionDays: 30,
  noticeVersion: 'v1',
  revision: 1,
  updatedAt: '2026-10-22T00:00:00.000Z',
};
let stored = { ...initial };
beforeEach(() => {
  stored = { ...initial };
  holder.db = new FakeSupabase({
    tables: baseTables(),
    tokens: baseTokens(),
    rpcs: [
      { fn: 'get_public_verification_settings', result: () => ({ ...stored }) },
      {
        fn: 'update_public_verification_settings',
        result: (args: Record<string, unknown>) => {
          stored = {
            ...stored,
            ...(args.p_input as typeof initial),
            revision: stored.revision + 1,
          };
          return { ...stored };
        },
      },
    ],
  });
});
async function call(method = 'GET', token: string | null = TOKEN.superAdmin, body?: unknown) {
  const { res, state } = makeRes();
  await handler(
    makeReq({
      method,
      token: token ?? undefined,
      body,
      query: { afPath: 'public-verification-settings' },
    }),
    res,
  );
  return state;
}
it('persists settings through the actor-checked RPC and reads them back', async () => {
  const { noticeVersion, revision, updatedAt, ...fields } = initial;
  const state = await call('PUT', TOKEN.superAdmin, {
    ...fields,
    enabled: true,
    retentionDays: 90,
    expectedRevision: 1,
  });
  expect(state.status).toBe(200);
  expect((await call()).body).toMatchObject({ enabled: true, retentionDays: 90, revision: 2 });
  expect(
    holder.db?.calls.find(
      (c) => c.op === 'rpc' && c.table === 'update_public_verification_settings',
    )?.arg,
  ).toMatchObject({ p_actor: UUID.superAdminStaff, p_expected_revision: 1 });
});
it('refuses anonymous and ordinary staff before any settings RPC', async () => {
  expect((await call('GET', null)).status).toBe(401);
  expect((await call('GET', TOKEN.viewer)).status).toBe(403);
  expect(
    holder.db?.calls.some(
      (c) => c.op === 'rpc' && c.table.includes('public_verification_settings'),
    ),
  ).toBe(false);
});
it('honors deny-only configuration update restrictions', async () => {
  holder.db!.tables.staff_permission_restrictions!.push({
    staff_id: UUID.superAdminStaff,
    module_id: moduleId('governance.config'),
    deny_update: true,
  });
  expect((await call('PUT', TOKEN.superAdmin, {})).status).toBe(403);
  expect(
    holder.db?.calls.some(
      (c) => c.op === 'rpc' && c.table.includes('public_verification_settings'),
    ),
  ).toBe(false);
});
it('rejects invalid retention and stale updates without reporting a save', async () => {
  expect(
    (await call('PUT', TOKEN.superAdmin, { ...initial, expectedRevision: 1, retentionDays: 0 }))
      .status,
  ).toBe(400);
  holder.db!.rpcErrors.update_public_verification_settings = {
    code: '23505',
    message: 'SETTINGS_CHANGED',
  };
  const { noticeVersion, revision, updatedAt, ...fields } = initial;
  expect((await call('PUT', TOKEN.superAdmin, { ...fields, expectedRevision: 1 })).status).toBe(
    409,
  );
});
