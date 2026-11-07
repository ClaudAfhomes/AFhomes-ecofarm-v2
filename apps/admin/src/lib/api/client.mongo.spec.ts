import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
vi.mock('../cookie-auth', () => ({ isMongoAuth: true }));
vi.mock('../supabase', () => ({
  getSupabaseClient: vi.fn(() => {
    throw new Error('Mongo mode must not contact Supabase');
  }),
  isSupabaseConfigured: () => true,
  tryRefreshSession: vi.fn(),
  clearSession: vi.fn(),
}));
import { protectedRequest } from './client';
afterEach(() => vi.unstubAllGlobals());
it.each([undefined, { reason: 'CURRENT_PASSWORD_INVALID' }])(
  'preserves an incorrect-current-password error instead of falsely expiring a valid cookie session (%j)',
  async (details) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: 'UNAUTHORIZED',
                message: 'Current password is incorrect',
                details,
              },
            }),
            { status: 401 },
          ),
      ),
    );
    await expect(
      protectedRequest('/admin/afhomes/session/password', z.object({ changed: z.boolean() }), {
        method: 'POST',
        body: '{}',
      }),
    ).rejects.toMatchObject({ status: 401, message: 'Current password is incorrect' });
  },
);
it('continues to reject expired sessions without a token or Supabase refresh fallback', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Invalid session' } }),
          { status: 401 },
        ),
    ),
  );
  await expect(protectedRequest('/customers', z.object({}))).rejects.toMatchObject({
    status: 401,
    message: 'Your session has expired. Please sign in again.',
  });
});
