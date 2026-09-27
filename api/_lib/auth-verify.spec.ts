/**
 * Session verification regression suite.
 *
 * Server-side token verification goes through `verifySessionToken`. Its input
 * contract (`AuthSessionVerifier`) is derived from auth-js' public
 * `GoTrueClient.getUser` member - never hand-duplicated - so the real
 * supabase-js `anon.auth` subclass satisfies it by construction. The helper normalizes after
 * the call to exactly what authorization consumes. These cases prove both
 * sides: spec-built stubs satisfy the derived contract at compile time, the
 * production helper runs against the fake's GoTrue surface at runtime (only
 * `_lib/rest.js` is mocked), and both resolvers keep their exact
 * success/denial mapping through the seam.
 */
import { AuthError } from '@supabase/auth-js';
import type { GoTrueClient, User } from '@supabase/auth-js';
import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveAfHomesPrincipal } from './afhomes-access.js';
import type { AuthSessionVerifier } from './auth-verify.js';
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

function install(
  options: {
    tables?: Record<string, Record<string, unknown>[]>;
    tokens?: Record<string, { id: string; email: string; email_confirmed_at?: string | null }>;
  } = {},
) {
  holder.db = new FakeSupabase({
    tables: baseTables(options.tables as never),
    tokens: { ...baseTokens(), ...(options.tokens ?? {}) },
  });
  return holder.db as FakeSupabase;
}

const req = (token?: string) => makeReq({ token }) as never;

const CUSTOMER_AUTH_ID = '11111111-1111-4111-8111-1111111111aa';
const CUSTOMER_TOKEN = 'token-customer-active';

// Compile-time deployment probe: the concrete supabase-js auth client must be
// accepted by the public auth-js boundary used by the server adapter.
const concreteAuthClient: GoTrueClient = createClient('https://example.supabase.co', 'anon').auth;
const concreteVerifier: AuthSessionVerifier = concreteAuthClient;
void concreteVerifier;

/** A complete Supabase user: every field the real `User` type requires. */
const stubUser = (overrides: Partial<User> = {}): User => ({
  id: 'stub-user-1',
  email: 'stub@afhomes.test',
  email_confirmed_at: '2026-09-01T00:00:00.000Z',
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: '2026-09-01T00:00:00.000Z',
  ...overrides,
});

describe('verifySessionToken', () => {
  beforeEach(() => install());

  it('accepts the real getUser shape and normalizes a valid user', async () => {
    const verifier: AuthSessionVerifier = {
      getUser: async () => ({ data: { user: stubUser() }, error: null }),
    };
    const response = await verifySessionToken(verifier, 'jwt');
    expect(response.error).toBeNull();
    expect(response.data.user?.id).toBe('stub-user-1');
    expect(response.data.user?.email).toBe('stub@afhomes.test');
    expect(response.data.user?.email_confirmed_at).toBe('2026-09-01T00:00:00.000Z');
  });

  it('preserves the Supabase refusal and null user when GoTrue reports an error', async () => {
    const verifier: AuthSessionVerifier = {
      getUser: async () => ({ data: { user: null }, error: new AuthError('bad jwt', 400) }),
    };
    const response = await verifySessionToken(verifier, 'jwt');
    expect(response.data.user).toBeNull();
    expect(response.error?.message).toBe('bad jwt');
  });

  it('allows a user without an email', async () => {
    const verifier: AuthSessionVerifier = {
      getUser: async () => ({ data: { user: stubUser({ email: undefined }) }, error: null }),
    };
    const response = await verifySessionToken(verifier, 'jwt');
    expect(response.error).toBeNull();
    expect(response.data.user?.id).toBe('stub-user-1');
    expect(response.data.user?.email).toBeUndefined();
  });

  it('allows a user without email_confirmed_at', async () => {
    const verifier: AuthSessionVerifier = {
      getUser: async () => ({
        data: { user: stubUser({ email_confirmed_at: undefined }) },
        error: null,
      }),
    };
    const response = await verifySessionToken(verifier, 'jwt');
    expect(response.error).toBeNull();
    expect(response.data.user?.email_confirmed_at).toBeUndefined();
  });

  it('forwards the bearer token as the jwt argument', async () => {
    let seen: string | undefined;
    const verifier: AuthSessionVerifier = {
      getUser: async (jwt?: string) => {
        seen = jwt;
        return { data: { user: stubUser() }, error: null };
      },
    };
    await verifySessionToken(verifier, 'the-bearer-token');
    expect(seen).toBe('the-bearer-token');
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
    expect(principal.permissions.find((p) => p.moduleKey === 'dashboard.view')?.canView).toBe(true);
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
