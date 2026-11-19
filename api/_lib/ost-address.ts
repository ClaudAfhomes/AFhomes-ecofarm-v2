import type { OstIdentity } from '@afhomes/contracts';
import { addressProvider } from './address-source.js';
import { verifyAddressHierarchy } from './address-provider.js';

type OstAddress = OstIdentity['address'];
type OstHierarchy = NonNullable<OstIdentity['addressHierarchy']>;

/**
 * Verify a supplied address triple against the reference, replacing submitted
 * geographic names with the provider's own spelling. Used by the OST form
 * submissions (full identity) and by controlled applicant corrections, which
 * carry just the address pair. No codes means no verification claim here; the
 * correction route requires codes in its contract, so legacy-shaped payloads
 * only exist on the older submission routes.
 */
export async function verifyOstAddressDetails(
  address: OstAddress,
  codes: OstHierarchy | undefined,
): Promise<{ ok: true; address: OstAddress } | { ok: false; status: 400 | 503 }> {
  if (!codes) return { ok: true, address };
  const provider = addressProvider();
  try {
    if (codes.regionCode) {
      if (!provider.provincesInRegion) return { ok: false, status: 503 };
      const provinces = await provider.provincesInRegion(codes.regionCode);
      if (!provinces.some((p) => p.code === codes.provinceCode)) return { ok: false, status: 400 };
    }
    const result = await verifyAddressHierarchy(provider, codes);
    if (!result.valid)
      return { ok: false, status: result.reason.startsWith('PROVIDER_') ? 503 : 400 };
    const { province, locality, barangay } = result.hierarchy;
    if (address.postalCode && address.postalCode !== locality.postalCode)
      return { ok: false, status: 400 };
    return {
      ok: true,
      address: {
        ...address,
        province: province.name,
        city: locality.name,
        barangay: barangay.name,
        postalCode: locality.postalCode,
      },
    };
  } catch {
    return { ok: false, status: 503 };
  }
}

export async function verifyOstAddress(
  identity: OstIdentity,
): Promise<{ ok: true; identity: OstIdentity } | { ok: false; status: 400 | 503 }> {
  const result = await verifyOstAddressDetails(identity.address, identity.addressHierarchy);
  return result.ok ? { ok: true, identity: { ...identity, address: result.address } } : result;
}
