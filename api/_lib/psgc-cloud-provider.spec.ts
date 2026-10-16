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
  it('offers province-less NCR and confirms other unmatched regions before offering them', async () => {
    stubFetch((url) => {
      if (url.endsWith('/provinces/')) throw new Error('Unexpected path');
      if (url.endsWith('/regions/1300000000/provinces')) return json({ data: [] });
      if (url.endsWith('/regions/0400000000/provinces'))
        return json({ data: [{ code: '0403400000', name: 'Laguna' }] });
      if (url.endsWith('/regions'))
        return json({
          data: [
            { code: '1300000000', name: 'National Capital Region' },
            { code: '0400000000', name: 'Different regional spelling' },
          ],
        });
      return json({ data: [{ code: '0403400000', name: 'Laguna', region: 'CALABARZON' }] });
    });
    expect(await psgcCloudAddressProvider.provinces()).toEqual([
      { code: '0403400000', name: 'Laguna' },
      { code: '1300000000', name: 'Metro Manila' },
    ]);
  });

  it('normalizes the provider payload to { code, name }', async () => {
    stubFetch((url) =>
      json({
        data: url.endsWith('/regions')
          ? []
          : [
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
    stubFetch((url) =>
      json({ data: url.endsWith('/regions') ? [] : [{ code: '0403400000', name: 'Laguna' }] }),
    );
    expect((await psgcCloudAddressProvider.provinces())[0]?.name).toBe('Laguna');
  });

  it('never sends a query string, because the provider ignores query filters', async () => {
    const seen: string[] = [];
    stubFetch((url) => {
      seen.push(url);
      return json({ data: [] });
    });

    await psgcCloudAddressProvider.provinces();
    for (const url of seen) expect(url).not.toContain('?');
  });

  // NCR nests no provinces, so `/provinces` cannot name it and every Metro
  // Manila address was unenterable until the region stood in for one.
  it('offers Metro Manila, the one region that nests no provinces', async () => {
    stubFetch((url) => {
      if (url.endsWith('/regions/1300000000/provinces')) return json({ data: [] });
      if (url.endsWith('/regions')) {
        return json({
          data: [
            { code: '0400000000', name: 'Region IV-A (CALABARZON)' },
            { code: '1300000000', name: 'National Capital Region (NCR)' },
          ],
        });
      }
      return json({
        data: [{ code: '0403400000', name: 'Laguna', region: 'Region IV-A (CALABARZON)' }],
      });
    });

    expect(await psgcCloudAddressProvider.provinces()).toEqual([
      { code: '0403400000', name: 'Laguna' },
      { code: '1300000000', name: 'Metro Manila' },
    ]);
  });

  // A region whose name merely failed to match a province's `region` string
  // must never be smuggled into a list of provinces.
  it('refuses to offer a region that does nest provinces', async () => {
    stubFetch((url) => {
      if (url.endsWith('/regions/0400000000/provinces')) {
        return json({
          data: [{ code: '0403400000', name: 'Laguna', region: 'Region IV-A (CALABARZON)' }],
        });
      }
      if (url.endsWith('/regions')) {
        return json({ data: [{ code: '0400000000', name: 'CALABARZON' }] });
      }
      return json({
        data: [{ code: '0403400000', name: 'Laguna', region: 'Region IV-A (CALABARZON)' }],
      });
    });

    expect(await psgcCloudAddressProvider.provinces()).toEqual([
      { code: '0403400000', name: 'Laguna' },
    ]);
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
      {
        code: '0403406000',
        name: 'Calauan',
        type: 'municipality',
        provinceCode: '0403400000',
        postalCode: '4012',
      },
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

  it('skips districts and special units while retaining real municipalities', async () => {
    stubFetch(() =>
      json({
        data: [
          { code: '1380600000', name: 'District', type: 'SubMun' },
          { code: '1900000000', name: 'Special unit', type: 'SGU' },
          { code: '0403406000', name: 'Calauan', type: 'Mun', province: 'Laguna' },
        ],
      }),
    );
    expect(
      (await psgcCloudAddressProvider.localities('0403400000')).map((row) => row.name),
    ).toEqual(['Calauan']);
  });

  it('falls back to the NCR region path and holds ambiguous city ZIPs', async () => {
    const seen: string[] = [];
    stubFetch((url) => {
      seen.push(url);
      if (url.includes('/provinces/')) return json({}, 404);
      return json({
        data: [
          { code: '1381400000', name: 'City of San Juan', type: 'City', zip_code: '9999' },
          { code: '1380600000', name: 'City of Manila', type: 'City', zip_code: '1000' },
        ],
      });
    });
    const result = await psgcCloudAddressProvider.localities('1300000000');
    expect(seen).toEqual([
      'https://psgc.cloud/api/v2/provinces/1300000000/cities-municipalities',
      'https://psgc.cloud/api/v2/regions/1300000000/cities-municipalities',
    ]);
    expect(result[0]).toMatchObject({ provinceCode: '1300000000' });
    expect(result[0]).not.toHaveProperty('postalCode');
    expect(result[1]).not.toHaveProperty('postalCode');
  });

  it('keeps the corrected Victoria ZIP even when upstream publishes the wrong code', async () => {
    stubFetch(() =>
      json({
        data: [
          {
            code: '0403429000',
            name: 'Victoria',
            type: 'Mun',
            province: 'Laguna',
            zip_code: '4018',
          },
        ],
      }),
    );
    expect((await psgcCloudAddressProvider.localities('0403400000'))[0]?.postalCode).toBe('4011');
  });

  it('does not fall back to a region when the provider fails', async () => {
    const fetcher = vi.fn(() => json({}, 500));
    vi.stubGlobal('fetch', fetcher);
    await expect(psgcCloudAddressProvider.localities('1300000000')).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  // Sarangani's list carried Manila's `SubMun` districts and Maguindanao del
  // Sur's carried BARMM `SGU`s; one unmapped row used to fail the whole
  // province, leaving both with no city to choose at all.
  it('skips a district or special unit instead of failing the whole province', async () => {
    stubFetch(() =>
      json({
        data: [
          { code: '0403406000', name: 'Calauan', type: 'Mun' },
          { code: '1380601000', name: 'Tondo I/II', type: 'SubMun' },
          { code: '1999901000', name: 'Pikit Cluster I', type: 'SGU' },
          { code: '0403403000', name: 'City of Binan', type: 'City' },
        ],
      }),
    );

    expect(await psgcCloudAddressProvider.localities('0403400000')).toEqual([
      { code: '0403406000', name: 'Calauan', type: 'municipality', provinceCode: '0403400000' },
      { code: '0403403000', name: 'City of Binan', type: 'city', provinceCode: '0403400000' },
    ]);
  });

  // A province-less region has no `/provinces/{code}/...` path at all.
  it('reads a region scope\u2019s cities from the region path', async () => {
    const seen: string[] = [];
    stubFetch((url) => {
      seen.push(url);
      if (url.includes('/provinces/1300000000/'))
        return json({ message: 'Province not found' }, 404);
      return json({
        data: [{ code: '1380600000', name: 'City of Manila', type: 'City', province: 'Sarangani' }],
      });
    });

    // PSGC mis-parents every NCR row under "Sarangani"; the scope we asked for
    // is the only trustworthy parent, and it has to win.
    expect(await psgcCloudAddressProvider.localities('1300000000')).toEqual([
      { code: '1380600000', name: 'City of Manila', type: 'city', provinceCode: '1300000000' },
    ]);
    expect(seen[0]).toContain('/provinces/1300000000/cities-municipalities');
    expect(seen[1]).toContain('/regions/1300000000/cities-municipalities');
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

    const error = await psgcCloudAddressProvider.provinces().catch((e: AddressProviderError) => e);
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
