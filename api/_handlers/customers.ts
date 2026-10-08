import { customerDirectory } from '../_lib/customer-directory.js';
/**
 * AF Homes customer master records.
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
  email: row.email,
  phone: row.phone,
  dateOfBirth: isoOrNull(row.birth_date),
  gender: isoOrNull(row.gender),
  address: row.address ?? null,
  governmentIdType: isoOrNull(row.government_id_type),
  governmentIdMasked:
    isoOrNull(row.government_id_masked) ?? maskGovernmentId(isoOrNull(row.government_id_number)),
  status: row.status,
  hasActiveMembership: customerHasActiveMembership(row),
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
 * allowed to register and sell AF Homes VIP cards (VD, SSM, SM, OST, Admin,
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
  const checks: Array<[string, string, string]> = [
    ['sales', 'card_sales', 'customer_id'],
    ['payments', 'payments', 'customer_id'],
    ['memberships', 'memberships', 'customer_id'],
    ['redemptions', 'redemptions', 'customer_id'],
    ['documents', 'identity_documents', 'customer_id'],
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
      // sell AF Homes VIP cards (VD, SSM, SM, OST, Admin, Super Admin). This
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
        address: {
          ...input.address,
          postalCode: input.address.postalCode
            ? normalizePostalCode(input.address.postalCode)
            : input.address.postalCode,
        },
        government_id_type: input.governmentIdType ?? null,
        government_id_number: input.governmentIdNumber ?? null,
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
      if (p.address !== undefined)
        patch.address = {
          ...p.address,
          postalCode: p.address.postalCode
            ? normalizePostalCode(p.address.postalCode)
            : p.address.postalCode,
        };
      if (p.governmentIdType !== undefined) patch.government_id_type = p.governmentIdType;
      if (p.governmentIdNumber !== undefined) patch.government_id_number = p.governmentIdNumber;
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
          birth_date: null,
          gender: null,
          address: {},
          government_id_type: null,
          government_id_number: null,
          notes: null,
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
