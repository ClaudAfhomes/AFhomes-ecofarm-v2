/**
 * AF Homes geographic address lookup - handler tests.
 *
 * The point of these is the boundary: the browser gets AF Homes JSON and never
 * a provider URL, an authorization header, or a provider error body. The real
 * cache and the real permission check run; only the upstream transport and the
 * staff principal resolver are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeReq, makeRes } from '../_lib/testing/supabase-fake.js';
import { AddressProviderError } from '../_lib/address-provider.js';

const upstream = vi.hoisted(() => ({
  provinces: vi.fn(),
  localities: vi.fn(),
  barangays: vi.fn(),
}));

vi.mock('../_lib/psgc-cloud-provider.js', () => ({
  psgcCloudAddressProvider: {
    name: 'psgc-cloud-v2',
    provinces: upstream.provinces,
    localities: upstream.localities,
    barangays: upstream.barangays,
  },
}));

vi.mock('../_lib/afhomes-access.js', () => ({
  authorizeAfHomes: async (
    req: { headers?: Record<string, string> },
    moduleKey?: string,
    action?: string,
  ) => {
    const token = (req.headers?.authorization ?? '').replace(/^Bearer\s*/, '').trim();
    const denied = (status: number, code: string) => ({
      error: {
        error: { code, message: code === 'UNAUTHORIZED' ? 'Missing authentication' : 'Forbidden' },
        status,
      },
    });
    if (!token) return denied(401, 'UNAUTHORIZED');
    if (token.includes('forbidden')) return denied(403, 'FORBIDDEN');
    return { userId: '11111111-1111-4111-8111-111111111111', roleSlug: 'super_admin', moduleKey, action };
  },
}));

const address = (await import('./address.js')).default;
const { resetAddressProviderCache } = await import('../_lib/address-source.js');

const TOKEN = 'staff-token';

const call = async (familyPath: string, token: string | null = TOKEN) => {
  const { res, state } = makeRes();
  await address(makeReq({ familyPath, token: token ?? undefined }), res);
  return { ...state, body: state.body as { data?: { name: string; type?: string }[] } };
};

beforeEach(() => {
  // The lookup cache is a module singleton on purpose; purge it so each test
  // starts cold rather than inheriting the previous test's warm scopes.
  resetAddressProviderCache();
  upstream.provinces.mockReset();
  upstream.localities.mockReset();
  upstream.barangays.mockReset();
  upstream.provinces.mockResolvedValue([{ code: '0403400000', name: 'Laguna' }]);
  upstream.localities.mockResolvedValue([
    { code: '0403406000', name: 'Calauan', type: 'municipality', provinceCode: '0403400000' },
  ]);
  upstream.barangays.mockResolvedValue([
    { code: '0403406003', name: 'Dayap', localityCode: '0403406000' },
  ]);
});

describe('GET /address/provinces', () => {
  it('returns an AF Homes list envelope, not the provider payload', async () => {
    const state = await call('');

    expect(state.status).toBe(200);
    expect(state.body).toEqual({ data: [{ code: '0403400000', name: 'Laguna' }], meta: { total: 1 } });
  });

  it('never exposes a provider URL or a provider field name', async () => {
    const state = await call('');

    expect(JSON.stringify(state.body)).not.toContain('psgc.cloud');
    expect(JSON.stringify(state.body)).not.toContain('region');
  });

  it('refuses an unauthenticated caller', async () => {
    const state = await call('', null);

    expect(state.status).toBe(401);
    expect(upstream.provinces).not.toHaveBeenCalled();
  });

  it('refuses a caller without the permission', async () => {
    const state = await call('', 'forbidden-token');

    expect(state.status).toBe(403);
    expect(upstream.provinces).not.toHaveBeenCalled();
  });

  it('serves a repeated lookup from cache without a second upstream request', async () => {
    await call('');
    await call('');

    expect(upstream.provinces).toHaveBeenCalledTimes(1);
  });
});

describe('GET /address/provinces/:code/localities', () => {
  it('scopes the lookup to the province code in the path', async () => {
    const state = await call('provinces/0403400000/localities');

    expect(state.status).toBe(200);
    expect(upstream.localities).toHaveBeenCalledWith('0403400000');
    expect(state.body?.data).toEqual([
      { code: '0403406000', name: 'Calauan', type: 'municipality', provinceCode: '0403400000' },
    ]);
  });

  it('keeps city and municipality distinguishable in the response', async () => {
    upstream.localities.mockResolvedValue([
      { code: '0403403000', name: 'City of Binan', type: 'city', provinceCode: '0403400000' },
      { code: '0403406000', name: 'Calauan', type: 'municipality', provinceCode: '0403400000' },
    ]);

    const state = await call('provinces/0403400000/localities');

    expect(state.body?.data?.map((l) => l.type)).toEqual([
      'city',
      'municipality',
    ]);
  });

  it('caches localities per province code', async () => {
    await call('provinces/0403400000/localities');
    await call('provinces/0403400000/localities');

    expect(upstream.localities).toHaveBeenCalledTimes(1);
  });

  it('rejects a province NAME where a code belongs', async () => {
    const state = await call('provinces/Laguna/localities');

    expect(state.status).toBe(400);
    expect(upstream.localities).not.toHaveBeenCalled();
  });

  it('reports an unknown province as not found', async () => {
    upstream.localities.mockRejectedValue(new AddressProviderError('PROVIDER_NOT_FOUND'));

    const state = await call('9999999999/localities');

    expect(state.status).toBe(404);
  });
});

describe('GET /address/localities/:code/barangays', () => {
  it('scopes the lookup to the locality code in the path', async () => {
    const state = await call('localities/0403406000/barangays');

    expect(state.status).toBe(200);
    expect(upstream.barangays).toHaveBeenCalledWith('0403406000');
    expect(state.body?.data).toEqual([
      { code: '0403406003', name: 'Dayap', localityCode: '0403406000' },
    ]);
  });

  it('caches barangays per locality code', async () => {
    await call('localities/0403406000/barangays');
    await call('localities/0403406000/barangays');

    expect(upstream.barangays).toHaveBeenCalledTimes(1);
  });

  it('rejects a locality name where a code belongs', async () => {
    const state = await call('localities/Calauan/barangays');

    expect(state.status).toBe(400);
    expect(upstream.barangays).not.toHaveBeenCalled();
  });
});

describe('upstream failures', () => {
  it('reports a provider outage as unavailable without leaking provider detail', async () => {
    upstream.provinces.mockRejectedValue(
      new AddressProviderError('PROVIDER_UNAVAILABLE', 'connect ECONNREFUSED 10.0.0.5:5432'),
    );

    const state = await call('');

    expect(state.status).toBe(503);
    expect(JSON.stringify(state.body)).not.toContain('10.0.0.5');
    expect(JSON.stringify(state.body)).not.toContain('5432');
  });

  it('reports a provider timeout as unavailable', async () => {
    upstream.provinces.mockRejectedValue(new AddressProviderError('PROVIDER_TIMEOUT'));

    expect((await call('')).status).toBe(503);
  });

  it('reports an untrustworthy provider payload as a bad gateway', async () => {
    upstream.provinces.mockRejectedValue(new AddressProviderError('PROVIDER_BAD_RESPONSE'));

    expect((await call('')).status).toBe(502);
  });

  it('does not cache a failed lookup, so a retry can succeed', async () => {
    upstream.provinces.mockRejectedValueOnce(new AddressProviderError('PROVIDER_TIMEOUT'));

    expect((await call('')).status).toBe(503);
    expect((await call('')).status).toBe(200);
    expect(upstream.provinces).toHaveBeenCalledTimes(2);
  });
});

describe('route hygiene', () => {
  it('404s an unrouted sub-path instead of guessing', async () => {
    expect((await call('regions')).status).toBe(404);
  });

  it('rejects a write method on a read-only reference family', async () => {
    const { res, state } = makeRes();
    await address(makeReq({ method: 'POST', familyPath: '', token: TOKEN }), res);

    expect(state.status).toBe(405);
  });
});