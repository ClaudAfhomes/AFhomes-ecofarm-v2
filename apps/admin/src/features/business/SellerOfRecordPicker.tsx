import { canCreateVipSale, mustNameSellerOfRecord } from '@afhomes/contracts';

type Account = { roleSlug?: string; status?: string } | null | undefined;

/**
 * UX guard only (the server re-validates). Who may create a sale is the module
 * permission plus `canCreateVipSale`; a non-SM creator must name the active
 * Sales Manager who is the seller of record. The picker itself lives in the
 * Network step (`RecommenderFields`).
 */
export function sellerOfRecordBlocker(account: Account, sellerId: string): string | null {
  if (!canCreateVipSale(account)) return 'Your account cannot create or submit sales.';
  if (mustNameSellerOfRecord(account) && !sellerId)
    return 'Choose the active Sales Manager who is the seller of record in the Network step.';
  return null;
}
