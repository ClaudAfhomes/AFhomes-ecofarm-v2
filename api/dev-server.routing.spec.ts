/**
 * AF Homes Phase 13 - real HTTP routing verification through the dev server.
 *
 * Unit tests prove handlers against simulated sub-paths; this spec proves the
 * FULL path a browser request travels: TCP -> api/dev-server.ts -> the shared
 * routeRequest -> family loader -> handler dispatch. Supabase env is scrubbed
 * and the server runs with a scratch working directory (so no .env file can
 * leak in), which means no database exists: handler branches that authorize
 * first answer 401, branches that need the database answer 500, and the
 * router itself answers 404 for unknown paths. Every assertion below keys on
 * that distinction - a request that reaches a HANDLER can never come back as
 * `No handler for ...`.
 *
 * Nothing here touches production data: there is no database to touch.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PORT = 32107;
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER_FILE = join(dirname(fileURLToPath(import.meta.url)), 'dev-server.ts');

let child: ChildProcess | null = null;

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/health`);
      // Any HTTP answer - even the unconfigured-dependency 500 - proves the
      // server is up and routing.
      if (res.status > 0) return;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error('dev server did not start in time');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

beforeAll(async () => {
  const scrubbed: Record<string, string | undefined> = { ...process.env };
  for (const key of [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_ANON_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
    'VITE_SUPABASE_PUBLISHABLE_KEY',
    'DATABASE_URL',
  ]) {
    delete scrubbed[key];
  }
  child = spawn(`npx tsx "${SERVER_FILE}" ${PORT}`, {
    cwd: mkdtempSync(join(tmpdir(), 'afhomes-dev-server-')),
    env: scrubbed,
    shell: true,
    stdio: 'ignore',
  });
  await waitForServer();
}, 90_000);

afterAll(async () => {
  if (child) {
    child.kill('SIGKILL');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5000);
      child!.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    child = null;
  }
});

type Envelope = { error?: { code?: string; message?: string } };

async function call(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: Envelope & Record<string, unknown> }> {
  const res = await fetch(`${BASE}${path}`, init);
  const body = (await res.json().catch(() => ({}))) as Envelope & Record<string, unknown>;
  return { status: res.status, body };
}

const handlerReached = (r: { status: number; body: Envelope }) => {
  // Both signals prove the router dispatched to a handler (the router's own
  // miss is 404 `No handler for ...`): branches that authorize first answer
  // 401 without a session, and branches that need the database answer 500
  // without configuration.
  if (r.status === 401) {
    expect(r.body.error?.code).toBe('UNAUTHORIZED');
    return;
  }
  expect(r.status).toBe(500);
  expect([
    'Supabase server configuration is incomplete',
    'Server configuration is incomplete',
  ]).toContain(r.body.error?.message);
};

describe('dev-server HTTP routing', () => {
  it('reaches the sales family: root, detail, summary, record, verify, activate', async () => {
    handlerReached(await call('/api/v1/sales'));
    handlerReached(await call('/api/v1/sales/abc'));
    handlerReached(await call('/api/v1/sales/abc/summary'));
    handlerReached(
      await call('/api/v1/sales/abc/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }),
    );
    handlerReached(
      await call('/api/v1/payments/abc/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }),
    );
    handlerReached(
      await call('/api/v1/sales/abc/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }),
    );
  });

  it('reaches customers, memberships, points, ost and documents branches', async () => {
    handlerReached(await call('/api/v1/customers/abc'));
    handlerReached(await call('/api/v1/memberships/resolve?identifier=x'));
    handlerReached(await call('/api/v1/memberships/abc'));
    handlerReached(await call('/api/v1/points/accounts/abc'));
    handlerReached(await call('/api/v1/ost/applications/abc'));
    handlerReached(await call('/api/v1/documents/abc'));
    handlerReached(await call('/api/v1/redemptions/resolve?identifier=x'));
    handlerReached(await call('/api/v1/queues/finance'));
    handlerReached(await call('/api/v1/customer/membership'));
    handlerReached(await call('/api/v1/commissions/abc/qualify', { method: 'POST' }));
    handlerReached(await call('/api/v1/referrals/abc', { method: 'PATCH' }));
    handlerReached(await call('/api/v1/genealogy/abc'));
  });

  it('answers unknown paths with the router safe envelope', async () => {
    const r = await call('/api/v1/nope');
    expect(r.status).toBe(404);
    expect(r.body.error?.message).toBe('No handler for /api/v1/nope');
  });

  it('answers unknown nested suffixes from the handler family, never the router', async () => {
    // Either refusal shape proves family dispatch rather than a router miss;
    // which branch answers inside the family is proven per-branch with a
    // database in routing-contract.spec.ts.
    for (const path of [
      '/api/v1/sales/not-a-real-subroute/extra',
      '/api/v1/documents/unknown/action',
    ]) {
      const r = await call(path);
      expect([401, 500], path).toContain(r.status);
      expect(r.body.error?.message, path).not.toMatch(/No handler for/);
    }
  });
});
