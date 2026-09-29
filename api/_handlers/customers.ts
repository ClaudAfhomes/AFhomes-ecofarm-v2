/**
 * AF Homes customer master records.
 *
 * Sensitive fields are write-only: `governmentIdNumber` is accepted on create
 * and update, stored, and NEVER returned. The read model exposes a mask.
 * Document images live in a private bucket and are addressed by path only.
 */
import { z } from 'zod';
import { createCustomerSchema, maskGovernmentId, updateCustomerSchema } from '@jad/contracts';

import { authorizeAfHomes } from '../_lib/afhomes-access.js';
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
const toCustomer = (row: Record<string, unknown>) => ({
  id: row.id,
  customerNumber: row.customer_number,
  fullName: fullName(row),
  email: row.email,
  phone: row.phone,
  dateOfBirth: isoOrNull(row.birth_date),
  gender: isoOrNull(row.gender),
  address: row.address ?? null,
  governmentIdType: isoOrNull(row.government_id_type),
  governmentIdMasked: maskGovernmentId(isoOrNull(row.government_id_number)),
  status: row.status,
  createdBy: isoOrNull(row.created_by),
  createdAt: isoOrNull(row.created_at) ?? '',
  updatedAt: isoOrNull(row.updated_at) ?? '',
});

const listQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.string().trim().max(30).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const parseListQuery = (req: VercelRequest) => listQuerySchema.safeParse(req.query);

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
    if (subPath(req) === '' && method(req) === 'GET') {
      const auth = await authorizeAfHomes(req, 'sales.customers');
      if ('error' in auth) return deny(res, auth);

      const parsed = parseListQuery(req);
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid list query', 400);
      const { search, status, limit, offset } = parsed.data;

      let query = db.from('customers').select('*', { count: 'exact' });
      if (status) query = query.eq('status', status);
      if (search) {
        // Postgres full-text style OR across the name parts, email and number.
        const term = `%${search.replace(/[%_]/g, '')}%`;
        query = query.or(
          `first_name.ilike.${term},middle_name.ilike.${term},last_name.ilike.${term},email.ilike.${term},customer_number.ilike.${term}`,
        );
      }
      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw error;
      return res.status(200).json({
        data: (data ?? []).map(toCustomer),
        meta: { total: count ?? (data ?? []).length, limit, offset },
      });
    }

    if (subPath(req) === '' && method(req) === 'POST') {
      const auth = await authorizeAfHomes(req, 'sales.customers', 'create');
      if ('error' in auth) return deny(res, auth);

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
        middle_name: input.middleName ?? null,
        last_name: input.lastName,
        suffix: input.suffix ?? null,
        birth_date: input.dateOfBirth,
        gender: input.gender ?? null,
        email: input.email,
        phone: input.phone,
        address: input.address,
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
      const { data, error } = await db
        .from('customers')
        .select('*')
        .eq('id', detail[1]!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return fail(res, 'NOT_FOUND', 'Customer not found', 404);
      return res.status(200).json(toCustomer(data as Record<string, unknown>));
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
      if (p.middleName !== undefined) patch.middle_name = p.middleName;
      if (p.lastName !== undefined) patch.last_name = p.lastName;
      if (p.suffix !== undefined) patch.suffix = p.suffix;
      if (p.gender !== undefined) patch.gender = p.gender;
      if (p.email !== undefined) patch.email = p.email;
      if (p.phone !== undefined) patch.phone = p.phone;
      if (p.address !== undefined) patch.address = p.address;
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
      const auth = await authorizeAfHomes(req, 'finance.card_activation', 'update');
      if ('error' in auth) return deny(res, auth);
      const id = token[1]!;

      const { data: customer, error: readError } = await db
        .from('customers')
        .select('id, email, status')
        .eq('id', id)
        .maybeSingle();
      if (readError) throw readError;
      if (!customer) return fail(res, 'NOT_FOUND', 'Customer not found', 404);

      const body = (jsonBody(req) ?? {}) as { purpose?: string; validHours?: number };
      const purpose = body.purpose === 'password_reset' ? 'password_reset' : 'account_activation';
      const validHours = Number.isInteger(body.validHours)
        ? Math.min(Math.max(body.validHours!, 1), 168)
        : 72;

      // Raw token is generated here, returned once, and only its hash stored.
      const { data: issued, error } = await db.rpc('issue_customer_onboarding_token', {
        p_customer_id: id,
        p_purpose: purpose,
        p_valid_hours: validHours,
        p_actor_id: auth.userId,
      });
      if (error) return mapRpcError(res, error);
      // issue_customer_onboarding_token() is RETURNS TABLE, so live
      // PostgREST answers with a one-row array. The raw token is a
      // credential: required byte-exact (never trimmed) and non-empty.
      const issuedRow = singleRpcRow(issued);
      const rawToken = issuedRow?.token;
      if (typeof rawToken !== 'string' || rawToken.length === 0)
        return fail(res, 'INTERNAL', 'Token issue failed', 500);
      const result = { token: rawToken, expires_at: issuedRow?.expires_at };

      await audit(db, auth.userId, 'CUSTOMER_ONBOARDING_TOKEN_ISSUED', 'customer', id, null, {
        purpose,
        validHours,
        expiresAt: result.expires_at ?? null,
      });
      // The token is returned to the authorized staff member exactly once.
      return res
        .status(201)
        .json({ token: result.token, purpose, expiresAt: result.expires_at ?? null });
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
