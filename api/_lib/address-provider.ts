/**
 * Provider-neutral Philippine address lookup.
 *
 * Core application code depends ONLY on the `AddressProvider` interface, never
 * on a provider's URLs or field names. A future source (the PSA
 * classifications API, which is token-gated and therefore server-side only) is a
 * new implementation plus one selection branch - no application, contract,
 * database or UI change. This mirrors the existing `ocr.ts` provider seam.
 *
 * Codes are the only geographic identifier that means anything. Names are
 * display values. `verifyAddressHierarchy` re-resolves a submitted triple
 * against the provider before it is believed, so a hand-crafted request body
 * cannot pair a Laguna province with a Batangas municipality.
 */
import type { Barangay, Locality, Province } from '@afhomes/contracts';

export type AddressProviderErrorCode =
  /** The provider did not answer in time. */
  | 'PROVIDER_TIMEOUT'
  /** The provider answered with a failure status, or not at all. */
  | 'PROVIDER_UNAVAILABLE'
  /** The provider answered 404 for the code. */
  | 'PROVIDER_NOT_FOUND'
  /** The provider answered, but not with a payload we can trust. */
  | 'PROVIDER_BAD_RESPONSE';

export class AddressProviderError extends Error {
  constructor(
    readonly code: AddressProviderErrorCode,
    /** A short, provider-detail-free note for server logs. Never user-facing. */
    readonly detail?: string,
  ) {
    // The message carries the CODE, not the provider's body: a provider error
    // page can name internal hosts, database objects or tokens.
    super(code);
    this.name = 'AddressProviderError';
  }
}

export interface AddressProvider {
  readonly name: string;
  provinces(): Promise<Province[]>;
  localities(provinceCode: string): Promise<Locality[]>;
  barangays(localityCode: string): Promise<Barangay[]>;
}

export type AddressProviderLevel = 'provinces' | 'localities' | 'barangays';

/**
 * Why a hierarchy was refused, so the caller can tell a bad request from an
 * outage. `UNVERIFIED` is the only one the caller may show a user.
 */
export type AddressHierarchyRejection =
  | 'INVALID_PROVINCE'
  | 'INVALID_LOCALITY'
  | 'INVALID_BARANGAY'
  | 'LOCALITY_NOT_IN_PROVINCE'
  | 'BARANGAY_NOT_IN_LOCALITY'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_BAD_RESPONSE';

export type AddressHierarchyCheck =
  | { valid: true; hierarchy: { province: Province; locality: Locality; barangay: Barangay } }
  | { valid: false; reason: AddressHierarchyRejection };

/**
 * PSGC reference data changes on a quarterly publication cadence, so results
 * are held for a day. Long enough that a normal session never re-asks, short
 * enough that a quarterly refresh is picked up without a redeploy.
 */
export const ADDRESS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type CachedAddressProvider = AddressProvider & {
  /** Drop every scope. Needed when a PSGC refresh has to land. */
  clear(): void;
};

/**
 * Wrap a provider with a per-scope TTL cache.
 *
 * The cache stores the in-flight PROMISE, not the settled value, so N concurrent
 * requests for the same scope make exactly ONE provider call. Without that, a
 * user typing quickly across three holders can open dozens of requests against a
 * provider that rate-limits at 120/minute.
 *
 * Every caller receives its own array. A shared instance would let one request
 * mutate cached reference data out from under every later request in the warm
 * window - a data-integrity bug that would look like a phantom provider edit.
 */
export function createCachedAddressProvider(
  inner: AddressProvider,
  ttlMs: number = ADDRESS_CACHE_TTL_MS,
): CachedAddressProvider {
  const entries = new Map<string, { at: number; pending: Promise<unknown[]> }>();

  const cached = <T>(key: string, load: () => Promise<T[]>): Promise<T[]> => {
    const hit = entries.get(key);
    const now = Date.now();
    const pending =
      hit && now - hit.at < ttlMs ? (hit.pending as Promise<T[]>) : load();
    if (!hit || pending !== hit.pending) entries.set(key, { at: now, pending });
    // A failed lookup must not be pinned for a day: drop it so a retry can win.
    pending.catch(() => entries.delete(key));
    return pending.then((rows) => [...rows]);
  };

  return {
    name: `${inner.name}+cached`,
    provinces: () => cached('provinces', () => inner.provinces()),
    localities: (code) => cached(`localities:${code}`, () => inner.localities(code)),
    barangays: (code) => cached(`barangays:${code}`, () => inner.barangays(code)),
    clear: () => entries.clear(),
  };
}

/**
 * Prove a submitted triple is internally consistent: the province exists, the
 * locality exists under it, and the barangay exists under the locality.
 *
 * The provider's own ancestry-checked paths do part of this, but the AF Homes
 * server is the authority - the provider is consulted for truth, not trusted
 * for enforcement. Returns the resolved records so the caller persists the
 * provider's own spelling rather than whatever the browser sent.
 */
export async function verifyAddressHierarchy(
  provider: AddressProvider,
  input: { provinceCode: string; localityCode: string; barangayCode: string },
): Promise<AddressHierarchyCheck> {
  let provinces: Province[];
  try {
    provinces = await provider.provinces();
  } catch (e) {
    return { valid: false, reason: providerRejection(e) };
  }
  const province = provinces.find((p) => p.code === input.provinceCode);
  if (!province) return { valid: false, reason: 'INVALID_PROVINCE' };

  let localities: Locality[];
  try {
    localities = await provider.localities(province.code);
  } catch (e) {
    return { valid: false, reason: providerRejection(e) };
  }
  const locality = localities.find((l) => l.code === input.localityCode);
  if (!locality) return { valid: false, reason: 'LOCALITY_NOT_IN_PROVINCE' };

  let barangays: Barangay[];
  try {
    barangays = await provider.barangays(locality.code);
  } catch (e) {
    return { valid: false, reason: providerRejection(e) };
  }
  const barangay = barangays.find((b) => b.code === input.barangayCode);
  if (!barangay) return { valid: false, reason: 'BARANGAY_NOT_IN_LOCALITY' };

  return { valid: true, hierarchy: { province, locality, barangay } };
}

function providerRejection(error: unknown): AddressHierarchyRejection {
  // An unrecognised throwable is an OUTAGE, not a verdict about the address.
  // "Bad response" is reserved for an upstream that answered with something we
  // refuse to trust; treating an unknown failure as that would report a network
  // blip as a data-quality problem and point an operator at the wrong thing.
  if (error instanceof AddressProviderError) {
    if (error.code === 'PROVIDER_BAD_RESPONSE') return 'PROVIDER_BAD_RESPONSE';
    if (error.code === 'PROVIDER_NOT_FOUND') return 'INVALID_LOCALITY';
    return 'PROVIDER_UNAVAILABLE';
  }
  return 'PROVIDER_UNAVAILABLE';
}