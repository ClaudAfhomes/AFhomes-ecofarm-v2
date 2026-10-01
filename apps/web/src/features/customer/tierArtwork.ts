/**
 * Digital VIP card artwork, by membership tier.
 *
 * These are the EXACT homepage card images (`apps/web/src/marketing/...`) -
 * no redesign, no duplicates. The tier comes from the membership's product
 * code (GOLD / SILVER / BRONZE); anything unrecognised falls back to the
 * Silver artwork, mirroring the marketing tier card.
 */
import bronzeCard from '../../marketing/assets/uploads/bronze-card.webp';
import goldCard from '../../marketing/assets/uploads/gold-card.webp';
import silverCard from '../../marketing/assets/uploads/silver-card.webp';

export type VipTier = 'GOLD' | 'SILVER' | 'BRONZE';

const ARTWORK: Record<VipTier, { src: string; alt: string }> = {
  GOLD: { src: goldCard, alt: 'Gold VIP membership card' },
  SILVER: { src: silverCard, alt: 'Silver VIP membership card' },
  BRONZE: { src: bronzeCard, alt: 'Bronze VIP membership card' },
};

export function tierArtwork(productCode: string | null | undefined): { src: string; alt: string } {
  const tier = (productCode ?? '').trim().toUpperCase();
  if (tier === 'GOLD' || tier === 'SILVER' || tier === 'BRONZE') return ARTWORK[tier];
  return ARTWORK.SILVER;
}

export function tierLabel(productName: string | null | undefined, productCode: string | null | undefined): string {
  if (productName && productName.trim()) return productName.trim();
  const tier = (productCode ?? '').trim().toUpperCase();
  if (tier === 'GOLD' || tier === 'SILVER' || tier === 'BRONZE') {
    return `${tier.charAt(0)}${tier.slice(1).toLowerCase()} VIP`;
  }
  return 'AF Homes VIP';
}
