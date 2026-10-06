import { customerDirectory } from '../_lib/customer-directory.js';
import { customerLookupFromDirectory, memberLookupFromDirectory } from '../_lib/member-lookup.js';
/**
 * AF Homes memberships (cards), identifier resolution, and the points ledger.
 *
 * An identifier NEVER authorizes anything. `GET /memberships/resolve` is the one
 * place a scanned QR token or a typed fallback code becomes a membership row,
 * and it returns only status/points - the caller must still be authorized and
 * must still check status and balance. The QR token is a 256-bit random value
 * with no customer data of any kind encoded in it.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';

import {
  markedPrintedSchema,
  membershipCardSchema,
  reissueMembershipCardSchema,
  reissuedMembershipCardSchema,
} from '@jad/contracts';

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
  subPath,
} from '../_lib/handler-kit.js';
import { cardQrPayload, extractMembershipNumber } from '../_lib/identifier.js';
import { serviceClient } from '../_lib/rest.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

/** Must match private.hash_token() in the migration exactly. */
export const hashIdentifier = (value: string) => createHash('sha256').update(value).digest('hex');

type CategoryInfo = { name: string | null };
type IssuerInfo = { name: string | null };
type SchemeInfo = { paymentScheme: string | null; validityMonths: number | null };

const toMembership = (
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

const SELECT_MEMBERSHIP =
  '*, customers!inner(first_name, middle_name, last_name, suffix, status), card_plans!inner(name,category_id)';

const SELECT_CARD =
  '*, customers!inner(first_name, middle_name, last_name, suffix, status), card_plans!inner(name, code, category_id)';

/** Category names for plan rows (the plan embed carries no category). */
async function categoryDirectory(db: Db): Promise<Map<string, CategoryInfo>> {
  const { data, error } = await db.from('card_categories').select('id,name');
  if (error) throw error;
  const out = new Map<string, CategoryInfo>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    out.set(String(row.id), { name: (row.name as string | null) ?? null });
  }
  return out;
}

/** Frozen scheme + validity per sale, for membership display (never economics). */
async function saleSchemeDirectory(db: Db, saleIds: string[]): Promise<Map<string, SchemeInfo>> {
  const out = new Map<string, SchemeInfo>();
  const distinct = [...new Set(saleIds.filter((id) => id))];
  if (distinct.length === 0) return out;
  const { data, error } = await db
    .from('card_sales')
    .select('id,payment_scheme,validity_months_snapshot')
    .in('id', distinct);
  if (error) throw error;
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const months =
      row.validity_months_snapshot === null || row.validity_months_snapshot === undefined
        ? null
        : Number(row.validity_months_snapshot);
    out.set(String(row.id), {
      paymentScheme: (row.payment_scheme as string | null) ?? null,
      validityMonths: months,
    });
  }
  return out;
}

/** Frozen validity in whole years (customer-safe duration, never economics). */
function validityYearsOf(months: number | null | undefined): number | null {
  if (months === null || months === undefined || months <= 0) return null;
  return months % 12 === 0 ? months / 12 : null;
}

/** Issuer display names for `card_issued_by` staff ids. */
async function issuerDirectory(db: Db, ids: string[]): Promise<Map<string, IssuerInfo>> {
  const out = new Map<string, IssuerInfo>();
  const distinct = [...new Set(ids.filter((id) => id))];
  if (distinct.length === 0) return out;
  const { data, error } = await db.from('staff_users').select('id,full_name').in('id', distinct);
  if (error) throw error;
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    out.set(String(row.id), { name: (row.full_name as string | null) ?? null });
  }
  return out;
}

/**
 * Staff who may READ a card: redemption, activation, and customer service.
 *
 * NOTE: this must try each grant in turn. `a ?? b` on two objects never falls
 * through (both are truthy), so a chain written that way silently keeps only
 * the first module and denies the other two responsibilities.
 */
async function authorizeCardStaff(req: VercelRequest) {
  const redemption = await authorizeAfHomes(req, 'operations.redemption');
  if (!('error' in redemption)) return redemption;
  const activation = await authorizeAfHomes(req, 'finance.card_activation');
  if (!('error' in activation)) return activation;
  return authorizeAfHomes(req, 'sales.customers');
}

/**
 * Printable card data. No hashes, no customer/staff UUIDs: the membership id
 * is already in the URL, the member is a display name, and the tier comes
 * from the product catalogue. The one-time credential secrets are NEVER here -
 * hash-only storage means they cannot be recovered, only rotated. The
 * persistent `memberCode` / `qrPayload` ARE here: they authorize nothing and
 * are meant to be printed.
 */
const toCard = (
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
    tierName: typeof product.name === 'string' && product.name ? product.name : 'AF Homes card',
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);

  try {
    if (subPath(req) === 'lookup' && method(req) === 'GET') {
      const auth = await authorizeAfHomes(req, 'operations.redemption');
      if ('error' in auth) return deny(res, auth);
      const search = String(req.query.search ?? '').trim();
      if (search.length < 2 || search.length > 120)
        return fail(res, 'VALIDATION_ERROR', 'Enter at least two search characters', 400);
      const directory = await customerDirectory(db, {
        search,
        membersOnly: true,
        limit: 50,
        sort: 'name',
      });
      // NOTE: `membersOnly: true` is CORRECT here and must not be relaxed. This is
      // the member-TRANSACTION screen: it lists members because the next action is
      // a redemption, and `memberLookupSchema` carries `membershipNumber` for the
      // till. General Customer Lookup is the separate `customer-lookup` branch
      // below, which is the one that must not expose a Membership Code.
      const data = directory.map(({ record: r }) => memberLookupFromDirectory(r));
      return res
        .status(200)
        .json({ data, meta: { total: directory[0]?.total_count ?? 0, limit: 50, offset: 0 } });
    }

    /* ---------------- general Customer Lookup (GSD / Employee) ---------------- */
    if (subPath(req) === 'customer-lookup' && method(req) === 'GET') {
      // READ-ONLY BY CONSTRUCTION. This branch has no sibling that can mutate, and
      // it grants only the `view` action of one module. A GSD operator who reaches
      // this screen can therefore never edit a customer, take a payment, activate a
      // membership or spend points from here - not because the UI hides the buttons,
      // but because no handler exists on this path. Adding one would be a deliberate,
      // separately-reviewed decision.
      //
      // The permission is `operations.redemption` view because that is what the
      // `employee` role already holds. Reusing it means the GSD desk needs no new
      // role, no new module key and no new grant - see `role-baseline.ts`, where
      // `employee` holds `operations.redemption` and deliberately holds NO
      // `sales.customers` row. Granting `sales.customers` here would have handed a
      // GSD operator the whole customer-master module, including create and update.
      const auth = await authorizeAfHomes(req, 'operations.redemption');
      if ('error' in auth) return deny(res, auth);
      const search = String(req.query.search ?? '').trim();
      if (search.length < 2 || search.length > 120)
        return fail(res, 'VALIDATION_ERROR', 'Enter at least two search characters', 400);
      const directory = await customerDirectory(db, {
        search,
        // NOT membersOnly. A GSD operator must be able to find a prospect, a
        // suspended account or a cancelled one - those are exactly the calls that
        // arrive at this desk. Filtering to members would answer "no such customer"
        // for a customer who exists, which is worse than a wide result.
        membersOnly: false,
        limit: 50,
        sort: 'name',
      });
      // `customer_directory` matches name, Customer ID, Customer Code, email and the
      // legacy customer alias. It does NOT match `membership_number`, and the
      // `20261028000001` migration removed that predicate on purpose, so a
      // Membership Code - current, legacy or `AFHOMES:`-wrapped - finds nobody here.
      // That separation is enforced in SQL and asserted in `db-integration.ts`; this
      // response additionally has no field a Membership Code could be rendered into.
      const data = directory.map(({ record: r }) => customerLookupFromDirectory(r));
      return res
        .status(200)
        .json({ data, meta: { total: directory[0]?.total_count ?? 0, limit: 50, offset: 0 } });
    }
    /* ---------------- resolve an identifier ---------------- */
    if (subPath(req) === 'resolve' && method(req) === 'GET') {
      // Three staff responsibilities may look a card up: redemption, activation,
      // and customer service. All are audited elsewhere; this is a read.
      const auth = await authorizeCardStaff(req);
      if ('error' in auth) return deny(res, auth);

      const identifier = String(req.query.identifier ?? '').trim();
      if (identifier.length < 4 || identifier.length > 200)
        return fail(res, 'VALIDATION_ERROR', 'An identifier is required', 400);

      const hash = hashIdentifier(identifier);
      // A single lookup: the value is either a QR token or a fallback code.
      const { data, error } = await db
        .from('memberships')
        .select(
          'id, membership_number, status, points_balance, expires_at, qr_token_hash, fallback_code_hash',
        )
        .or(`qr_token_hash.eq.${hash},fallback_code_hash.eq.${hash}`)
        .limit(1);
      if (error) throw error;

      let row = (data ?? [])[0] as Record<string, unknown> | undefined;
      if (!row) {
        // No secret matched: fall through to the persistent card number
        // (bare or the `AFHOMES:` digital-card envelope) before giving up.
        const cardNumber = extractMembershipNumber(identifier);
        if (cardNumber) {
          const { data: numbered, error: numberError } = await db
            .from('memberships')
            .select(
              'id, membership_number, status, points_balance, expires_at, qr_token_hash, fallback_code_hash',
            )
            .eq('membership_number', cardNumber)
            .maybeSingle();
          if (numberError) throw numberError;
          row = (numbered ?? undefined) as Record<string, unknown> | undefined;
        }
      }
      if (!row) return fail(res, 'NOT_FOUND', 'No membership matches that identifier', 404);

      const expiresAt = isoOrNull(row.expires_at);
      const expired = expiresAt !== null && new Date(expiresAt).valueOf() <= Date.now();
      // Deliberately no customer name, email, or government data in this shape:
      // a lookup response travels to a staff device and must stay minimal.
      return res.status(200).json({
        membershipId: row.id,
        membershipNumber: row.membership_number,
        status: row.status,
        pointsBalance: Number(row.points_balance ?? 0),
        expired,
      });
    }

    /* ---------------- list ---------------- */
    if (subPath(req) === '' && method(req) === 'GET') {
      const auth = await authorizeCardStaff(req);
      if ('error' in auth) return deny(res, auth);
      const parsed = z
        .object({
          status: z.string().trim().max(30).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        })
        .safeParse(req.query);
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid list query', 400);
      const { status, limit, offset } = parsed.data;

      let query = db.from('memberships').select(SELECT_MEMBERSHIP, { count: 'exact' });
      if (status) query = query.eq('status', status);
      const { data, error, count } = await query
        .order('activated_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw error;
      const rows = (data ?? []) as Record<string, unknown>[];
      const categories = await categoryDirectory(db);
      const issuers = await issuerDirectory(
        db,
        rows.map((row) => String(row.card_issued_by ?? '')),
      );
      const schemes = await saleSchemeDirectory(
        db,
        rows.map((row) => String(row.sale_id ?? '')),
      );
      return res.status(200).json({
        data: rows.map((row) => toMembership(row, categories, issuers, schemes)),
        meta: { total: count ?? rows.length, limit, offset },
      });
    }

    /* ---------------- detail ---------------- */
    const detail = route(req, 'GET', /^([0-9a-f-]+)$/);
    if (detail) {
      const auth = await authorizeCardStaff(req);
      if ('error' in auth) return deny(res, auth);
      const { data, error } = await db
        .from('memberships')
        .select(SELECT_MEMBERSHIP)
        .eq('id', detail[1]!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return fail(res, 'NOT_FOUND', 'Membership not found', 404);
      const row = data as Record<string, unknown>;
      const categories = await categoryDirectory(db);
      const issuers = await issuerDirectory(db, [String(row.card_issued_by ?? '')]);
      const schemes = await saleSchemeDirectory(db, [String(row.sale_id ?? '')]);
      return res.status(200).json(toMembership(row, categories, issuers, schemes));
    }

    /* ---------------- points account ---------------- */
    const account = route(req, 'GET', /^accounts\/([0-9a-f-]+)$/);
    if (account) {
      const auth = await authorizeAfHomes(req, 'finance.points');
      if ('error' in auth) return deny(res, auth);
      const { data, error } = await db
        .from('points_accounts')
        .select('*')
        .eq('membership_id', account[1]!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return fail(res, 'NOT_FOUND', 'Points account not found', 404);
      return res.status(200).json({
        id: data.id,
        membershipId: data.membership_id,
        balance: Number(data.balance),
        lifetimeAllocated: Number(data.lifetime_allocated),
        lifetimeRedeemed: Number(data.lifetime_redeemed),
        updatedAt: isoOrNull(data.updated_at) ?? '',
      });
    }

    /* ---------------- points ledger ---------------- */
    const ledger = route(req, 'GET', /^ledger\/([0-9a-f-]+)$/);
    if (ledger) {
      const auth = await authorizeAfHomes(req, 'finance.points');
      if ('error' in auth) return deny(res, auth);
      const { data, error } = await db
        .from('points_ledger')
        .select('*')
        .eq('account_id', ledger[1]!)
        .order('id', { ascending: false })
        .limit(200);
      if (error) throw error;
      return list(
        res,
        (data ?? []).map((row: Record<string, unknown>) => ({
          id: String(row.id),
          accountId: row.account_id,
          entryType: row.entry_type,
          amount: Number(row.amount),
          balanceAfter: Number(row.balance_after),
          referenceType: isoOrNull(row.reference_type),
          referenceId: isoOrNull(row.reference_id),
          reason: isoOrNull(row.reason),
          createdAt: isoOrNull(row.created_at) ?? '',
        })),
      );
    }

    /* ---------------- printable card data ---------------- */
    const card = route(req, 'GET', /^([0-9a-f-]+)\/card$/);
    if (card) {
      const auth = await authorizeCardStaff(req);
      if ('error' in auth) return deny(res, auth);
      const { data, error } = await db
        .from('memberships')
        .select(SELECT_CARD)
        .eq('id', card[1]!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return fail(res, 'NOT_FOUND', 'Membership not found', 404);
      // Contract-validated: the card shape can never drift to include a hash
      // or an internal id, because the schema rejects it here first.
      const row = data as Record<string, unknown>;
      const categories = await categoryDirectory(db);
      const issuers = await issuerDirectory(db, [String(row.card_issued_by ?? '')]);
      const schemes = await saleSchemeDirectory(db, [String(row.sale_id ?? '')]);
      const parsed = membershipCardSchema.safeParse(toCard(row, categories, issuers, schemes));
      if (!parsed.success) return fail(res, 'INTERNAL', 'Card data is unavailable', 500);
      return res.status(200).json(parsed.data);
    }

    /* ---------------- rotate credentials (privileged reissue) ---------------- */
    const reissue = route(req, 'POST', /^([0-9a-f-]+)\/reissue$/);
    if (reissue) {
      // Card activation staff only: redemption redeems, customer service
      // reads, but neither rotates credentials. Sellers never reach this.
      const auth = await authorizeAfHomes(req, 'finance.card_activation', 'update');
      if ('error' in auth) return deny(res, auth);
      const parsed = reissueMembershipCardSchema.safeParse(jsonBody(req));
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'A reissue requires a reason', 400);
      const id = reissue[1]!;
      const { data: membership, error: readError } = await db
        .from('memberships')
        .select('id, customer_id, membership_number, status, points_balance')
        .eq('id', id)
        .maybeSingle();
      if (readError) throw readError;
      if (!membership) return fail(res, 'NOT_FOUND', 'Membership not found', 404);
      const beforeBalance = Number(membership.points_balance ?? 0);

      // The same rotation the portal uses for self-service: row-locked, the
      // old hashes are replaced so previous codes die immediately, balances
      // and identity are untouched, and exactly one membership remains.
      const { data: rotated, error: rpcError } = await db.rpc('reissue_membership_credentials', {
        p_membership_id: id,
        p_customer_id: membership.customer_id,
        p_actor_id: auth.userId,
      });
      if (rpcError) return mapRpcError(res, rpcError);
      const rotatedRow = (Array.isArray(rotated) ? rotated[0] : rotated) as Record<
        string,
        unknown
      > | null;
      if (!rotatedRow?.fallback_code || !rotatedRow?.qr_token)
        return fail(res, 'INTERNAL', 'Reissue returned no credentials', 500);

      // The rotation itself is audited inside the RPC. This second event is
      // the privileged-reason record: actor, membership, reason, timestamp.
      // Plaintext codes appear in NEITHER payload.
      await audit(
        db,
        auth.userId,
        'MEMBERSHIP_CREDENTIALS_REISSUED',
        'membership',
        id,
        { previousCodesInvalidated: true },
        {
          membershipNumber: membership.membership_number,
          reason: parsed.data.reason,
          pointsBalanceUnchanged: beforeBalance,
        },
      );
      const response = reissuedMembershipCardSchema.safeParse({
        membershipId: id,
        membershipNumber: membership.membership_number,
        fallbackCode: rotatedRow.fallback_code,
        qrToken: rotatedRow.qr_token,
        issuedAt: new Date().toISOString(),
        previousCodesInvalidated: true,
      });
      if (!response.success) return fail(res, 'INTERNAL', 'Reissue returned no credentials', 500);
      return res.status(201).json(response.data);
    }

    /* ---------------- record a print (never a rotation) ---------------- */
    const markPrinted = route(req, 'POST', /^([0-9a-f-]+)\/mark-printed$/);
    if (markPrinted) {
      const auth = await authorizeCardStaff(req);
      if ('error' in auth) return deny(res, auth);
      const id = markPrinted[1]!;
      const { data: membership, error: readError } = await db
        .from('memberships')
        .select('id, membership_number, print_count')
        .eq('id', id)
        .maybeSingle();
      if (readError) throw readError;
      if (!membership) return fail(res, 'NOT_FOUND', 'Membership not found', 404);
      const reprint = Number(membership.print_count ?? 0) > 0;
      const now = new Date().toISOString();
      const { data: updated, error: updateError } = await db
        .from('memberships')
        .update({ last_printed_at: now, print_count: Number(membership.print_count ?? 0) + 1 })
        .eq('id', id)
        .select('print_count, last_printed_at')
        .single();
      if (updateError) throw updateError;
      const stamped = updated as Record<string, unknown>;
      await audit(
        db,
        auth.userId,
        reprint ? 'MEMBERSHIP_CARD_REPRINTED' : 'MEMBERSHIP_CARD_PRINTED',
        'membership',
        id,
        null,
        {
          membershipNumber: membership.membership_number,
          printCount: Number(stamped.print_count ?? 0),
        },
      );
      const response = markedPrintedSchema.safeParse({
        membershipId: id,
        printCount: Number(stamped.print_count ?? 0),
        lastPrintedAt: isoOrNull(stamped.last_printed_at) ?? now,
        reprint,
      });
      if (!response.success) return fail(res, 'INTERNAL', 'Print could not be recorded', 500);
      return res.status(200).json(response.data);
    }

    return fail(res, 'NOT_FOUND', 'Membership endpoint not found', 404);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[api] memberships:', error instanceof Error ? error.message : error);
    mapRpcError(res, error as { message?: string });
  }
}
