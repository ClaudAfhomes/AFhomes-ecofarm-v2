import { afterEach, describe, expect, it, vi } from 'vitest';

import { AddressProviderError } from './address-provider.js';
import { psgcCloudAddressProvider, repairMojibake } from './psgc-cloud-provider.js';

/** Real `Response` objects - only the transport is stubbed, never the parser. */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const stubFetch = (impl: (url: string) => Promise<Response> | Response) =>
  vi.stubGlobal('fetch', vi.fn(impl));

afterEach(() => vi.unstubAllGlobals());

describe('psgcCloudAddressProvider.provinces', () => {
  it('normalizes the provider payload to { code, name }', async () => {
    stubFetch(() =>
      json({
        data: [
          { code: '0403400000', name: 'Laguna', region: 'Region IV-A (CALABARZON)' },
          { code: '0102800000', name: 'Ilocos Norte', region: 'Region I (Ilocos Region)' },
        ],
      }),
    );

    expect(await psgcCloudAddressProvider.provinces()).toEqual([
      { code: '0403400000', name: 'Laguna' },
      { code: '0102800000', name: 'Ilocos Norte' },
    ]);
  });

  it('keeps the provider name verbatim rather than upper-casing it', async () => {
    stubFetch(() => json({ data: [{ code: '0403400000', name: 'Laguna' }] }));
    expect((await psgcCloudAddressProvider.provinces())[0]?.name).toBe('Laguna');
  });

  it('never sends a query string, because the provider ignores query filters', async () => {
    const seen: string[] = [];
    stubFetch((url) => {
      seen.push(url);
      return json({ data: [] });
    });

    await psgcCloudAddressProvider.provinces();
    expect(seen[0]).not.toContain('?');
  });
});

describe('psgcCloudAddressProvider.localities', () => {
  it('scopes the request to the province with the nested, ancestry-checked path', async () => {
    const seen: string[] = [];
    stubFetch((url) => {
      seen.push(url);
      return json({ data: [] });
    });

    await psgcCloudAddressProvider.localities('0403400000');

    expect(seen[0]).toContain('/provinces/0403400000/cities-municipalities');
    // The query-filter form returns EVERY province's rows, silently.
    expect(seen[0]).not.toContain('province_code=');
  });

  it('stamps the requested province code, which the provider never returns', async () => {
    stubFetch(() =>
      json({ data: [{ code: '0403406000', name: 'Calauan', type: 'Mun', province: 'Laguna' }] }),
    );

    expect(await psgcCloudAddressProvider.localities('0403400000')).toEqual([
      { code: '0403406000', name: 'Calauan', type: 'municipality', provinceCode: '0403400000' },
    ]);
  });

  it('keeps a city distinct from a municipality', async () => {
    stubFetch(() =>
      json({
        data: [
          { code: '0403403000', name: 'City of Binan', type: 'City' },
          { code: '0403406000', name: 'Calauan', type: 'Mun' },
        ],
      }),
    );

    const types = (await psgcCloudAddressProvider.localities('0403400000')).map((l) => l.type);
    expect(types).toEqual(['city', 'municipality']);
  });

  it('rejects a locality whose type is neither city nor municipality', async () => {
    stubFetch(() => json({ data: [{ code: '0403406000', name: 'Calauan', type: 'Barangay' }] }));

    await expect(psgcCloudAddressProvider.localities('0403400000')).rejects.toMatchObject({
      code: 'PROVIDER_BAD_RESPONSE',
    });
  });
});

describe('psgcCloudAddressProvider.barangays', () => {
  it('scopes the request to the locality and records the parent code', async () => {
    const seen: string[] = [];
    stubFetch((url) => {
      seen.push(url);
      return json({ data: [{ code: '0403406003', name: 'Dayap' }] });
    });

    expect(await psgcCloudAddressProvider.barangays('0403406000')).toEqual([
      { code: '0403406003', name: 'Dayap', localityCode: '0403406000' },
    ]);
    expect(seen[0]).toContain('/cities-municipalities/0403406000/barangays');
  });
});

describe('repairMojibake', () => {
  // The service decodes UTF-8 bytes as Latin-1, so a published `n` with tilde
  // arrives as U+00C3 U+00B1. These are the exact strings observed live.
  it('recovers a name whose UTF-8 was decoded as Latin-1', () => {
    expect(repairMojibake('City of BiÃ±an')).toBe('City of Biñan');
    expect(repairMojibake('Los BaÃ±os')).toBe('Los Baños');
  });

  it('recovers a three-byte sequence, not just two', () => {
    // U+20AC EURO SIGN is E2 82 AC; decoded as Latin-1 that is "â\x82¬".
    expect(repairMojibake('Price â\x82¬')).toBe('Price €');
  });

  it('leaves a correctly-encoded name completely alone', () => {
    expect(repairMojibake('Biñan')).toBe('Biñan');
    expect(repairMojibake('Baños')).toBe('Baños');
  });

  it('leaves plain ASCII alone', () => {
    expect(repairMojibake('Calauan')).toBe('Calauan');
  });

  it('leaves text outside Latin-1 alone', () => {
    // It cannot have come from UTF-8 read as Latin-1, so touching it would be a guess.
    expect(repairMojibake('Calamba 日本')).toBe('Calamba 日本');
  });

  it('is idempotent', () => {
    expect(repairMojibake(repairMojibake('City of BiÃ±an'))).toBe('City of Biñan');
  });

  it('never throws, whatever it is handed', () => {
    for (const value of ['', 'Ã', 'ÃÃ', '\u0080', 'Ã±Ã±', 'a'.repeat(500)]) {
      expect(() => repairMojibake(value)).not.toThrow();
    }
  });
});

describe('psgcCloudAddressProvider name encoding', () => {
  it('stores the repaired official spelling, not the mangled bytes', async () => {
    stubFetch(() =>
      json({
        data: [
          { code: '0403403000', name: 'City of BiÃ±an', type: 'City' },
          { code: '0403405000', name: 'Los BaÃ±os', type: 'City' },
        ],
      }),
    );

    expect(await psgcCloudAddressProvider.localities('0403400000')).toEqual([
      { code: '0403403000', name: 'City of Biñan', type: 'city', provinceCode: '0403400000' },
      { code: '0403405000', name: 'Los Baños', type: 'city', provinceCode: '0403400000' },
    ]);
  });

  it('repairs barangay names too', async () => {
    stubFetch(() => json({ data: [{ code: '0403406003', name: 'NiÃ±og' }] }));

    expect((await psgcCloudAddressProvider.barangays('0403406000'))[0]?.name).toBe('Niñog');
  });

  it('leaves a correctly-encoded name byte-identical through the adapter', async () => {
    stubFetch(() => json({ data: [{ code: '0403403000', name: 'Biñan' }] }));

    expect((await psgcCloudAddressProvider.provinces())[0]?.name).toBe('Biñan');
  });
});

describe('psgcCloudAddressProvider failure modes', () => {
  it('reports a provider timeout as a controlled error, not an exception', async () => {
    stubFetch(() => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    });

    const error = await psgcCloudAddressProvider
      .provinces()
      .catch((e: AddressProviderError) => e);
    expect(error).toBeInstanceOf(AddressProviderError);
    expect((error as AddressProviderError).code).toBe('PROVIDER_TIMEOUT');
  });

  it('reports a server-side provider failure as unavailable', async () => {
    stubFetch(() => json({ message: 'boom' }, 500));

    await expect(psgcCloudAddressProvider.provinces()).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
  });

  it('reports an unknown code as not found rather than as an outage', async () => {
    stubFetch(() => json({ message: 'Province not found' }, 404));

    await expect(psgcCloudAddressProvider.localities('9999999999')).rejects.toMatchObject({
      code: 'PROVIDER_NOT_FOUND',
    });
  });

  it('fails safe on a payload that is not an array', async () => {
    stubFetch(() => json({ data: 'not-an-array' }));

    await expect(psgcCloudAddressProvider.provinces()).rejects.toMatchObject({
      code: 'PROVIDER_BAD_RESPONSE',
    });
  });

  it('fails safe when a row is missing its code or name', async () => {
    stubFetch(() => json({ data: [{ name: 'Laguna' }] }));

    await expect(psgcCloudAddressProvider.provinces()).rejects.toMatchObject({
      code: 'PROVIDER_BAD_RESPONSE',
    });
  });

  it('fails safe when the body is not JSON at all', async () => {
    stubFetch(() => new Response('<html>maintenance</html>', { status: 200 }));

    await expect(psgcCloudAddressProvider.provinces()).rejects.toMatchObject({
      code: 'PROVIDER_BAD_RESPONSE',
    });
  });

  it('never leaks the provider response body into the error message', async () => {
    stubFetch(() => json({ message: 'internal db name pg_reference' }, 500));

    const error = (await psgcCloudAddressProvider
      .provinces()
      .catch((e: AddressProviderError) => e)) as AddressProviderError;
    expect(error.message).not.toContain('pg_reference');
  });
});