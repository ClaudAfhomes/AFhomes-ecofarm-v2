import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { request } from './client';

const supabaseStubs = vi.hoisted(() => ({
  configured: false,
  refreshResult: false,
  signOutCalls: 0,
  refreshCalls: 0,
  token: null as string | null,
}));

vi.mock('../supabase', () => ({
  isSupabaseConfigured: () => supabaseStubs.configured,
  getSupabaseClient: () => ({
    auth: {
      getSession: async () => ({
        data: {
          session: supabaseStubs.token ? { access_token: supabaseStubs.token } : null,
        },
      }),
    },
  }),
  tryRefreshSession: async () => {
    supabaseStubs.refreshCalls += 1;
    return supabaseStubs.refreshResult;
  },
  clearSession: async () => {
    supabaseStubs.signOutCalls += 1;
  },
}));

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const unauthorized = () =>
  jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Invalid session' } }, 401);

describe('rawRequest 401 recovery', () => {
  beforeEach(() => {
    supabaseStubs.configured = false;
    supabaseStubs.refreshResult = false;
    supabaseStubs.signOutCalls = 0;
    supabaseStubs.refreshCalls = 0;
    supabaseStubs.token = null;
    vi.unstubAllGlobals();
  });

  it('attaches the Bearer token when Supabase is configured', async () => {
    supabaseStubs.configured = true;
    supabaseStubs.token = 'tok-abc';
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }, 200));
    vi.stubGlobal('fetch', fetchMock);
    await expect(request('/me/wallet', z.object({ ok: z.literal(true) }))).resolves.toEqual({
      ok: true,
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/me/wallet');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok-abc' });
  });

  it('passes non-401 responses through without touching auth', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }, 200));
    vi.stubGlobal('fetch', fetchMock);
    await expect(request('/ping', z.object({ ok: z.literal(true) }))).resolves.toEqual({
      ok: true,
    });
    expect(supabaseStubs.refreshCalls).toBe(0);
    expect(supabaseStubs.signOutCalls).toBe(0);
  });

  it('ignores 401s when Supabase is not configured', async () => {
    const fetchMock = vi.fn(async () => unauthorized());
    vi.stubGlobal('fetch', fetchMock);
    await expect(request('/me/wallet', z.object({}))).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(supabaseStubs.refreshCalls).toBe(0);
  });

  it('retries once after a successful rotation without signing out', async () => {
    supabaseStubs.configured = true;
    supabaseStubs.refreshResult = true;
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));
    vi.stubGlobal('fetch', fetchMock);
    await expect(request('/ping', z.object({ ok: z.literal(true) }))).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(supabaseStubs.refreshCalls).toBe(1);
    expect(supabaseStubs.signOutCalls).toBe(0);
  });

  it('clears the session when rotation fails so guards redirect to login', async () => {
    supabaseStubs.configured = true;
    supabaseStubs.refreshResult = false;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn(async () => unauthorized());
    vi.stubGlobal('fetch', fetchMock);
    await expect(request('/me/wallet', z.object({}))).rejects.toMatchObject({ status: 401 });
    expect(supabaseStubs.refreshCalls).toBe(1);
    expect(supabaseStubs.signOutCalls).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('session rotation failed'));
    warn.mockRestore();
  });

  it('never retries more than once', async () => {
    supabaseStubs.configured = true;
    supabaseStubs.refreshResult = true;
    const fetchMock = vi.fn(async () => unauthorized());
    vi.stubGlobal('fetch', fetchMock);
    await expect(request('/me/wallet', z.object({}))).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(supabaseStubs.refreshCalls).toBe(1);
  });
});
