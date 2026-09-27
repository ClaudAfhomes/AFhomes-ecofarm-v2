import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown, env: null as unknown }));

vi.mock('../_lib/env.js', () => ({ getSupabaseEnv: () => holder.env }));
vi.mock('../_lib/rest.js', () => ({ serviceClient: () => holder.db }));

const { default: handler } = await import('./health.js');

const CONFIGURED = { url: 'https://project.supabase.co', serviceKey: 'server-only-key' };

function configure(options: { db?: unknown; env?: unknown } = {}) {
  holder.db = 'db' in options ? options.db : new FakeSupabase({ tables: { modules: [{ key: 'dashboard.view' }] } });
  holder.env = 'env' in options ? options.env : CONFIGURED;
}

async function call(method = 'GET') {
  const { res, state } = makeRes();
  await handler(makeReq({ method }) as never, res as never);
  return state;
}

describe('GET /health', () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.VITE_WEB_URL;
    delete process.env.VITE_ADMIN_URL;
    configure();
  });
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('reports 200 and ok when the database answers', async () => {
    const state = await call();
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ ok: true, db: 'ok', service: 'afhomes-api' });
    expect((state.body as { time: string }).time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('reports 503 and ok:false when the database query errors', async () => {
    configure({ db: new FakeSupabase({ errors: { modules: { message: 'boom' } } }) });
    const state = await call();
    expect(state.status).toBe(503);
    expect(state.body).toMatchObject({ ok: false, db: 'error', service: 'afhomes-api' });
  });

  it('reports 503 when the client throws', async () => {
    configure({
      db: {
        from() {
          throw new Error('connection refused');
        },
      },
    });
    const state = await call();
    expect(state.status).toBe(503);
    expect(state.body).toMatchObject({ ok: false, db: 'error' });
  });

  it('reports 503 when no client can be built despite env config', async () => {
    configure({ db: null });
    const state = await call();
    expect(state.status).toBe(503);
    expect(state.body).toMatchObject({ ok: false, db: 'error' });
  });

  it('reports 500 when Supabase is not configured at all', async () => {
    configure({ env: { url: undefined, serviceKey: undefined } });
    const state = await call();
    expect(state.status).toBe(500);
    expect(state.body).toMatchObject({ ok: false, db: 'error', service: 'afhomes-api' });
  });

  it('never leaks credentials, SQL, or environment values', async () => {
    configure({
      db: new FakeSupabase({
        errors: {
          modules: { message: 'connection to host=db.abc.supabase.co user=postgres failed' },
        },
      }),
      env: { url: 'https://project.supabase.co', serviceKey: 'super-secret-service-role-key' },
    });
    const state = await call();
    const serialised = JSON.stringify(state.body);
    expect(state.status).toBe(503);
    expect(serialised).not.toContain('super-secret-service-role-key');
    expect(serialised).not.toMatch(/host=db\.|user=postgres/);
    expect(serialised).not.toMatch(/service_role|sb_secret|eyJ[A-Za-z0-9_-]{10,}/);
    expect(serialised).not.toMatch(/postgres\.supabase\.co/);
  });

  it('always includes the stable monitoring fields', async () => {
    for (const db of [
      new FakeSupabase({ tables: { modules: [] } }),
      new FakeSupabase({ errors: { modules: { message: 'x' } } }),
    ]) {
      configure({ db });
      const state = await call();
      const body = state.body as Record<string, unknown>;
      expect(body).toMatchObject({ db: expect.any(String), ok: expect.any(Boolean), service: 'afhomes-api' });
      expect(typeof body.time).toBe('string');
      expect(typeof body.ok).toBe('boolean');
      expect(['ok', 'error']).toContain(body.db);
      expect(body.service).toBe('afhomes-api');
      if (body.ok === false) {
        expect(body.error).toMatchObject({
          code: 'INTERNAL',
          message: 'Health dependency is unavailable',
          requestId: expect.any(String),
          timestamp: expect.any(String),
        });
      } else {
        expect(body.error).toBeUndefined();
      }
    }
  });

  it('answers CORS preflight without touching the database', async () => {
    const db = { from: vi.fn() };
    configure({ db });
    const { res, state } = makeRes();
    await handler(
      makeReq({ method: 'OPTIONS', headers: { origin: 'http://localhost:5174' } }) as never,
      res as never,
    );
    expect(state.status).toBe(200);
    expect(state.headers['access-control-allow-origin']).toBe('http://localhost:5174');
    expect(db.from).not.toHaveBeenCalled();
  });

  it('sets CORS headers only for known origins', async () => {
    // VITE_WEB_URL is a bare origin; the helper strips only trailing slashes, so
    // a path-bearing VITE_ADMIN_URL matches its own full path, not the origin.
    process.env.VITE_WEB_URL = 'https://afhomes.example';
    const { res, state } = makeRes();
    await handler(makeReq({ headers: { origin: 'https://evil.example' } }) as never, res as never);
    expect(state.headers['access-control-allow-origin']).toBeUndefined();

    const allowed = makeRes();
    await handler(
      makeReq({ headers: { origin: 'https://afhomes.example' } }) as never,
      allowed.res as never,
    );
    expect(allowed.state.headers['access-control-allow-origin']).toBe('https://afhomes.example');
    expect(allowed.state.headers.vary).toBe('Origin');
  });

  it('rejects a non-GET method with 405', async () => {
    const state = await call('POST');
    expect(state.status).toBe(405);
    expect((state.body as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });
});
