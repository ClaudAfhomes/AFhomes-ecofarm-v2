import { memberLookupSchema } from '@jad/contracts';
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
