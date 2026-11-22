/**
 * Module switches: the public read returns one boolean per module, the save needs
 * governance.config/update, sends only the changed switches to SQL with the
 * session actor, and a storage problem never breaks the read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FEATURE_FLAGS, FEATURE_FLAGS, setFeatureFlags } from '@afhomes/shared';

import { makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const svc = vi.hoisted(() => ({ rpc: vi.fn(), present: true }));
vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => (svc.present ? { rpc: svc.rpc } : null),
}));
vi.mock('../_lib/afhomes-access.js', () => ({
  authorizeAfHomes: async (
    req: { headers?: Record<string, string> },
    moduleKey: string,
    action: string,
  ) => {
    const token = (req.headers?.authorization ?? '').replace(/^Bearer\s*/, '');
    if (!token) return { error: { error: { code: 'UNAUTHORIZED', message: 'x' }, status: 401 } };
    if (token === 'no-config' || moduleKey !== 'governance.config' || action !== 'update')
      return { error: { error: { code: 'FORBIDDEN', message: 'x' }, status: 403 } };
    return { userId: '11111111-1111-4111-8111-111111111111', roleSlug: 'admin' };
  },
}));

const handler = (await import('./settings.js')).default;
const { invalidateFeatureFlags } = await import('../_lib/feature-flags.js');

const run = async (opts: Parameters<typeof makeReq>[0]) => {
  const res = makeRes();
  await handler(makeReq({ familyPath: 'features', ...opts }) as never, res.res as never);
  return res.state;
};

beforeEach(() => {
  svc.present = true;
  svc.rpc.mockReset();
  invalidateFeatureFlags();
});
afterEach(() => setFeatureFlags(DEFAULT_FEATURE_FLAGS));

describe('GET settings/features', () => {
  it('returns the stored switches and nothing else', async () => {
    svc.rpc.mockResolvedValue({
      data: { services: false, redemption: true, bogus: false },
      error: null,
    });
    const state = await run({});
    expect(state.status).toBe(200);
    // Keys the store does not return (e.g. before migration 26) keep their default ON;
    // unknown stored keys are never echoed.
    expect(state.body).toEqual({ ...DEFAULT_FEATURE_FLAGS, services: false });
  });

  it('keeps the defaults when the store is missing or unreadable', async () => {
    svc.rpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } });
    const state = await run({});
    expect(state.status).toBe(200);
    expect(state.body).toEqual({ ...DEFAULT_FEATURE_FLAGS });
  });
});

describe('PUT settings/features', () => {
  it('requires a session and governance.config update', async () => {
    expect((await run({ method: 'PUT', body: { cms: false } })).status).toBe(401);
    expect((await run({ method: 'PUT', token: 'no-config', body: { cms: false } })).status).toBe(
      403,
    );
    expect(svc.rpc).not.toHaveBeenCalled();
  });

  it('refuses an empty or unknown change before SQL runs', async () => {
    expect((await run({ method: 'PUT', token: 't', body: {} })).status).toBe(400);
    expect((await run({ method: 'PUT', token: 't', body: { audit: false } })).status).toBe(400);
    expect((await run({ method: 'PUT', token: 't', body: { organization: false } })).status).toBe(
      400,
    );
    expect((await run({ method: 'PUT', token: 't', body: { cms: 'off' } })).status).toBe(400);
    expect(svc.rpc).not.toHaveBeenCalled();
  });

  it('sends only the changed switches with the session actor and applies the result', async () => {
    svc.rpc.mockResolvedValue({
      data: { services: true, redemption: true, reports: true, cms: false },
      error: null,
    });
    const state = await run({ method: 'PUT', token: 't', body: { cms: false } });
    expect(state.status).toBe(200);
    expect(svc.rpc).toHaveBeenCalledWith('update_feature_flags', {
      p_actor: '11111111-1111-4111-8111-111111111111',
      p_input: { cms: false },
    });
    expect(FEATURE_FLAGS.cms).toBe(false);
  });

  it('maps a SQL permission refusal to 403', async () => {
    svc.rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'MUTATION_FORBIDDEN' },
    });
    expect((await run({ method: 'PUT', token: 't', body: { cms: false } })).status).toBe(403);
  });
});
