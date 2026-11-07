/**
 * Address reference lookups.
 *
 * The ONLY path from the browser to geographic data. There is deliberately no
 * direct call to the upstream provider from any component: the provider URL, its
 * field names and its rate limit stay on the server, and the browser holds no
 * credential for it (the current source needs none, and a future token-gated
 * source must never become a `VITE_` variable).
 */
import {
  barangaySchema,
  localitySchema,
  provinceSchema,
  type Barangay,
  type Locality,
  type Province,
} from '@afhomes/contracts';

import { protectedRequestList } from '../../lib/api/client.js';

export const getAddressProvinces = (): Promise<Province[]> =>
  protectedRequestList('/address', provinceSchema);

export const getAddressLocalities = (provinceCode: string): Promise<Locality[]> =>
  protectedRequestList(`/address/provinces/${encodeURIComponent(provinceCode)}/localities`, localitySchema);

export const getAddressBarangays = (localityCode: string): Promise<Barangay[]> =>
  protectedRequestList(
    `/address/localities/${encodeURIComponent(localityCode)}/barangays`,
    barangaySchema,
  );