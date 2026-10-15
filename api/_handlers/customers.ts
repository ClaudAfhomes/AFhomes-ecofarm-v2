import { customerDirectory } from '../_lib/customer-directory.js';
/**
 * AFHomes customer master records.
 *
 * Sensitive fields are write-only: `governmentIdNumber` is accepted on create
 * and update, stored, and NEVER returned. The read model exposes a mask.
 * Document images live in a private bucket and are addressed by path only.
 */
import { z } from 'zod';
import {
  createCustomerSchema,
  maskGovernmentId,
  normalizeAddressField,
  normalizePersonName,
  normalizePhilippinePhone,
  normalizePostalCode,
  updateCustomerSchema,
  customerCategorySchema,
} from '@afhomes/contracts';

import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import { isSellingRole } from '../_lib/commerce.js';
import { DEFAULT_ONBOARDING_TOKEN_VALID_HOURS } from '../_lib/constants.js';
import * as onboardingEmail from '../_lib/customer-onboarding-email.js';
import { customerActivationUrl } from '../_lib/customer-onboarding-url.js';
import {
  audit,
  deny,
  fail,
  isoOrNull,
  jsonBody,
  type Db,
  list,
  mapRpcError,
  method,
  route,
  singleRpcRow,
  singleRpcText,
  subPath,
} from '../_lib/handler-kit.js';
import { serviceClient } from '../_lib/rest.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

const fullName = (row: Record<string, unknown>) =>
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

const toCustomer = (row: Record<string, unknown>) => ({
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
  // Company-stated membership fields. TIN values are masked exactly like the
  // government ID: the raw numbers never leave the database through this API.
  tinNumberMasked: maskGovernmentId(isoOrNull(row.tin_number)),
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
  ostIstName: isoOrNull(row.ost_ist_name),
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
  derivedCategory: row.derivedCategory,
  portalAccountActivated:
    typeof row.auth_user_id === 'string' && row.auth_user_id.trim().length > 0,
  createdBy: isoOrNull(row.created_by),
  createdAt: isoOrNull(row.created_at) ?? '',
  updatedAt: isoOrNull(row.updated_at) ?? '',
});

const listQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.string().trim().max(30).optional(),
  payment: z.enum(['no_payment', 'partially_paid', 'fully_paid']).optional(),
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
const parseListQuery = (req: VercelRequest) => listQuerySchema.safeParse(req.query);

/**
 * Customer/card-sale referrer validation.
 *
 * The registering seller is the referrer of record, so they must hold a role
 * allowed to register and sell AFHomes VIP cards (VD, SSM, SM, OST, Admin,
 * Super Admin - see `SELLING_ROLES` in `commerce.ts`). This is deliberately
 * NOT the OST sponsorship check: an OST referral code requires an active
 * Sales Manager, while a customer referral requires a seller of record.
 */
export function validateCustomerSaleReferrer(roleSlug: string): string | null {
  if (isSellingRole(roleSlug)) return null;
  return (
    'Customer registration requires a selling role ' +
    '(Vice Director, Senior Sales Manager, Sales Manager, OST, Admin or Super Admin).'
  );
}

async function hasReference(db: Db, table: string, column: string, id: string) {
  const { data, error } = await db.from(table).select('id').eq(column, id).limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

async function customerDeleteBlockers(db: Db, id: string): Promise<string[]> {
  // Every table with a RESTRICT (or NO ACTION) foreign key to customers(id).
  // customer_onboarding_tokens is deliberately absent: those ephemeral rows
  // are removed by the delete handler itself before the customer row goes.
  // An incomplete list fails loudly as a raw 23503 instead of the 409 below,
  // which is why this list must track every inbound customer FK in
  // supabase/migrations.
  const checks: Array<[string, string, string]> = [
    ['sales', 'card_sales', 'customer_id'],
    ['payments', 'payments', 'customer_id'],
    ['memberships', 'memberships', 'customer_id'],
    ['redemptions', 'redemptions', 'customer_id'],
    ['documents', 'identity_documents', 'customer_id'],
    ['applications', 'customer_applications', 'customer_id'],
    ['purchase_terms', 'customer_application_purchase_terms', 'customer_id'],
    ['reservations', 'reservation_agreements', 'customer_id'],
    ['imports', 'customer_import_rows', 'customer_id'],
    ['purchases', 'purchases', 'customer_id'],
    ['earning_claims', 'earning_claims', 'customer_id'],
    ['redemption_approvals', 'redemption_quotes', 'approval_customer_id'],
  ];
  const results = await Promise.all(
    checks.map(async ([label, table, column]) => ({
      label,
      blocked: await hasReference(db, table, column, id),
    })),
  );
  return results.filter((result) => result.blocked).map((result) => result.label);
}

async function removeCustomerAuth(db: Db, authUserId: string | null | undefined) {
  if (!authUserId) return;
  const { error } = await db.auth.admin.deleteUser(authUserId);
  if (error) throw error;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);

  try {
    if (subPath(req) === 'filter-options' && method(req) === 'GET') {
      const auth = await authorizeAfHomes(req, 'sales.customers');
      if ('error' in auth) return deny(res, auth);
      const { data, error } = await db
        .from('staff_users')
        .select('id,full_name')
        .eq('status', 'active')
        .order('full_name');
      if (error) throw error;
      return res.status(200).json({
        data: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
          id: r.id,
          name: r.full_name,
        })),
        meta: { total: (data ?? []).length },
      });
    }
    if (subPath(req) === '' && method(req) === 'GET') {
      const auth = await authorizeAfHomes(req, 'sales.customers');
      if ('error' in auth) return deny(res, auth);

      const parsed = parseListQuery(req);
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid list query', 400);
      const { limit, offset } = parsed.data;
      const directory = await customerDirectory(db, parsed.data);
      return res.status(200).json({
        data: directory.map((row) => toCustomer(row.record)),
        meta: { total: directory[0]?.total_count ?? 0, limit, offset },
      });
    }

    if (subPath(req) === '' && method(req) === 'POST') {
      const auth = await authorizeAfHomes(req, 'sales.customers', 'create');
      if ('error' in auth) return deny(res, auth);

      // Customer/card-sale referrer validation. The registering seller is the
      // referrer of record, so they must hold a role allowed to register and
      // sell AFHomes VIP cards (VD, SSM, SM, OST, Admin, Super Admin). This
      // is deliberately NOT the OST sponsorship check: an OST referral code
      // requires an active Sales Manager, while a customer referral requires
      // a seller of record. Never route this flow through `validateOstSponsor`.
      const referrerRejection = validateCustomerSaleReferrer(auth.roleSlug);
      if (referrerRejection) {
        return fail(res, 'FORBIDDEN', referrerRejection, 403);
      }

      const parsed = createCustomerSchema.safeParse(jsonBody(req));
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid customer details', 400);
      const input = parsed.data;

      // BR-RATE-06: invalid inputs generate no customer number. A duplicate
      // government ID or email is checked before the sequence is consumed, so
      // a rejected registration burns no number. The unique constraint on the
      // insert below stays as the race net for concurrent duplicates.
      if (input.governmentIdNumber) {
        const { data: govDup, error: govError } = await db
          .from('customers')
          .select('id')
          .eq('government_id_number', input.governmentIdNumber)
          .maybeSingle();
        if (govError) throw govError;
        if (govDup)
          return fail(
            res,
            'CONFLICT',
            'A customer with that government ID or email already exists',
            409,
          );
      }
      if (input.email) {
        const { data: emailDup, error: emailError } = await db
          .from('customers')
          .select('id')
          .eq('email', input.email)
          .maybeSingle();
        if (emailError) throw emailError;
        if (emailDup)
          return fail(
            res,
            'CONFLICT',
            'A customer with that government ID or email already exists',
            409,
          );
      }

      const { data: sequence, error: seqError } = await db.rpc('next_customer_number');
      if (seqError) return mapRpcError(res, seqError);
      // next_customer_number() is RETURNS TABLE, so live PostgREST answers
      // with a one-row array. Fail BEFORE the insert, never persist a blank.
      const customerNumber = singleRpcText(sequence, 'customer_number');
      if (!customerNumber) return fail(res, 'INTERNAL', 'Customer number generation failed', 500);

      const row = {
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
        ost_ist_name: input.ostIstName ?? null,
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
        created_by: auth.userId,
        // The registering seller is the referrer of record. Server-resolved
        // from the session, never from the browser: there is no referrer
        // field in the request schema to spoof.
        referred_by_staff_id: auth.userId,
        referral_code_used: input.referralCode ?? null,
        notes: input.notes ?? null,
        status: 'prospect',
      };

      const { data, error } = await db.from('customers').insert(row).select('*').single();
      if (error) {
        if ((error as { code?: string }).code === '23505')
          return fail(
            res,
            'CONFLICT',
            'A customer with that government ID or email already exists',
            409,
          );
        throw error;
      }

      await audit(
        db,
        auth.userId,
        'CUSTOMER_CREATED',
        'customer',
        String((data as { id: string }).id),
        null,
        // Never place the government ID number in the audit trail.
        { customerNumber, email: input.email, createdBy: auth.userId },
      );
      return res.status(201).json(toCustomer(data as Record<string, unknown>));
    }

    const detail = route(req, 'GET', /^([0-9a-f-]+)$/);
    if (detail) {
      const auth = await authorizeAfHomes(req, 'sales.customers');
      if ('error' in auth) return deny(res, auth);
      // Same RPC as the list, narrowed to one row, so the detail view can
      // never disagree with the directory about derived category, membership
      // state, or the masked government ID (the only form ever returned).
      const directory = await customerDirectory(db, { id: detail[1] });
      const row = directory[0];
      if (!row) return fail(res, 'NOT_FOUND', 'Customer not found', 404);
      return res.status(200).json(toCustomer(row.record));
    }

    const update = route(req, 'PATCH', /^([0-9a-f-]+)$/);
    if (update) {
      const auth = await authorizeAfHomes(req, 'sales.customers', 'update');
      if ('error' in auth) return deny(res, auth);
      const id = update[1]!;
      const parsed = updateCustomerSchema.safeParse(jsonBody(req));
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid customer update', 400);

      const { data: before, error: readError } = await db
        .from('customers')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (readError) throw readError;
      if (!before) return fail(res, 'NOT_FOUND', 'Customer not found', 404);

      const p = parsed.data;
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (p.firstName !== undefined) patch.first_name = p.firstName;
      if (p.middleName !== undefined)
        patch.middle_name = p.middleName === null ? null : normalizePersonName(p.middleName);
      if (p.lastName !== undefined) patch.last_name = p.lastName;
      if (p.suffix !== undefined)
        patch.suffix = p.suffix === null ? null : normalizePersonName(p.suffix);
      if (p.gender !== undefined) patch.gender = p.gender;
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
      if (p.supplementaryBirthday !== undefined)
        patch.supplementary_birthday = p.supplementaryBirthday;
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
      if (p.supplementaryLandline !== undefined)
        patch.supplementary_landline = p.supplementaryLandline;
      if (p.supplementaryOccupationBusinessName !== undefined)
        patch.supplementary_occupation_business_name = p.supplementaryOccupationBusinessName;
      if (p.supplementaryOfficeAddress !== undefined)
        patch.supplementary_office_address = p.supplementaryOfficeAddress;
      if (p.supplementaryPosition !== undefined)
        patch.supplementary_position = p.supplementaryPosition;
      if (p.ostIstName !== undefined) patch.ost_ist_name = p.ostIstName;
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
      if (p.status !== undefined) patch.status = p.status;
      if (p.notes !== undefined) patch.notes = p.notes;

      const { error: writeError } = await db.from('customers').update(patch).eq('id', id);
      if (writeError) {
        if ((writeError as { code?: string }).code === '23505')
          return fail(res, 'CONFLICT', 'That government ID is already registered', 409);
        throw writeError;
      }

      await audit(
        db,
        auth.userId,
        'CUSTOMER_EDITED',
        'customer',
        id,
        // Masked before/after so the audit trail holds no government ID number.
        { fullName: fullName(before as Record<string, unknown>), status: before.status },
        {
          fields: Object.keys(p),
          fullName: fullName({ ...(before as Record<string, unknown>), ...patch }),
          status: patch.status ?? before.status,
        },
      );
      const { data: after, error: afterError } = await db
        .from('customers')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (afterError) throw afterError;
      return res.status(200).json(toCustomer(after as Record<string, unknown>));
    }

    const token = route(req, 'POST', /^([0-9a-f-]+)\/onboarding-token$/);
    if (token) {
      const auth = await authorizeAfHomes(req, 'sales.customers', 'update');
      if ('error' in auth) return deny(res, auth);
      const id = token[1]!;

      const { data: customer, error: readError } = await db
        .from('customers')
        .select('id, email, first_name, middle_name, last_name, suffix, status, auth_user_id')
        .eq('id', id)
        .maybeSingle();
      if (readError) throw readError;
      if (!customer) return fail(res, 'NOT_FOUND', 'Customer not found', 404);

      if (customer.auth_user_id) {
        return fail(res, 'CONFLICT', 'Customer portal account is already activated', 409);
      }
      if (customer.status !== 'active') {
        return fail(res, 'CONFLICT', 'Customer must be active before account activation', 409);
      }

      const { data: membership, error: membershipError } = await db
        .from('memberships')
        .select('id, membership_number, status')
        .eq('customer_id', id)
        .eq('status', 'active')
        .order('activated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) return fail(res, 'CONFLICT', 'Customer has no active membership', 409);

      // Refuse before rotating an existing token if the server cannot produce
      // the only recoverable plaintext form: the fragment-based activation URL.
      if (!customerActivationUrl('configuration-check')) {
        return fail(res, 'INTERNAL', 'Customer portal URL is not configured', 500);
      }

      // Raw token is generated here, returned once, and only its hash stored.
      const { data: issued, error } = await db.rpc('issue_customer_onboarding_token', {
        p_customer_id: id,
        p_purpose: 'account_activation',
        p_valid_hours: DEFAULT_ONBOARDING_TOKEN_VALID_HOURS,
        p_actor_id: auth.userId,
      });
      if (error) return mapRpcError(res, error);
      // issue_customer_onboarding_token() is RETURNS TABLE, so live
      // PostgREST answers with a one-row array. The raw token is a
      // credential: required byte-exact (never trimmed) and non-empty.
      const issuedRow = singleRpcRow(issued);
      const rawToken = issuedRow?.token;
      const expiresAt = issuedRow?.expires_at;
      if (typeof rawToken !== 'string' || rawToken.length === 0 || typeof expiresAt !== 'string')
        return fail(res, 'INTERNAL', 'Token issue failed', 500);
      const activationUrl = customerActivationUrl(rawToken);
      if (!activationUrl) return fail(res, 'INTERNAL', 'Activation link generation failed', 500);

      const customerName = [
        customer.first_name,
        customer.middle_name,
        customer.last_name,
        customer.suffix,
      ]
        .filter((part): part is string => typeof part === 'string' && part.length > 0)
        .join(' ');
      const delivery = await onboardingEmail.sendCustomerOnboardingEmail({
        to: String(customer.email ?? ''),
        customerName,
        membershipNumber: String(membership.membership_number ?? ''),
        activationUrl,
        expiresAt,
      });
      const emailStatus = delivery.status === 'sent' ? 'sent' : 'failed';
      const status = delivery.status === 'sent' ? 'email_sent' : 'manual_required';

      // Token issuance is already committed. Audit failure must not discard the
      // sole authorized response containing the one-time activation link.
      try {
        await audit(db, auth.userId, 'CUSTOMER_ONBOARDING_TOKEN_ISSUED', 'customer', id, null, {
          customerId: id,
          purpose: 'account_activation',
          validHours: DEFAULT_ONBOARDING_TOKEN_VALID_HOURS,
          expiresAt,
          deliveryStatus: emailStatus,
        });
        await audit(
          db,
          auth.userId,
          emailStatus === 'sent'
            ? 'CUSTOMER_ACTIVATION_EMAIL_SENT'
            : 'CUSTOMER_ACTIVATION_EMAIL_FAILED',
          'customer',
          id,
          null,
          { customerId: id, purpose: 'account_activation', expiresAt, deliveryStatus: emailStatus },
        );
      } catch {
        console.error('[api] customers: onboarding audit write failed');
      }

      return res.status(201).json({
        status,
        emailStatus,
        email: customer.email,
        activationUrl,
        expiresAt,
      });
    }

    const deactivate = route(req, 'POST', /^([0-9a-f-]+)\/deactivate$/);
    if (deactivate) {
      const auth = await authorizeAfHomes(req, 'sales.customers', 'update');
      if ('error' in auth) return deny(res, auth);
      const id = deactivate[1]!;
      const { data: before, error: readError } = await db
        .from('customers')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (readError) throw readError;
      if (!before) return fail(res, 'NOT_FOUND', 'Customer not found', 404);
      await db.from('customer_onboarding_tokens').delete().eq('customer_id', id);
      const { error } = await db
        .from('customers')
        .update({ status: 'suspended', auth_user_id: null, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      await removeCustomerAuth(db, before.auth_user_id);
      await audit(
        db,
        auth.userId,
        'CUSTOMER_DEACTIVATED',
        'customer',
        id,
        {
          status: before.status,
        },
        { status: 'suspended', loginRemoved: true },
      );
      return res.status(200).json({ deactivated: true });
    }

    const anonymize = route(req, 'POST', /^([0-9a-f-]+)\/anonymize$/);
    if (anonymize) {
      const auth = await authorizeAfHomes(req, 'sales.customers', 'delete');
      if ('error' in auth) return deny(res, auth);
      if (auth.roleSlug !== 'super_admin')
        return fail(res, 'FORBIDDEN', 'Only Super Admin can anonymize customers', 403);
      const id = anonymize[1]!;
      const { data: before, error: readError } = await db
        .from('customers')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (readError) throw readError;
      if (!before) return fail(res, 'NOT_FOUND', 'Customer not found', 404);
      const suffix = id.replace(/-/g, '').slice(0, 20);
      await db.from('customer_onboarding_tokens').delete().eq('customer_id', id);
      const { error } = await db
        .from('customers')
        .update({
          first_name: 'Deleted',
          middle_name: null,
          last_name: 'Customer',
          suffix: null,
          email: `deleted+${suffix}@invalid.local`,
          phone: '0000000',
          landline: null,
          birth_date: null,
          gender: null,
          address: {},
          government_id_type: null,
          government_id_number: null,
          notes: null,
          // Company-stated fields are customer PII too: anonymize clears them
          // so an anonymized record cannot keep a TIN, a related-person
          // contact or stated figures behind.
          ra_number: null,
          company_status: null,
          citizenship: null,
          civil_status: null,
          tin_number: null,
          occupation_business_name: null,
          office_business_address: null,
          employed_position: null,
          supplementary_full_name: null,
          supplementary_address: null,
          supplementary_birthday: null,
          supplementary_gender: null,
          supplementary_citizenship: null,
          supplementary_civil_status: null,
          supplementary_tin_number: null,
          supplementary_mobile: null,
          supplementary_email: null,
          supplementary_landline: null,
          supplementary_occupation_business_name: null,
          supplementary_office_address: null,
          supplementary_position: null,
          ost_ist_name: null,
          svd_name: null,
          ssm_name: null,
          sm_name: null,
          referrer_name: null,
          vip_recommender_name: null,
          related_contact_no: null,
          related_email: null,
          stated_vip_package: null,
          stated_payment_terms: null,
          stated_regular_price: null,
          stated_discount: null,
          stated_total_amount: null,
          stated_rf: null,
          stated_payment_type: null,
          stated_ref_no: null,
          stated_payment_date: null,
          auth_user_id: null,
          status: 'cancelled',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;
      await removeCustomerAuth(db, before.auth_user_id);
      await audit(
        db,
        auth.userId,
        'CUSTOMER_ANONYMIZED',
        'customer',
        id,
        {
          status: before.status,
        },
        {
          status: 'cancelled',
          directProfilePiiRemoved: true,
          companyStatedFieldsRemoved: true,
          identityDocumentsRetainedPendingPolicy: true,
        },
      );
      return res.status(200).json({ anonymized: true });
    }

    const remove = route(req, 'DELETE', /^([0-9a-f-]+)$/);
    if (remove) {
      const auth = await authorizeAfHomes(req, 'sales.customers', 'delete');
      if ('error' in auth) return deny(res, auth);
      if (auth.roleSlug !== 'super_admin')
        return fail(res, 'FORBIDDEN', 'Only Super Admin can permanently delete customers', 403);
      const id = remove[1]!;
      const { data: before, error: readError } = await db
        .from('customers')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (readError) throw readError;
      if (!before) return fail(res, 'NOT_FOUND', 'Customer not found', 404);
      const blockers = await customerDeleteBlockers(db, id);
      if (blockers.length)
        return res.status(409).json({
          error: {
            code: 'PROTECTED_HISTORY',
            message:
              'This customer has historical business records and cannot be permanently deleted. Deactivate or anonymize the account instead.',
            details: { canDelete: false, blockers },
          },
        });
      await db.from('customer_onboarding_tokens').delete().eq('customer_id', id);
      const { error: deleteError } = await db.from('customers').delete().eq('id', id);
      if (deleteError) throw deleteError;
      await removeCustomerAuth(db, before.auth_user_id);
      await audit(
        db,
        auth.userId,
        'CUSTOMER_DELETED',
        'customer',
        id,
        {
          customerNumber: before.customer_number,
        },
        { deleted: true },
      );
      return res.status(200).json({ deleted: true });
    }

    return fail(res, 'NOT_FOUND', 'Customer endpoint not found', 404);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[api] customers:', error instanceof Error ? error.message : error);
    mapRpcError(res, error as { message?: string });
  }
}
