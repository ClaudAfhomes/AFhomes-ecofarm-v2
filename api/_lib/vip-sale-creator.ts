import { canCreateVipSale, mustNameSellerOfRecord } from '@afhomes/contracts';
import type { AfHomesPrincipal } from './afhomes-access.js';
import { fail } from './handler-kit.js';
import type { VercelResponse } from './http.js';

/**
 * Origination guard (runs after the module-permission check). OST and inactive
 * accounts are refused; an SM creator is the seller of record; any other
 * permitted creator must name the active SM. `resolveSeller` then validates the
 * named SM. Synchronous on purpose: callers write
 * `if (!requireVipSaleCreator(...)) return;`, and an async guard would return a
 * Promise (always truthy), letting the handler continue and create the sale
 * after the 403 had already been written.
 */
export function requireVipSaleCreator(
  auth: AfHomesPrincipal,
  res: VercelResponse,
  candidate?: unknown,
): boolean {
  if (!canCreateVipSale(auth)) {
    fail(
      res,
      'FORBIDDEN',
      'An OST or inactive account cannot create or submit a VIP sale, Customer Application or Reservation Agreement.',
      403,
    );
    return false;
  }
  const namesOther = candidate != null && candidate !== '' && candidate !== auth.userId;
  if (!mustNameSellerOfRecord(auth) && namesOther) {
    fail(res, 'FORBIDDEN', 'The creating Sales Manager must be the seller of record.', 403);
    return false;
  }
  if (mustNameSellerOfRecord(auth) && !namesOther) {
    fail(
      res,
      'VALIDATION_ERROR',
      'Choose the active Sales Manager who is the seller of record.',
      400,
    );
    return false;
  }
  return true;
}
