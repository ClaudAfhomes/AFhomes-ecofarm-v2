import { afterEach, describe, expect, it, vi } from 'vitest';

import { AddressProviderError } from './address-provider.js';
import { psgcCloudAddressProvider } from './psgc-cloud-provider.js';

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