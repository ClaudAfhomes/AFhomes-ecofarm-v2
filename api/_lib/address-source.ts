/**
 * The one place that chooses and caches the address provider.
 *
 * Separate from `address-provider.ts` (the interface, the cache and the hierarchy
 * check) and from `psgc-cloud-provider.ts` (the adapter) purely so the
 * dependency arrow points one way: adapter -> core, and this module -> both.
 * Putting the selection inside the core would make it import the adapter it
 * abstracts.
 *
 * ONE instance, shared by every handler in the process, so a province list is
 * fetched upstream once no matter which route asked for it. Two handlers each
 * building their own cache would double the request count against a source that
 * rate-limits at 120/minute.
 *
 * SWAPPING IN PSA: implement `AddressProvider` against the token-gated
 * classifications API (token read from server-only env, never `process.env` on
 * the client, never a `VITE_` variable) and add it as a branch below. No
 * contract, migration, form component, ranking code or business rule changes -
 * everything above depends on the interface, not on this function.
 */
import { createCachedAddressProvider, type AddressProvider } from './address-provider.js';
import { psgcCloudAddressProvider } from './psgc-cloud-provider.js';

let cachedProvider: AddressProvider | null = null;

function selectAddressProvider(): AddressProvider {
  return createCachedAddressProvider(psgcCloudAddressProvider);
}

export function addressProvider(): AddressProvider {
  cachedProvider ??= selectAddressProvider();
  return cachedProvider;
}

/**
 * Purge the lookup cache.
 *
 * PSGC reference data only changes on a quarterly publication, so the 24h TTL is
 * the normal path; this exists for an operator refresh after a new publication,
 * and so a handler test can start from a cold cache rather than inheriting warm
 * scopes from the previous test.
 */
export function resetAddressProviderCache(): void {
  // The cache is created lazily, so there may be nothing to purge yet.
  (cachedProvider as { clear?: () => void } | null)?.clear?.();
}