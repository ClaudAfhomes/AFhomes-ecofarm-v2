import { describe, expect, it, vi } from 'vitest';

import {
  AddressProviderError,
  createCachedAddressProvider,
  verifyAddressHierarchy,
  type AddressProvider,
} from './address-provider.js';

/**
 * A real, in-memory provider over a small verified PSGC slice. The hierarchy
 * checks only mean something if the fixture actually has parent/child links.
 */
const LAGUNA = { code: '0403400000', name: 'Laguna' };
const CALAUAN = {
  code: '0403406000',
  name: 'Calauan',
  type: 'municipality' as const,
  provinceCode: LAGUNA.code,
};
const DAYAP = { code: '0403406003', name: 'Dayap', localityCode: CALAUAN.code };
const BATANGAS = { code: '0406100000', name: 'Batangas' };
const LEMERY = {
  code: '0406110000',
  name: 'Lemery',
  type: 'municipality' as const,
  provinceCode: BATANGAS.code,
};

function fakeProvider(): AddressProvider {
  return {
    name: 'fake',
    provinces: async () => [LAGUNA, BATANGAS],
    localities: async (code) => (code === LAGUNA.code ? [CALAUAN] : code === BATANGAS.code ? [LEMERY] : []),
    barangays: async (code) => (code === CALAUAN.code ? [DAYAP] : []),
  };
}

describe('verifyAddressHierarchy', () => {
  it('accepts a consistent province -> locality -> barangay triple', async () => {
    const result = await verifyAddressHierarchy(fakeProvider(), {
      provinceCode: LAGUNA.code,
      localityCode: CALAUAN.code,
      barangayCode: DAYAP.code,
    });

    expect(result.valid).toBe(true);
    expect(result.valid && result.hierarchy.locality.name).toBe('Calauan');
  });

  it('rejects a province code that does not exist', async () => {
    const result = await verifyAddressHierarchy(fakeProvider(), {
      provinceCode: '9999999999',
      localityCode: CALAUAN.code,
      barangayCode: DAYAP.code,
    });

    expect(result).toEqual({ valid: false, reason: 'INVALID_PROVINCE' });
  });

  it('rejects a municipality belonging to a different province', async () => {
    // Batangas province + Calauan (a Laguna municipality): the exact mismatch
    // a hand-crafted request body would send.
    const result = await verifyAddressHierarchy(fakeProvider(), {
      provinceCode: BATANGAS.code,
      localityCode: CALAUAN.code,
      barangayCode: DAYAP.code,
    });

    expect(result).toEqual({ valid: false, reason: 'LOCALITY_NOT_IN_PROVINCE' });
  });

  it('rejects a barangay belonging to a different locality', async () => {
    const result = await verifyAddressHierarchy(fakeProvider(), {
      provinceCode: LAGUNA.code,
      localityCode: CALAUAN.code,
      barangayCode: '0406100001',
    });

    expect(result).toEqual({ valid: false, reason: 'BARANGAY_NOT_IN_LOCALITY' });
  });

  it('rejects a hierarchy whose province lookup is broken, as an outage not a verdict', async () => {
    const broken: AddressProvider = {
      ...fakeProvider(),
      provinces: async () => {
        throw new AddressProviderError('PROVIDER_TIMEOUT');
      },
    };

    const result = await verifyAddressHierarchy(broken, {
      provinceCode: LAGUNA.code,
      localityCode: CALAUAN.code,
      barangayCode: DAYAP.code,
    });

    expect(result).toEqual({ valid: false, reason: 'PROVIDER_UNAVAILABLE' });
  });

  it('never asks for children of a province it has already rejected', async () => {
    const localities = vi.fn().mockResolvedValue([CALAUAN]);
    const provider: AddressProvider = {
      ...fakeProvider(),
      provinces: async () => [LAGUNA],
      localities,
    };

    await verifyAddressHierarchy(provider, {
      provinceCode: '9999999999',
      localityCode: CALAUAN.code,
      barangayCode: DAYAP.code,
    });

    expect(localities).not.toHaveBeenCalled();
  });
});

describe('createCachedAddressProvider', () => {
  it('calls the provider once for repeated provinces lookups', async () => {
    const provinces = vi.fn().mockResolvedValue([LAGUNA]);
    const cached = createCachedAddressProvider({ ...fakeProvider(), provinces });

    await cached.provinces();
    await cached.provinces();
    await cached.provinces();

    expect(provinces).toHaveBeenCalledTimes(1);
  });

  it('caches localities per province code, not globally', async () => {
    const localities = vi.fn(async (code: string) =>
      code === LAGUNA.code ? [CALAUAN] : [LEMERY],
    );
    const cached = createCachedAddressProvider({ ...fakeProvider(), localities });

    await cached.localities(LAGUNA.code);
    await cached.localities(LAGUNA.code);
    await cached.localities(BATANGAS.code);

    // Two distinct scopes, two calls - the second Laguna lookup was a hit.
    expect(localities).toHaveBeenCalledTimes(2);
  });

  it('caches barangays per locality code', async () => {
    const barangays = vi.fn(async () => [DAYAP]);
    const cached = createCachedAddressProvider({ ...fakeProvider(), barangays });

    await cached.barangays(CALAUAN.code);
    await cached.barangays(CALAUAN.code);
    await cached.barangays('0406110000');

    expect(barangays).toHaveBeenCalledTimes(2);
  });

  it('collapses concurrent requests for one scope into a single provider call', async () => {
    // The request-storm guard: a user typing quickly across two holders must not
    // open one upstream request per keystroke.
    let resolve!: (v: typeof LAGUNA[]) => void;
    const provinces = vi.fn(() => new Promise<typeof LAGUNA[]>((r) => (resolve = r)));
    const cached = createCachedAddressProvider({ ...fakeProvider(), provinces });

    const all = Promise.all([cached.provinces(), cached.provinces(), cached.provinces()]);
    resolve([LAGUNA]);
    await all;

    expect(provinces).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed lookup, so a retry can succeed', async () => {
    const provinces = vi
      .fn()
      .mockRejectedValueOnce(new AddressProviderError('PROVIDER_TIMEOUT'))
      .mockResolvedValue([LAGUNA]);
    const cached = createCachedAddressProvider({ ...fakeProvider(), provinces });

    await expect(cached.provinces()).rejects.toBeInstanceOf(AddressProviderError);
    await expect(cached.provinces()).resolves.toEqual([LAGUNA]);
    expect(provinces).toHaveBeenCalledTimes(2);
  });

  it('re-fetches once the TTL has passed', async () => {
    const provinces = vi.fn().mockResolvedValue([LAGUNA]);
    const cached = createCachedAddressProvider({ ...fakeProvider(), provinces }, 0);

    await cached.provinces();
    await cached.provinces();

    expect(provinces).toHaveBeenCalledTimes(2);
  });

  it('caches only reference data - a cache hit is the same array, not shared state', async () => {
    const cached = createCachedAddressProvider(fakeProvider());
    const first = await cached.provinces();
    const second = await cached.provinces();

    // Same scope => same value. A caller mutating its copy must not be able to
    // reach into what the next caller receives.
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it('re-fetches every scope after a purge, so a quarterly refresh can land', async () => {
    const provinces = vi.fn().mockResolvedValue([LAGUNA]);
    const cached = createCachedAddressProvider({ ...fakeProvider(), provinces });

    await cached.provinces();
    cached.clear();
    await cached.provinces();

    expect(provinces).toHaveBeenCalledTimes(2);
  });
});