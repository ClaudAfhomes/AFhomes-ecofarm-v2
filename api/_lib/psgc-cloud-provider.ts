/**
 * PSGC Cloud v2 adapter.
 *
 * This is the ONLY module that knows PSGC Cloud's URLs and field names. Verified
 * against the live service on 2026-10-16:
 *
 *   GET /provinces                              -> { data: [{ code, name, region }] }
 *   GET /regions                                -> { data: [{ code, name }] }
 *   GET /regions/{code}/provinces               -> { data: [{ code, name, region }] }
 *   GET /provinces/{code}/cities-municipalities  -> { data: [{ code, name, type, ... }] }
 *   GET /regions/{code}/cities-municipalities    -> { data: [{ code, name, type, ... }] }
 *   GET /cities-municipalities/{code}/barangays  -> { data: [{ code, name, ... }] }
 *
 * Metro Manila is reachable ONLY through the region paths: the National Capital
 * Region has no provinces, so it is absent from `/provinces` and
 * `/provinces/1300000000/cities-municipalities` answers 404.
 *
 * Codes are 10 digits at every level. Names are the authority's own spelling and
 * are never re-cased, trimmed of meaning, or "tidied". The ONE thing this module
 * does to a name is undo the service's encoding damage - see `repairMojibake` -
 * because that damage is a lost byte sequence, not a different spelling.
 *
 * ONE HARD-WON RULE: the query-filter form (`?province_code=`) is accepted by
 * the service and SILENTLY IGNORED - it returns every province's rows. Only the
 * nested paths filter. Nothing here may grow a query string.
 */
import {
  barangaySchema,
  localitySchema,
  provinceSchema,
  type Barangay,
  type Locality,
  type Province,
} from '@afhomes/contracts';

import { AddressProviderError, type AddressProvider } from './address-provider.js';

const PSGC_CLOUD_BASE = 'https://psgc.cloud/api/v2';

/** Reference data is static; anything slower than this is a broken upstream. */
const REQUEST_TIMEOUT_MS = 8_000;

/**
 * The service reports city vs municipality as `City` / `Mun`. It also emits
 * `SubMun` (a sub-municipality - the districts of the City of Manila, which
 * PSGC additionally mis-parents under other provinces) and `SGU` (a BARMM
 * special geographic unit). Neither is a city or municipality, so neither is
 * offered here.
 *
 * Mapping exactly these two strings keeps a district from being stored as a
 * municipality. An unmapped row is SKIPPED rather than fatal: one such row used
 * to fail the whole province, which left Sarangani and Maguindanao del Sur with
 * no cities to choose from at all.
 */
const LOCALITY_TYPE_BY_PROVIDER: Record<string, 'city' | 'municipality'> = {
  City: 'city',
  Mun: 'municipality',
};

/** Encode a code for a path segment. Codes are digits, but never trust that. */
const segment = (code: string) => encodeURIComponent(code);

async function getJson(path: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${PSGC_CLOUD_BASE}${path}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    if ((error as { name?: string } | null)?.name === 'AbortError')
      throw new AddressProviderError('PROVIDER_TIMEOUT');
    throw new AddressProviderError('PROVIDER_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 404) throw new AddressProviderError('PROVIDER_NOT_FOUND');
  if (!response.ok) throw new AddressProviderError('PROVIDER_UNAVAILABLE');

  try {
    return await response.json();
  } catch {
    throw new AddressProviderError('PROVIDER_BAD_RESPONSE');
  }
}

/** Pull the row array out of `{ data: [...] }`, failing closed on anything else. */
function rows(payload: unknown): Record<string, unknown>[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new AddressProviderError('PROVIDER_BAD_RESPONSE');
  return data as Record<string, unknown>[];
}

/**
 * Recover text that was UTF-8 decoded as Latin-1.
 *
 * The service serves some names mangled: a published `n` with tilde is delivered
 * as U+00C3 U+00B1, so `Biñan` reads `"City of BiÃ±an"`. That is a lost byte
 * sequence, not a different spelling, so the original is recoverable exactly -
 * this re-reads the string as Latin-1 bytes and decodes those as UTF-8.
 *
 * It deliberately does nothing in three cases, because each would be a guess:
 *
 * - a code point above U+00FF cannot have come from this mistake, so the string
 *   is already correct (or uses a script we should not touch);
 * - bytes that are not valid UTF-8 mean the string was already correct - `Biñan`
 *   encodes to F1, an invalid lead byte, so the round-trip fails and is refused;
 * - a repair that changes nothing is not a repair.
 *
 * A name mixing mangled Latin-1 with other scripts is left alone rather than
 * partially rewritten. No such name has been observed in PSGC.
 */
export function repairMojibake(value: string): string {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code > 0xff) return value;
    bytes[index] = code;
  }
  try {
    const repaired = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return repaired === value ? value : repaired;
  } catch {
    return value;
  }
}

/** The official name, with the provider's encoding damage undone. */
const officialName = (value: unknown): unknown =>
  typeof value === 'string' ? repairMojibake(value) : value;

/**
 * Parse one row through its contract. A row that fails is a provider defect and
 * fails the whole response: returning a partial list would let a user save an
 * address against a hierarchy the provider never confirmed.
 */
function parseRow<T>(schema: { parse: (v: unknown) => T }, row: unknown): T {
  try {
    return schema.parse(row);
  } catch {
    throw new AddressProviderError('PROVIDER_BAD_RESPONSE');
  }
}

/**
 * NCR's region code. The National Capital Region nests no provinces, so it is
 * the one region that has to stand in for a province - otherwise Metro Manila
 * can never be chosen, and no NCR address can be entered at all. It is labelled
 * the way Philippine addresses write it, which is the value the member record
 * stores as the province.
 */
const METRO_MANILA_REGION_CODE = '1300000000';
const METRO_MANILA_LABEL = 'Metro Manila';

/**
 * Every province, plus any region that nests none.
 *
 * A region with no provinces cannot be reached through `/provinces` at all, so
 * offering it as a province-scope is the only way to address its cities. Each
 * candidate is confirmed against `/regions/{code}/provinces` before it is
 * offered: a region whose name merely failed to match a province's `region`
 * string must not smuggle a whole region into the province list.
 */
async function provinceScopes(): Promise<Province[]> {
  const provinceRows = rows(await getJson('/provinces'));
  const provinces = provinceRows.map((row) =>
    parseRow(provinceSchema, { code: row.code, name: officialName(row.name) }),
  );

  const namedByAnyProvince = new Set(provinceRows.map((row) => String(row.region)));
  const candidates = rows(await getJson('/regions')).filter(
    (row) => !namedByAnyProvince.has(String(row.name)),
  );

  const orphanRegions: Province[] = [];
  for (const row of candidates) {
    const code = String(row.code);
    const nested = rows(await getJson(`/regions/${segment(code)}/provinces`));
    if (nested.length > 0) continue;
    orphanRegions.push(
      parseRow(provinceSchema, {
        code,
        name: code === METRO_MANILA_REGION_CODE ? METRO_MANILA_LABEL : officialName(row.name),
      }),
    );
  }
  return [...provinces, ...orphanRegions];
}

/**
 * A scope's city/municipality rows.
 *
 * PSGC nests a province's cities under the province. A province-less region has
 * no such path - `/provinces/{code}/cities-municipalities` answers 404 and its
 * cities hang off the region instead - so the region path is the fallback. The
 * province path is tried first because a province is the common case.
 */
async function localityRows(scopeCode: string): Promise<Record<string, unknown>[]> {
  try {
    return rows(await getJson(`/provinces/${segment(scopeCode)}/cities-municipalities`));
  } catch (error) {
    if (!(error instanceof AddressProviderError) || error.code !== 'PROVIDER_NOT_FOUND')
      throw error;
    return rows(await getJson(`/regions/${segment(scopeCode)}/cities-municipalities`));
  }
}

export const psgcCloudAddressProvider: AddressProvider = {
  name: 'psgc-cloud-v2',

  provinces: provinceScopes,

  async localities(scopeCode: string): Promise<Locality[]> {
    const raw = await localityRows(scopeCode);
    return raw.flatMap((row) => {
      const type = LOCALITY_TYPE_BY_PROVIDER[String(row.type)];
      // A district or special unit, not a city or municipality: skip it rather
      // than fail the province. See LOCALITY_TYPE_BY_PROVIDER.
      if (!type) return [];
      // `provinceCode` is not in the provider payload; it is the scope we asked
      // for, which is what makes the parent link explicit and checkable.
      // `zip_code` is published for most localities and blank for some; a
      // blank is "no published zip", never an empty code to store.
      const postalCode = typeof row.zip_code === 'string' ? row.zip_code.trim() : '';
      return [
        parseRow(localitySchema, {
          code: row.code,
          name: officialName(row.name),
          type,
          provinceCode: scopeCode,
          ...(postalCode ? { postalCode } : {}),
        }),
      ];
    });
  },

  async barangays(localityCode: string): Promise<Barangay[]> {
    const raw = rows(await getJson(`/cities-municipalities/${segment(localityCode)}/barangays`));
    return raw.map((row) =>
      parseRow(barangaySchema, {
        code: row.code,
        name: officialName(row.name),
        localityCode,
      }),
    );
  },
};