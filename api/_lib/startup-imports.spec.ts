import { expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({ authLoaded: false }));
vi.mock('@afhomes/shared', () => { throw new Error('Startup loaded unrelated shared modules'); });
vi.mock('@afhomes/contracts', () => { throw new Error('Startup loaded unrelated contracts'); });
vi.mock('./rest.js', () => ({
  serviceClient: () => ({ rpc: async () => ({ data: { sales: false }, error: null }) }),
}));
vi.mock('./afhomes-access.js', () => {
  dependencies.authLoaded = true;
  return {
    authorizeAfHomes: async () => ({
      error: { error: { code: 'UNAUTHORIZED', message: 'Sign in' }, status: 401 },
    }),
  };
});

it('serves startup switches without unrelated modules and still authorizes changes', async () => {
  const { routeRequest } = await import('./router.js');
  let status = 0;
  let body: unknown;
  const res = {
    setHeader: vi.fn(),
    status: (code: number) => { status = code; return res; },
    json: (value: unknown) => { body = value; return res; },
  };
  const req = { url: '/api/v1/settings/features', method: 'GET', headers: {}, query: {} };
  expect(await routeRequest(req as never, res as never)).toBe(true);
  expect(status).toBe(200);
  expect(body).toMatchObject({ sales: false });
  expect(dependencies.authLoaded).toBe(false);

  expect(await routeRequest({ ...req, method: 'PUT' } as never, res as never)).toBe(true);
  expect(status).toBe(401);
  expect(dependencies.authLoaded).toBe(true);
});
