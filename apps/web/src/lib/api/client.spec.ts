import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const auth = vi.hoisted(() => ({ getSession: vi.fn(), refresh: vi.fn(), clear: vi.fn() }));
vi.mock('../supabase', () => ({
  getSupabaseClient: () => ({ auth: { getSession: auth.getSession } }),
  isSupabaseConfigured: () => true,
  tryRefreshSession: auth.refresh,
  clearSession: auth.clear,
}));
import { request } from './client';

const schema = z.object({ ok: z.literal(true) });
const response = (status = 200) => new Response(JSON.stringify({ ok: true }), { status });
beforeEach(() => {
  vi.clearAllMocks();
  auth.getSession.mockResolvedValue({ data: { session: { access_token: 'customer-token' } } });
  auth.refresh.mockResolvedValue(true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('customer request lifecycle', () => {
  it.each(['session', 'fetch', 'body'])(
    'bounds a stalled %s without replaying a POST',
    async (stage) => {
      vi.useFakeTimers();
      const pending = () => new Promise<never>(() => {});
      if (stage === 'session') auth.getSession.mockImplementation(pending);
      const fetchMock = vi.fn().mockImplementation(
        stage === 'fetch'
          ? pending
          : async () => {
              const res = response();
              if (stage === 'body') vi.spyOn(res, 'text').mockImplementation(pending);
              return res;
            },
      );
      vi.stubGlobal('fetch', fetchMock);
      const rejected = expect(
        request('/customer', schema, { method: 'POST' }),
      ).rejects.toMatchObject({
        name: 'ApiNetworkError',
        message: expect.stringContaining('timed out'),
      });
      await vi.advanceTimersByTimeAsync(60_001);
      await rejected;
      expect(fetchMock).toHaveBeenCalledTimes(stage === 'session' ? 0 : 1);
      expect(auth.refresh).not.toHaveBeenCalled();
      expect(auth.clear).not.toHaveBeenCalled();
    },
  );

  it('preserves one authenticated 401 recovery', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response());
    vi.stubGlobal('fetch', fetchMock);
    await expect(request('/customer', schema)).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({
      headers: { Authorization: 'Bearer customer-token' },
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not send a pre-cancelled request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();
    await expect(request('/customer', schema, { signal: controller.signal })).rejects.toMatchObject(
      { name: 'AbortError' },
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(auth.getSession).not.toHaveBeenCalled();
  });
});
