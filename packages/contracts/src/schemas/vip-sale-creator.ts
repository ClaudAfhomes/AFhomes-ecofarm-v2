/**
 * Sale origination (product owner, 11 Nov 2026).
 *
 * WHO may create a VIP sale / submit a Customer Application is decided by the
 * configurable module permission (checked separately, server-side). This helper
 * only adds the fixed exclusions: the account must be active and OST may never
 * originate. The seller of record is always an ACTIVE Sales Manager: an SM
 * creator is the seller; any other permitted creator must name the SM.
 */
export function canCreateVipSale(
  account: { roleSlug?: string; status?: string } | null | undefined,
): boolean {
  if (!account || account.status !== 'active') return false;
  return Boolean(account.roleSlug) && account.roleSlug !== 'ost';
}

/** The only role that can be the seller of record of a new sale. */
export const SELLER_OF_RECORD_ROLE = 'sales_manager';

/** True when the creator must pick the active Sales Manager who is the seller of record. */
export function mustNameSellerOfRecord(account: { roleSlug?: string } | null | undefined): boolean {
  return (account?.roleSlug ?? '') !== SELLER_OF_RECORD_ROLE;
}
