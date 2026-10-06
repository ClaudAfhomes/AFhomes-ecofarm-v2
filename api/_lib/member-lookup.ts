import { customerLookupSchema, memberLookupSchema } from '@afhomes/contracts';
import { isoOrNull } from './handler-kit.js';
export function memberLookupFromDirectory(r: Record<string, unknown>) {
  return memberLookupSchema.parse({
    membershipNumber: r.membership_number,
    memberName: r.full_name,
    customerNumber: r.customer_number,
    tier: r.tier,
    membershipStatus: r.member_status,
    category: r.derivedCategory,
    activatedAt: isoOrNull(r.activated_at),
    expiresAt: isoOrNull(r.expires_at),
    availablePoints: String(r.available_points ?? 0),
    mayUsePrivileges: r.derivedCategory === 'ACTIVE_VIP',
  });
}

/**
 * General Customer Lookup row.
 *
 * Read straight from `customer_directory`, which selects `c.*` - so `status`,
 * `customer_code` and `customer_number` are all present without a schema change.
 * That is why this screen needs no migration: `membersOnly` is a plain filter and
 * the record already carries every field required here.
 *
 * `membership_number` is deliberately NOT mapped. It is right there in the record;
 * leaving it unmapped is the point. `customerLookupSchema` has no field to put it
 * in, so the "GSD screens must not display a Membership Code" rule is enforced by
 * the type rather than by a reviewer's memory.
 */
export function customerLookupFromDirectory(r: Record<string, unknown>) {
  return customerLookupSchema.parse({
    customerNumber: r.customer_number,
    customerCode: r.customer_code ?? null,
    fullName: r.full_name,
    customerStatus: r.status,
    // A customer with no membership has a null plan join, not an empty string, so
    // nullish-collapsed here rather than rendered as a blank "None" tier.
    tier: r.tier ?? null,
    membershipStatus: r.member_status ?? null,
    membershipExpiresAt: isoOrNull(r.expires_at),
    category: r.derivedCategory,
  });
}
