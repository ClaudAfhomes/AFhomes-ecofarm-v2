/**
 * Session verification regression suite.
 *
 * Server-side token verification goes through `verifySessionToken` (the
 * `AuthSessionVerifier` capability: `getUser(jwt)`), never through the
 * inferred `SupabaseAuthClient` type directly. These cases drive the real
 * staff and customer resolvers through the real seam - the tests mock only
 * `_lib/rest.js`, so the production `verifySessionToken` implementation runs
 * against the fake's GoTrue surface, exactly as it runs against real GoTrue.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveAfHomesPrincipal } from './afhomes-access.js';
import { verifySessionToken } from './auth-verify.js';
import { resolveCustomerPrincipal } from './customer-access.js';
import { baseTables, baseTokens, TOKEN, UUID } from './testing/fixtures.js';
import { FakeSupabase, makeReq } from './testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('./rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
  requireService: () => holder.db,
  okList: () => {},
  methodNotAllowed: () => {},
  readJsonBody: (req: { body?: unknown }) => ({ ok: true as const, body: req.body }),
}));

function install(options: {
  tables?: Record<string, Record<string, unknown>[]>;
  tokens?: Record<string, { id: string; email: string; email_confirmed_at?: string | null }>;
} = {}) {
  holder.db = new FakeSupabase({
    tables: baseTables(options.tables as never),
    tokens: { ...baseTokens(), ...(options.tokens ?? {}) },
  });
  return holder.db as FakeSupabase;
}

const req = (token?: string) => makeReq({ token }) as never;

const CUSTOMER_AUTH_ID = '11111111-1111-4111-8111-1111111111aa';
const CUSTOMER_TOKEN = 'token-customer-active';

describe('verifySessionToken', () => {
  beforeEach(() => install());

  it('passes the bearer token to getUser and returns the raw response', async () => {
    const response = await verifySessionToken(
      (holder.db as FakeSupabase).auth,
      TOKEN.admin,
    );
    expect(response.error).toBeNull();
    expect(response.data.user?.id).toBe(UUID.adminStaff);
  });

  it('surfaces the GoTrue refusal for an unknown token', async () => {
    const response = await verifySessionToken(
      (holder.db as FakeSupabase).auth,
      'token-unknown',
    );
    expect(response.data.user).toBeNull();
    expect(response.error).not.toBeNull();
  });
});

describe('resolveAfHomesPrincipal through the verification seam', () => {
  beforeEach(() => install());

  it('resolves a valid authenticated user to their staff principal', async () => {
    const principal = await resolveAfHomesPrincipal(req(TOKEN.admin));
    expect('error' in principal).toBe(false);
    if ('error' in principal) return;
    expect(principal.userId).toBe(UUID.adminStaff);
    expect(principal.email).toBe('admin@afhomes.test');
    expect(principal.roleSlug).toBe('admin');
    expect(principal.status).toBe('active');
    expect(
      principal.permissions.find((p) => p.moduleKey === 'dashboard.view')?.canView,
    ).toBe(true);
  });

  it('refuses a missing token without touching GoTrue', async () => {
    const result = await resolveAfHomesPrincipal(req(undefined));
    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.error.error.code).toBe('UNAUTHORIZED');
    expect(result.error.status).toBe(401);
  });

  it('refuses an invalid token the Auth server rejects', async () => {
    const result = await resolveAfHomesPrincipal(req('token-unknown'));
    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.error.error.code).toBe('UNAUTHORIZED');
    expect(result.error.status).toBe(401);
  });

  it('refuses a lookup that returns no user id', async () => {
    install({
      tokens: {
        'token-no-id': { id: '', email: 'noid@afhomes.test', email_confirmed_at: null },
      },
    });
    const result = await resolveAfHomesPrincipal(req('token-no-id'));
    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.error.error.code).toBe('UNAUTHORIZED');
    expect(result.error.status).toBe(401);
  });

  it('still resolves staff standing after verification', async () => {
    const inactive = await resolveAfHomesPrincipal(req(TOKEN.inactive));
    expect('error' in inactive).toBe(true);
    if (!('error' in inactive)) return;
    expect(inactive.error.error.code).toBe('FORBIDDEN');
    expect(inactive.error.status).toBe(403);

    const unassigned = await resolveAfHomesPrincipal(req(TOKEN.unassigned));
    expect('error' in unassigned).toBe(true);
    if (!('error' in unassigned)) return;
    expect(unassigned.error.error.code).toBe('FORBIDDEN');
    expect(unassigned.error.status).toBe(403);
  });
});

describe('resolveCustomerPrincipal through the verification seam', () => {
  const customerRow = {
    id: '22222222-2222-4222-8222-2222222222bb',
    customer_number: 'AFH-0001',
    email: 'member@afhomes.test',
    status: 'active',
    auth_user_id: CUSTOMER_AUTH_ID,
  };

  beforeEach(() =>
    install({
      tables: { customers: [customerRow] },
      tokens: {
        [CUSTOMER_TOKEN]: {
          id: CUSTOMER_AUTH_ID,
          email: 'member@afhomes.test',
          email_confirmed_at: '2026-09-01T00:00:00.000Z',
        },
      },
    }),
  );

  it('resolves a valid customer sign-in to their owned record', async () => {
    const principal = await resolveCustomerPrincipal(req(CUSTOMER_TOKEN));
    expect('error' in principal).toBe(false);
    if ('error' in principal) return;
    expect(principal.userId).toBe(CUSTOMER_AUTH_ID);
    expect(principal.customerId).toBe(customerRow.id);
    expect(principal.customerNumber).toBe('AFH-0001');
    expect(principal.status).toBe('active');
  });

  it('refuses an invalid token', async () => {
    const result = await resolveCustomerPrincipal(req('token-unknown'));
    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.error.error.code).toBe('UNAUTHORIZED');
    expect(result.error.status).toBe(401);
  });

  it('refuses a verified Auth user with no customer record', async () => {
    const result = await resolveCustomerPrincipal(req(TOKEN.admin));
    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.error.error.code).toBe('FORBIDDEN');
    expect(result.error.status).toBe(403);
  });
});
