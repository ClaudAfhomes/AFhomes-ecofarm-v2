/** Tier key for presentation only; unknown codes fall back like `tierArtwork` (Silver). */
export function vipTier(productCode: string | null | undefined): 'gold' | 'silver' | 'bronze' {
  const tier = (productCode ?? '').trim().toUpperCase();
  return tier === 'GOLD' ? 'gold' : tier === 'BRONZE' ? 'bronze' : 'silver';
}
