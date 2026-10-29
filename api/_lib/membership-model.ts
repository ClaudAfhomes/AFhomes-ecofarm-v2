import { isoOrNull } from './handler-kit.js';
import { cardQrPayload } from './identifier.js';
export type CategoryInfo = { name: string | null };
export type IssuerInfo = { name: string | null };
export type SchemeInfo = { paymentScheme: string | null; validityMonths: number | null };

export const toMembership = (
  row: Record<string, unknown>,
  categories: Map<string, CategoryInfo>,
  issuers: Map<string, IssuerInfo>,
  schemes: Map<string, SchemeInfo>,
) => {
  const customer = (row.customers ?? {}) as Record<string, unknown>;
  const product = (row.card_plans ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName:
      [customer.first_name, customer.middle_name, customer.last_name, customer.suffix]
        .filter((p) => typeof p === 'string' && p)
        .join(' ') || 'Unknown customer',
    customerStatus: (customer.status as string | null) ?? null,
    saleId: row.sale_id,
    membershipNumber: row.membership_number,
    productId: isoOrNull(row.product_id),
    productName: isoOrNull(product.name),
    categoryName: categories.get(String(product.category_id ?? ''))?.name ?? null,
    status: row.status,
    paymentScheme: schemes.get(String(row.sale_id ?? ''))?.paymentScheme ?? null,
    pointsBalance: Number(row.points_balance ?? 0),
    yearlyPointsAllocated: Number(row.yearly_points_allocated ?? 0),
    activatedAt: isoOrNull(row.activated_at),
    expiresAt: isoOrNull(row.expires_at),
    renewalDueAt: isoOrNull(row.renewal_due_at),
    cardIssuedAt: isoOrNull(row.card_issued_at),
    issuedBy: issuers.get(String(row.card_issued_by ?? ''))?.name ?? null,
    lastPrintedAt: isoOrNull(row.last_printed_at),
    printCount: Number(row.print_count ?? 0),
    // Memberships are born at activation and have no separate created_at.
    createdAt: isoOrNull(row.activated_at) ?? '',
  };
};

function validityYearsOf(months: number | null | undefined): number | null {
  if (months === null || months === undefined || months <= 0) return null;
  return months % 12 === 0 ? months / 12 : null;
}
export const toCard = (
  row: Record<string, unknown>,
  categories: Map<string, CategoryInfo>,
  issuers: Map<string, IssuerInfo>,
  schemes: Map<string, SchemeInfo>,
) => {
  const customer = (row.customers ?? {}) as Record<string, unknown>;
  const product = (row.card_plans ?? {}) as Record<string, unknown>;
  const membershipNumber = String(row.membership_number ?? '');
  return {
    membershipId: row.id,
    membershipNumber,
    memberName:
      [customer.first_name, customer.middle_name, customer.last_name, customer.suffix]
        .filter((p) => typeof p === 'string' && p)
        .join(' ') || 'Unknown customer',
    customerStatus: (customer.status as string | null) ?? null,
    tierName: typeof product.name === 'string' && product.name ? product.name : 'AFHomes card',
    tierCode: typeof product.code === 'string' ? product.code : '',
    categoryName: categories.get(String(product.category_id ?? ''))?.name ?? null,
    status: row.status,
    pointsBalance: Number(row.points_balance ?? 0),
    yearlyPointsAllocated: Number(row.yearly_points_allocated ?? 0),
    activatedAt: isoOrNull(row.activated_at),
    expiresAt: isoOrNull(row.expires_at),
    validityYears: validityYearsOf(schemes.get(String(row.sale_id ?? ''))?.validityMonths),
    memberCode: membershipNumber,
    qrPayload: cardQrPayload(membershipNumber),
    cardIssuedAt: isoOrNull(row.card_issued_at),
    issuedBy: issuers.get(String(row.card_issued_by ?? ''))?.name ?? null,
    lastPrintedAt: isoOrNull(row.last_printed_at),
    printCount: Number(row.print_count ?? 0),
  };
};
