import { z } from 'zod';
import {
  maskGovernmentId,
  customerCategorySchema,
  normalizePersonName,
  normalizePhilippinePhone,
  normalizePostalCode,
  type CreateCustomerRequest,
  type UpdateCustomerRequest,
} from '@afhomes/contracts';
import { isoOrNull } from './handler-kit.js';
export const fullName = (row: Record<string, unknown>) =>
  [row.first_name, row.middle_name, row.last_name, row.suffix]
    .filter((part) => typeof part === 'string' && part.length > 0)
    .join(' ');

/** Read model. Never includes the raw government ID number. */
export function customerHasActiveMembership(row: Record<string, unknown>): boolean {
  // PostgREST cardinality, not a guess: `memberships.customer_id` is UNIQUE
  // (one membership per customer), so the `memberships` embed on a customer
  // row is a to-one OBJECT (or null when there is none) - never an array.
  // Requiring an array reported every member as having no active membership.
  // Accept the object form, and arrays defensively.
  const embedded = row.memberships;
  const list: Record<string, unknown>[] = Array.isArray(embedded)
    ? (embedded as Record<string, unknown>[])
    : embedded !== null && typeof embedded === 'object'
      ? [embedded as Record<string, unknown>]
      : [];
  return list.some((membership) => membership.status === 'active');
}

export const toCustomer = (
  row: Record<string, unknown>,
  options: { includeTin?: boolean } = {},
) => ({
  id: row.id,
  customerNumber: row.customer_number,
  // The customer's own Customer Code, distinct from the Customer ID above.
  // Returned to authorized staff only; it authorizes nothing.
  customerCode: (row.customer_code as string | null | undefined) ?? null,
  fullName: fullName(row),
  firstName: isoOrNull(row.first_name),
  middleName: isoOrNull(row.middle_name),
  lastName: isoOrNull(row.last_name),
  suffix: isoOrNull(row.suffix),
  email: row.email,
  phone: row.phone,
  landline: isoOrNull(row.landline),
  dateOfBirth: isoOrNull(row.birth_date),
  gender: isoOrNull(row.gender),
  address: row.address ?? null,
  governmentIdType: isoOrNull(row.government_id_type),
  governmentIdMasked:
    isoOrNull(row.government_id_masked) ?? maskGovernmentId(isoOrNull(row.government_id_number)),
  // Company-stated membership fields. TIN values are masked on list, create
  // and update reads. The single-record detail read opts in to the raw value
  // so the edit dialog can show the current TIN; audits never carry it.
  tinNumberMasked: maskGovernmentId(isoOrNull(row.tin_number)),
  ...(options.includeTin
    ? {
        tinNumber: isoOrNull(row.tin_number),
        supplementaryTinNumber: isoOrNull(row.supplementary_tin_number),
      }
    : {}),
  raNumber: isoOrNull(row.ra_number),
  companyStatus: isoOrNull(row.company_status),
  citizenship: isoOrNull(row.citizenship),
  civilStatus: isoOrNull(row.civil_status),
  occupationBusinessName: isoOrNull(row.occupation_business_name),
  officeBusinessAddress: isoOrNull(row.office_business_address),
  employedPosition: isoOrNull(row.employed_position),
  supplementaryFullName: isoOrNull(row.supplementary_full_name),
  supplementaryAddress: isoOrNull(row.supplementary_address),
  supplementaryBirthday: isoOrNull(row.supplementary_birthday),
  supplementaryGender: isoOrNull(row.supplementary_gender),
  supplementaryCitizenship: isoOrNull(row.supplementary_citizenship),
  supplementaryCivilStatus: isoOrNull(row.supplementary_civil_status),
  supplementaryTinNumberMasked: maskGovernmentId(isoOrNull(row.supplementary_tin_number)),
  supplementaryMobile: isoOrNull(row.supplementary_mobile),
  supplementaryEmail: isoOrNull(row.supplementary_email),
  supplementaryLandline: isoOrNull(row.supplementary_landline),
  supplementaryOccupationBusinessName: isoOrNull(row.supplementary_occupation_business_name),
  supplementaryOfficeAddress: isoOrNull(row.supplementary_office_address),
  supplementaryPosition: isoOrNull(row.supplementary_position),
  svdName: isoOrNull(row.svd_name),
  ssmName: isoOrNull(row.ssm_name),
  smName: isoOrNull(row.sm_name),
  referrerName: isoOrNull(row.referrer_name),
  vipRecommenderName: isoOrNull(row.vip_recommender_name),
  relatedContactNo: isoOrNull(row.related_contact_no),
  relatedEmail: isoOrNull(row.related_email),
  statedVipPackage: isoOrNull(row.stated_vip_package),
  statedPaymentTerms: isoOrNull(row.stated_payment_terms),
  statedRegularPrice: isoOrNull(row.stated_regular_price),
  statedDiscount: isoOrNull(row.stated_discount),
  statedTotalAmount: isoOrNull(row.stated_total_amount),
  statedRf: isoOrNull(row.stated_rf),
  statedPaymentType: isoOrNull(row.stated_payment_type),
  statedRefNo: isoOrNull(row.stated_ref_no),
  statedPaymentDate: isoOrNull(row.stated_payment_date),
  vipCardNumber: typeof row.vip_card_number === 'string' ? row.vip_card_number : null,
  status: row.status,
  hasActiveMembership: customerHasActiveMembership(row),
  // Membership facts mirrored from general Customer Lookup. The directory RPC
  // carries them (tier, member_status, expires_at, memberships embed); raw
  // table rows (e.g. right after create) simply have none, hence nulls.
  tier: (row.tier as string | null | undefined) ?? null,
  membershipStatus:
    ((row.memberships as { status?: unknown } | null | undefined)?.status as string | undefined) ??
    isoOrNull(row.member_status),
  membershipExpiresAt: isoOrNull(row.expires_at),
  paymentStatus:
    (row.payment_status as 'no_payment' | 'partially_paid' | 'fully_paid' | null | undefined) ??
    null,
  verifiedPaid: (row.verified_paid as string | null | undefined) ?? '0.00',
  frozenTotal:
    row.frozen_total === null || row.frozen_total === undefined ? '0.00' : String(row.frozen_total),
  openReservationTotal: String(row.open_reservation_total ?? '0.00'),
  openReservationPaid: String(row.open_reservation_paid ?? '0.00'),
  derivedCategory: row.derivedCategory,
  portalAccountActivated:
    typeof row.auth_user_id === 'string' && row.auth_user_id.trim().length > 0,
  createdBy: isoOrNull(row.created_by),
  createdAt: isoOrNull(row.created_at) ?? '',
  updatedAt: isoOrNull(row.updated_at) ?? '',
});

export const listQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.string().trim().max(30).optional(),
  payment: z.enum(['no_payment', 'partially_paid', 'fully_paid']).optional(),
  companyStatus: z.string().trim().max(30).optional(),
  category: customerCategorySchema.optional(),
  tier: z.enum(['GOLD', 'SILVER', 'BRONZE']).optional(),
  seller: z.string().uuid().optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  sort: z
    .enum([
      'name',
      'tier',
      'category',
      'payment_status',
      'membership_status',
      'verified_paid',
      'created',
    ])
    .default('created'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function customerCreateRow(
  input: CreateCustomerRequest,
  actorId: string,
  customerNumber: string,
) {
  return {
    customer_number: customerNumber,
    first_name: input.firstName,
    middle_name: input.middleName === undefined ? null : normalizePersonName(input.middleName),
    last_name: input.lastName,
    suffix: input.suffix === undefined ? null : normalizePersonName(input.suffix),
    birth_date: input.dateOfBirth,
    gender: input.gender ?? null,
    email: input.email,
    phone: input.phone,
    landline: input.landline ?? null,
    address: {
      ...input.address,
      postalCode: input.address.postalCode
        ? normalizePostalCode(input.address.postalCode)
        : input.address.postalCode,
    },
    government_id_type: input.governmentIdType ?? null,
    government_id_number: input.governmentIdNumber ?? null,
    // Company-stated membership fields, stored verbatim (migration
    // 20261130000001). TIN values are write-only: masked on read, never
    // logged (see toCustomer + audit call below).
    ra_number: input.raNumber ?? null,
    company_status: input.companyStatus ?? null,
    citizenship: input.citizenship ?? null,
    civil_status: input.civilStatus ?? null,
    tin_number: input.tinNumber ?? null,
    occupation_business_name: input.occupationBusinessName ?? null,
    office_business_address: input.officeBusinessAddress ?? null,
    employed_position: input.employedPosition ?? null,
    supplementary_full_name:
      input.supplementaryFullName === undefined
        ? null
        : normalizePersonName(input.supplementaryFullName),
    supplementary_address: input.supplementaryAddress ?? null,
    supplementary_birthday: input.supplementaryBirthday ?? null,
    supplementary_gender: input.supplementaryGender ?? null,
    supplementary_citizenship: input.supplementaryCitizenship ?? null,
    supplementary_civil_status: input.supplementaryCivilStatus ?? null,
    supplementary_tin_number: input.supplementaryTinNumber ?? null,
    supplementary_mobile:
      input.supplementaryMobile === undefined
        ? null
        : (normalizePhilippinePhone(input.supplementaryMobile) ?? input.supplementaryMobile),
    supplementary_email: input.supplementaryEmail ?? null,
    supplementary_landline: input.supplementaryLandline ?? null,
    supplementary_occupation_business_name: input.supplementaryOccupationBusinessName ?? null,
    supplementary_office_address: input.supplementaryOfficeAddress ?? null,
    supplementary_position: input.supplementaryPosition ?? null,
    svd_name: input.svdName ?? null,
    ssm_name: input.ssmName ?? null,
    sm_name: input.smName ?? null,
    referrer_name: input.referrerName ?? null,
    vip_recommender_name: input.vipRecommenderName ?? null,
    related_contact_no:
      input.relatedContactNo === undefined
        ? null
        : (normalizePhilippinePhone(input.relatedContactNo) ?? input.relatedContactNo),
    related_email: input.relatedEmail ?? null,
    // Company-stated package/payment facts, verbatim. Never inputs to
    // server-computed totals; activation and verification read payment
    // rows only (migration 20261130000001).
    stated_vip_package: input.statedVipPackage ?? null,
    stated_payment_terms: input.statedPaymentTerms ?? null,
    stated_regular_price: input.statedRegularPrice ?? null,
    stated_discount: input.statedDiscount ?? null,
    stated_total_amount: input.statedTotalAmount ?? null,
    stated_rf: input.statedRf ?? null,
    stated_payment_type: input.statedPaymentType ?? null,
    stated_ref_no: input.statedRefNo ?? null,
    stated_payment_date: input.statedPaymentDate ?? null,
    registration_source: 'seller_created',
    created_by: actorId,
    // The registering seller is the referrer of record. Server-resolved
    // from the session, never from the browser: there is no referrer
    // field in the request schema to spoof.
    referred_by_staff_id: actorId,
    referral_code_used: input.referralCode ?? null,
    notes: input.notes ?? null,
    status: 'prospect',
  };
}

export function customerUpdatePatch(p: UpdateCustomerRequest) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (p.firstName !== undefined) patch.first_name = p.firstName;
  if (p.middleName !== undefined)
    patch.middle_name = p.middleName === null ? null : normalizePersonName(p.middleName);
  if (p.lastName !== undefined) patch.last_name = p.lastName;
  if (p.suffix !== undefined)
    patch.suffix = p.suffix === null ? null : normalizePersonName(p.suffix);
  if (p.gender !== undefined) patch.gender = p.gender;
  if (p.dateOfBirth !== undefined) patch.birth_date = p.dateOfBirth;
  if (p.email !== undefined) patch.email = p.email;
  if (p.phone !== undefined) patch.phone = normalizePhilippinePhone(p.phone) ?? p.phone;
  if (p.landline !== undefined) patch.landline = p.landline;
  if (p.address !== undefined)
    patch.address = {
      ...p.address,
      postalCode: p.address.postalCode
        ? normalizePostalCode(p.address.postalCode)
        : p.address.postalCode,
    };
  if (p.governmentIdType !== undefined) patch.government_id_type = p.governmentIdType;
  if (p.governmentIdNumber !== undefined) patch.government_id_number = p.governmentIdNumber;
  if (p.raNumber !== undefined) patch.ra_number = p.raNumber;
  if (p.companyStatus !== undefined) patch.company_status = p.companyStatus;
  if (p.citizenship !== undefined) patch.citizenship = p.citizenship;
  if (p.civilStatus !== undefined) patch.civil_status = p.civilStatus;
  if (p.tinNumber !== undefined) patch.tin_number = p.tinNumber;
  if (p.occupationBusinessName !== undefined)
    patch.occupation_business_name = p.occupationBusinessName;
  if (p.officeBusinessAddress !== undefined)
    patch.office_business_address = p.officeBusinessAddress;
  if (p.employedPosition !== undefined) patch.employed_position = p.employedPosition;
  if (p.supplementaryFullName !== undefined)
    patch.supplementary_full_name =
      p.supplementaryFullName === null ? null : normalizePersonName(p.supplementaryFullName);
  if (p.supplementaryAddress !== undefined) patch.supplementary_address = p.supplementaryAddress;
  if (p.supplementaryBirthday !== undefined) patch.supplementary_birthday = p.supplementaryBirthday;
  if (p.supplementaryGender !== undefined) patch.supplementary_gender = p.supplementaryGender;
  if (p.supplementaryCitizenship !== undefined)
    patch.supplementary_citizenship = p.supplementaryCitizenship;
  if (p.supplementaryCivilStatus !== undefined)
    patch.supplementary_civil_status = p.supplementaryCivilStatus;
  if (p.supplementaryTinNumber !== undefined)
    patch.supplementary_tin_number = p.supplementaryTinNumber;
  if (p.supplementaryMobile !== undefined)
    patch.supplementary_mobile =
      p.supplementaryMobile === null
        ? null
        : (normalizePhilippinePhone(p.supplementaryMobile) ?? p.supplementaryMobile);
  if (p.supplementaryEmail !== undefined) patch.supplementary_email = p.supplementaryEmail;
  if (p.supplementaryLandline !== undefined) patch.supplementary_landline = p.supplementaryLandline;
  if (p.supplementaryOccupationBusinessName !== undefined)
    patch.supplementary_occupation_business_name = p.supplementaryOccupationBusinessName;
  if (p.supplementaryOfficeAddress !== undefined)
    patch.supplementary_office_address = p.supplementaryOfficeAddress;
  if (p.supplementaryPosition !== undefined) patch.supplementary_position = p.supplementaryPosition;
  if (p.svdName !== undefined) patch.svd_name = p.svdName;
  if (p.ssmName !== undefined) patch.ssm_name = p.ssmName;
  if (p.smName !== undefined) patch.sm_name = p.smName;
  if (p.referrerName !== undefined) patch.referrer_name = p.referrerName;
  if (p.vipRecommenderName !== undefined) patch.vip_recommender_name = p.vipRecommenderName;
  if (p.relatedContactNo !== undefined)
    patch.related_contact_no =
      p.relatedContactNo === null
        ? null
        : (normalizePhilippinePhone(p.relatedContactNo) ?? p.relatedContactNo);
  if (p.relatedEmail !== undefined) patch.related_email = p.relatedEmail;
  if (p.statedVipPackage !== undefined) patch.stated_vip_package = p.statedVipPackage;
  if (p.statedPaymentTerms !== undefined) patch.stated_payment_terms = p.statedPaymentTerms;
  if (p.statedRegularPrice !== undefined) patch.stated_regular_price = p.statedRegularPrice;
  if (p.statedDiscount !== undefined) patch.stated_discount = p.statedDiscount;
  if (p.statedTotalAmount !== undefined) patch.stated_total_amount = p.statedTotalAmount;
  if (p.statedRf !== undefined) patch.stated_rf = p.statedRf;
  if (p.statedPaymentType !== undefined) patch.stated_payment_type = p.statedPaymentType;
  if (p.statedRefNo !== undefined) patch.stated_ref_no = p.statedRefNo;
  if (p.statedPaymentDate !== undefined) patch.stated_payment_date = p.statedPaymentDate;
  if (p.vipCardNumber !== undefined) patch.vip_card_number = p.vipCardNumber;
  if (p.status !== undefined) patch.status = p.status;
  if (p.notes !== undefined) patch.notes = p.notes;
  return patch;
}
