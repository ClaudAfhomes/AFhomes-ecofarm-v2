/**
 * Sale origination (product owner, 16 Nov 2026).
 *
 * WHO may create a VIP sale / submit a Customer Application is decided by the
 * configurable module permission (checked separately, server-side). This helper
 * also requires an active SM, Admin or Super Admin. Oversight and Finance
 * permissions never imply origination authority. An SM sells for themselves;
 * administrators must name the active SM of record.
 */
export function canCreateVipSale(
  account: { roleSlug?: string; status?: string } | null | undefined,
): boolean {
  if (!account || account.status !== 'active') return false;
  return ['sales_manager', 'admin', 'super_admin'].includes(account.roleSlug ?? '');
}

/** The only role that can be the seller of record of a new sale. */
export const SELLER_OF_RECORD_ROLE = 'sales_manager';

/** True when the creator must pick the active Sales Manager who is the seller of record. */
export function mustNameSellerOfRecord(account: { roleSlug?: string } | null | undefined): boolean {
  return (account?.roleSlug ?? '') !== SELLER_OF_RECORD_ROLE;
}
