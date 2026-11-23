import { customerLookupSchema, gsdActiveVipLookupSchema, memberLookupSchema } from '@afhomes/contracts';
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
    customerId: r.id,
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
    // Business-state display fields, already present in `customer_directory`
    // (`c.*`). Exposed here so the GSD desk can render the record card from
    // this authorized read alone, without the `sales.customers`-gated detail
    // endpoint.
    paymentStatus: (r.payment_status as 'no_payment' | 'partially_paid' | 'fully_paid' | null) ?? null,
    companyStatus: (r.company_status as string | null) ?? null,
    statedVipPackage: (r.stated_vip_package as string | null) ?? null,
    supplementaryFullName: (r.supplementary_full_name as string | null) ?? null,
  });
}

/**
 * Strict GSD Customer Lookup projection (active VIP only).
 *
 * Returns the authorized staff display fields. Returns `null` when
 * any required value is missing/invalid so the caller can drop the row (fail
 * closed) rather than render a placeholder. Full surnames are staff-only.
 * `validUntil` is the authoritative `expires_at` formatted in Asia/Manila.
 */
export async function gsdActiveVipLookupFromDirectory(
  r: Record<string, unknown>,
  db?: {
    from: (t: string) => {
      select: (c: string) => {
        eq: (col: string, val: string) => {
          eq: (col: string, val: string) => {
            order: (col: string, opts: { ascending: boolean }) => {
              limit: (n: number) => Promise<{ data?: Array<{ storage_path?: string }> | null; error?: unknown }>;
            };
          };
        };
      };
    };
    storage: { from: (b: string) => { createSignedUrl: (p: string, t: number) => Promise<{ data?: { signedUrl?: string } | null; error?: unknown }> } };
  },
): Promise<ReturnType<typeof gsdActiveVipLookupSchema.parse> | null> {
  const firstName = typeof r.first_name === 'string' ? r.first_name.trim() : '';
  const lastName = typeof r.last_name === 'string' ? r.last_name.trim() : '';
  const tier = typeof r.tier === 'string' ? r.tier.trim().toUpperCase() : '';
  const expiresAt = isoOrNull(r.expires_at);
  if (!firstName || !lastName || !tier || !expiresAt) return null;
  if (tier !== 'BRONZE' && tier !== 'SILVER' && tier !== 'GOLD') return null;
  let validUntil: string;
  try {
    validUntil = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(
      new Date(expiresAt),
    );
  } catch {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) return null;
  const totalAvailablePoints = Number(r.available_points ?? 0);
  const weekday = r.weekday_available_points == null ? NaN : Number(r.weekday_available_points);
  const weekend = r.weekend_available_points == null ? NaN : Number(r.weekend_available_points);
  const weekdayAvailablePoints = Number.isSafeInteger(weekday) && weekday >= 0 ? weekday : null;
  const weekendAvailablePoints = Number.isSafeInteger(weekend) && weekend >= 0 ? weekend : null;
  const raNumber = typeof r.ra_number === 'string' ? r.ra_number : null;
  const vipCardNumber = typeof r.vip_card_number === 'string' ? r.vip_card_number : null;

  // Government ID image: fetch the latest identity_document for this customer
  // and issue a short-lived signed URL (300s) from the private bucket.
  let governmentIdImageUrl: string | null = null;
  const customerId = typeof r.id === 'string' ? r.id : null;
  if (customerId && db) {
    try {
      const { data: docs } = await db
        .from('identity_documents')
        .select('storage_path')
        .eq('customer_id', customerId)
        .eq('subject_type', 'customer')
        .order('created_at', { ascending: false })
        .limit(1);
      const storagePath = (docs as Array<{ storage_path?: string }> | null)?.[0]?.storage_path;
      if (storagePath) {
        const slash = storagePath.indexOf('/');
        const bucket = slash > 0 ? storagePath.slice(0, slash) : 'afhomes-customer-ids';
        const objectPath = slash > 0 ? storagePath.slice(slash + 1) : storagePath;
        const signed = await db.storage.from(bucket).createSignedUrl(objectPath, 300);
        governmentIdImageUrl = signed?.data?.signedUrl ?? null;
      }
    } catch {
      governmentIdImageUrl = null;
    }
  }

  return gsdActiveVipLookupSchema.parse({
    firstName,
    lastName,
    raNumber,
    vipCardNumber,
    vipTier: tier as 'BRONZE' | 'SILVER' | 'GOLD',
    validUntil,
    totalAvailablePoints,
    weekendAvailablePoints,
    weekdayAvailablePoints,
    governmentIdImageUrl,
  });
}
