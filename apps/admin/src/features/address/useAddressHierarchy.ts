/**
 * Cascading address lookups.
 *
 * Each level is keyed by its PARENT'S CODE, and a level with no parent is simply
 * not requested (`enabled: false`). That single decision buys the two properties
 * that matter:
 *
 * - **No orphaned children.** A barangay list belongs to one locality key, so a
 *   result can never outlive the parent it was fetched for.
 * - **Stale-response protection, for free.** TanStack Query stores a result
 *   under the key that asked for it. When the province changes, the component
 *   reads a DIFFERENT key, so a slow earlier response has nowhere to land even
 *   though it is still in flight and was never cancelled.
 *
 * Typing never triggers a request. The combobox ranks against the already-loaded
 * scoped list in the browser, so a single province visit is one upstream call and
 * a single locality visit is one more.
 */
import { useQuery } from '@tanstack/react-query';

import {
  getAddressBarangays,
  getAddressLocalities,
  getAddressProvinces,
} from './services.js';

/**
 * Geographic reference data changes on a quarterly publication cadence and the
 * server caches it for a day, so the client treats it as effectively
 * immutable: no polling, and no refetch on window focus.
 */
const REFERENCE_STALE_TIME_MS = 60 * 60 * 1000;

export function useProvincesQuery(enabled = true) {
  return useQuery({
    queryKey: ['address', 'provinces'],
    queryFn: getAddressProvinces,
    // The province list is only fetched once the operator actually opens the
    // Province selector. The address block is a few fields inside a long form,
    // and paying for a reference list nobody asked for also means a transient
    // failure can raise a live region on a form they never touched.
    enabled,
    staleTime: REFERENCE_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useLocalitiesQuery(provinceCode: string | undefined) {
  return useQuery({
    queryKey: ['address', 'localities', provinceCode ?? ''],
    queryFn: () => getAddressLocalities(provinceCode!),
    enabled: Boolean(provinceCode),
    staleTime: REFERENCE_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    // A code the provider does not know is a real answer (404), not a blip.
    retry: false,
  });
}

export function useBarangaysQuery(localityCode: string | undefined) {
  return useQuery({
    queryKey: ['address', 'barangays', localityCode ?? ''],
    queryFn: () => getAddressBarangays(localityCode!),
    enabled: Boolean(localityCode),
    staleTime: REFERENCE_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    retry: false,
  });
}