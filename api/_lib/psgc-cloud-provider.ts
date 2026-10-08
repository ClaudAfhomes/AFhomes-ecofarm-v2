/**
 * PSGC Cloud v2 adapter.
 *
 * This is the ONLY module that knows PSGC Cloud's URLs and field names. Verified
 * against the live service on 2026-10-08:
 *
 *   GET /provinces                              -> { data: [{ code, name, region }] }
 *   GET /provinces/{code}/cities-municipalities  -> { data: [{ code, name, type, ... }] }
 *   GET /cities-municipalities/{code}/barangays  -> { data: [{ code, name, ... }] }
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
 * The service reports city vs municipality as `City` / `Mun`. Mapping exactly
 * these two strings (rather than anything "city-like") keeps an unrecognised
 * value a loud failure instead of a silently mislabelled locality.
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

export const psgcCloudAddressProvider: AddressProvider = {
  name: 'psgc-cloud-v2',

  async provinces(): Promise<Province[]> {
    return rows(await getJson('/provinces')).map((row) =>
      parseRow(provinceSchema, { code: row.code, name: officialName(row.name) }),
    );
  },

  async localities(provinceCode: string): Promise<Locality[]> {
    const raw = rows(
      await getJson(`/provinces/${segment(provinceCode)}/cities-municipalities`),
    );
    return raw.map((row) => {
      // `provinceCode` is not in the provider payload; it is the scope we asked
      // for, which is what makes the parent link explicit and checkable.
      const type = LOCALITY_TYPE_BY_PROVIDER[String(row.type)];
      if (!type) throw new AddressProviderError('PROVIDER_BAD_RESPONSE');
      return parseRow(localitySchema, {
        code: row.code,
        name: officialName(row.name),
        type,
        provinceCode,
      });
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