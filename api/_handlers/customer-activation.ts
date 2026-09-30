/**
 * Customer account activation: `POST /auth/customer/activate`.
 *
 * Unauthenticated by necessity - the customer has no Auth account yet.
 *
 * Flow, and why it is shaped this way:
 *
 *   1. Validate the body. It carries ONLY a token and a password. Customer id,
 *      email, membership and role are all resolved from the token server-side,
 *      so nothing about identity can be asserted by the caller.
 *   2. Hash the token with the SAME helper the database uses
 *      (`private.hash_token` = SHA-256 hex) and look it up. The plaintext is
 *      never stored, never logged and never returned.
 *   3. Pre-flight every rule that does not need a write, so an obviously bad
 *      request never causes an Auth user to be created.
 *   4. Create the Auth user with the ADMIN API using the email from the
 *      customer record - never from the request body. When GoTrue reports the
 *      address is already registered AND the existing account is a provable
 *      orphan (same email, linked to no customer and no staff identity), link
 *      it instead: the existing password is never read, set or overwritten,
 *      and the response is marked so the UI points at sign-in /
 *      forgot-password rather than the just-typed password.
 *   5. Claim the token atomically. This is where the link, the token
 *      consumption and the audit trail land in ONE transaction.
 *   6. If (5) fails, delete the Auth user that (4) just created. A PRE-EXISTING
 *      Auth user is never deleted, and the token is never consumed on failure,
 *      so the customer can simply try again.
 *
 * `email_confirm: true` is deliberate. The customer proved control of the
 * address when they received the staff-issued onboarding token, so a separate
 * confirmation email would add a failure mode without adding assurance. This
 * endpoint does NOT mint a session: the client signs in through the normal
 * Supabase Auth password flow, so no token is ever proxied through here.
 */
import { createHash } from 'node:crypto';

import { customerActivationRequestSchema } from '@jad/contracts';

import { fail, isoOrNull, jsonBody, type Db, mapRpcError, subPath } from '../_lib/handler-kit.js';
import { serviceClient } from '../_lib/rest.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

/** Must match private.hash_token(text) exactly. */
export const hashOnboardingToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/** Normalised email comparison: GoTrue matches addresses case-insensitively. */
const normalizeEmail = (email: unknown) =>
  typeof email === 'string' ? email.trim().toLowerCase() : '';

/**
 * Server-side lookup of the GoTrue user holding an address, for duplicate-
 * email recovery only. Pages the admin directory (capped) and compares
 * normalised emails; the caller re-verifies everything before linking.
 */
async function findAuthUserByEmail(
  db: Db,
  email: string,
): Promise<{ id: string; email: string } | null> {
  const wanted = normalizeEmail(email);
  if (!wanted) return null;
  for (let page = 1; page <= 20; page += 1) {
    const listed = await db.auth.admin.listUsers({ page, perPage: 100 });
    if (listed?.error) throw listed.error;
    const users = (listed?.data?.users ?? []) as { id: string; email?: string }[];
    const hit = users.find((u) => normalizeEmail(u.email) === wanted);
    if (hit?.id) return { id: String(hit.id), email: String(hit.email ?? email) };
    if (users.length < 100) return null;
  }
  return null;
}

async function readDisplayName(
  db: Db,
  customerId: string,
): Promise<{ fullName: string; activatedAt: string | null }> {
  const names = await db
    .from('customers')
    .select('first_name, middle_name, last_name, suffix, updated_at')
    .eq('id', customerId)
    .maybeSingle();
  const n = (names.data ?? {}) as Record<string, string | null>;
  return {
    fullName: [n.first_name, n.middle_name, n.last_name, n.suffix]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join(' '),
    activatedAt: isoOrNull(n.updated_at),
  };
}

/**
 * Duplicate-email recovery: the address already has a GoTrue account, so no
 * new user is created and the existing password is never touched. The
 * pre-existing account is linked only when it is provably unclaimed - not
 * attached to another customer, not a staff identity - and the atomic claim
 * RPC remains the final guard: it links, consumes the token and audits in
 * ONE transaction, and refuses (without consuming) when the customer was
 * linked concurrently.
 */
async function recoverExistingAuthUser(
  db: Db,
  res: VercelResponse,
  input: { tokenHash: string; customerId: string; email: string },
) {
  const existing = await findAuthUserByEmail(db, input.email);
  if (!existing) {
    return fail(
      res,
      'CONFLICT',
      'A sign-in already exists for this email address. Contact staff for help.',
      409,
    );
  }

  // Re-read the customer: it may have been linked since pre-flight, and the
  // link below must never move an account between customers.
  const { data: fresh, error: freshError } = await db
    .from('customers')
    .select('id, auth_user_id')
    .eq('id', input.customerId)
    .maybeSingle();
  if (freshError) throw freshError;
  if (!fresh || (fresh as { auth_user_id: string | null }).auth_user_id) {
    return fail(res, 'CONFLICT', 'This customer already has a sign-in.', 409);
  }

  const claimedElsewhere = async (table: string, column: string) => {
    const { data, error } = await db.from(table).select('id').eq(column, existing.id).limit(1);
    if (error) throw error;
    return (data ?? []).length > 0;
  };
  // The account must be an orphan: another customer's sign-in, a staff
  // identity, or a pending staff invitation each ends recovery here with the
  // token untouched. The reason stays generic - an anonymous caller holding a
  // valid token must not learn which kind of identity holds the address.
  if (
    (await claimedElsewhere('customers', 'auth_user_id')) ||
    (await claimedElsewhere('staff_users', 'id')) ||
    (await claimedElsewhere('staff_invitations', 'auth_user_id'))
  ) {
    return fail(
      res,
      'CONFLICT',
      'A sign-in already exists for this email address. Contact staff for help.',
      409,
    );
  }

  const claimed = await db.rpc('claim_customer_onboarding_token', {
    p_token_hash: input.tokenHash,
    p_auth_user_id: existing.id,
    p_purpose: 'account_activation',
  });
  if (claimed.error) {
    // Never created, so never deleted; the token is untouched by the RPC on
    // these refusals, preserving recoverability.
    const code = splitCode(claimed.error.message ?? '');
    const mapped = REFUSALS[code];
    if (mapped) return fail(res, mapped[0], mapped[1], mapped[2]);
    return fail(res, 'INTERNAL', 'The account could not be linked. Nothing was changed.', 500);
  }
  const row = (Array.isArray(claimed.data) ? claimed.data[0] : claimed.data) as
    | { customer_id: string; customer_number: string; email: string; outcome: string }
    | undefined;
  if (!row) {
    return fail(res, 'INTERNAL', 'The account could not be linked. Nothing was changed.', 500);
  }

  // Non-secret recovery audit. Issuance is already committed, so a failed
  // audit write must not discard the success - same posture as the staff
  // onboarding-token endpoint.
  try {
    await db.from('audit_events').insert({
      actor_id: existing.id,
      action: 'CUSTOMER_EXISTING_AUTH_LINKED',
      entity_type: 'customer',
      entity_id: row.customer_id,
      after_data: {
        customerId: row.customer_id,
        purpose: 'account_activation',
        via: 'activation_recovery',
        tokenConsumed: true,
      },
    });
  } catch {
    // eslint-disable-next-line no-console
    console.error('[api] customer activation: recovery audit write failed');
  }

  const display = await readDisplayName(db, row.customer_id);
  return res.status(201).json({
    customerId: row.customer_id,
    customerNumber: row.customer_number,
    email: row.email,
    fullName: display.fullName,
    nextStep: 'sign_in' as const,
    // The password typed on the activation page was never set on this
    // account. The UI must point at sign-in / forgot-password instead of
    // trying the fresh password.
    linkedExistingAuth: true,
  });
}

/** Stable, safe-to-show mapping from a database refusal to a client message. */
const REFUSALS: Record<string, [string, string, number]> = {
  TOKEN_NOT_FOUND: ['NOT_FOUND', 'This activation link is not valid.', 404],
  TOKEN_ALREADY_CONSUMED: ['CONFLICT', 'This activation link has already been used.', 409],
  TOKEN_EXPIRED: ['CONFLICT', 'This activation link has expired. Ask staff for a new one.', 409],
  TOKEN_WRONG_PURPOSE: ['VALIDATION_ERROR', 'This link is not an account activation link.', 400],
  CUSTOMER_NOT_ACTIVE: ['CONFLICT', 'This account is not active.', 409],
  CUSTOMER_HAS_NO_ACTIVE_MEMBERSHIP: ['CONFLICT', 'No active membership was found.', 409],
  CUSTOMER_ALREADY_CLAIMED: ['CONFLICT', 'This customer is already linked to another sign-in.', 409],
  ACTOR_REQUIRED: ['UNAUTHORIZED', 'Sign in to continue', 401],
};

const splitCode = (message: string) => (message.split(':')[0] ?? '').trim();
const splitDetail = (message: string) => message.slice(message.indexOf(':') + 1).trim();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Server configuration is incomplete', 500);

  try {
    // The router already constrains this family to `customer/activate`; the check
    // is repeated so a direct call (or a future family widening) can never make
    // this handler answer for a path it does not own.
    if (subPath(req) !== 'customer/activate') {
      return fail(res, 'NOT_FOUND', 'Not found', 404);
    }
    if (req.method !== 'POST') return fail(res, 'NOT_FOUND', 'Not found', 404);

    const parsed = customerActivationRequestSchema.safeParse(jsonBody(req));
    if (!parsed.success) {
      return fail(res, 'VALIDATION_ERROR', 'Check the activation link and password.', 400);
    }
    const { onboardingToken, password } = parsed.data;
    const tokenHash = hashOnboardingToken(onboardingToken);

    /* --- 1. Read-only pre-flight. No Auth user is created for a bad request.
       Three plain queries rather than a nested embed: each step is a separate
       security decision, and a nested join would hide which table a value came
       from. */
    const { data: tokenRow, error: tokenError } = await db
      .from('customer_onboarding_tokens')
      .select('id, customer_id, purpose, expires_at, consumed_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();
    if (tokenError) throw tokenError;

    if (!tokenRow) {
      // Do not distinguish "unknown" from "wrong" beyond a generic refusal.
      return fail(res, 'NOT_FOUND', 'This activation link is not valid.', 404);
    }
    const token = tokenRow as unknown as {
      id: string;
      customer_id: string;
      purpose: string;
      expires_at: string;
      consumed_at: string | null;
    };

    if (token.purpose !== 'account_activation') {
      return fail(res, 'VALIDATION_ERROR', 'This link is not an account activation link.', 400);
    }
    if (token.consumed_at) {
      return fail(res, 'CONFLICT', 'This activation link has already been used.', 409);
    }
    if (new Date(token.expires_at).valueOf() <= Date.now()) {
      return fail(res, 'CONFLICT', 'This activation link has expired. Ask staff for a new one.', 409);
    }

    const { data: customerRow, error: customerError } = await db
      .from('customers')
      .select('id, customer_number, email, status, auth_user_id')
      .eq('id', token.customer_id)
      .maybeSingle();
    if (customerError) throw customerError;
    if (!customerRow) return fail(res, 'NOT_FOUND', 'This activation link is not valid.', 404);
    const customer = customerRow as unknown as {
      id: string;
      customer_number: string;
      email: string;
      status: string;
      auth_user_id: string | null;
    };

    if (customer.status !== 'active') {
      return fail(res, 'CONFLICT', 'This account is not active.', 409);
    }

    const { data: membershipRow, error: membershipError } = await db
      .from('memberships')
      .select('id, status')
      .eq('customer_id', customer.id)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membershipRow) {
      return fail(res, 'CONFLICT', 'No active membership was found.', 409);
    }

    if (customer.auth_user_id) {
      return fail(res, 'CONFLICT', 'This customer already has a sign-in.', 409);
    }

    // The email is authoritative on the CUSTOMER RECORD. A body-supplied email is
    // never read, and the schema does not even accept one.
    const email = customer.email;

    /* --- 2. Create the Auth user. email_confirm is deliberate (see header). */
    // No `user_metadata` is written. The link lives in `customers.auth_user_id`,
    // which the server owns; user metadata is user-editable and must never be a
    // source of identity or authorization.
    const created = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    const authUserId = created?.data?.user?.id;
    if (created?.error || !authUserId) {
      // GoTrue reports a duplicate email here when some other Auth user already
      // holds this address. When that account is a provable orphan, link it
      // instead of failing; otherwise refuse without touching anything.
      const raw = created?.error?.message ?? '';
      if (/already (been )?registered|already exists|duplicate/i.test(raw)) {
        return recoverExistingAuthUser(db, res, {
          tokenHash,
          customerId: customer.id,
          email,
        });
      }
      return fail(res, 'INTERNAL', 'The account could not be created. Nothing was changed.', 500);
    }

    /* --- 3. Claim atomically. On failure, roll the Auth user back. */
    const claimed = await db.rpc('claim_customer_onboarding_token', {
      p_token_hash: tokenHash,
      p_auth_user_id: authUserId,
      p_purpose: 'account_activation',
    });

    if (claimed.error) {
      // Roll back ONLY the user this call created. A pre-existing user is never
      // deleted. The token is untouched, so the customer can retry.
      await db.auth.admin.deleteUser(authUserId).catch(() => undefined);
      const code = splitCode(claimed.error.message ?? '');
      const mapped = REFUSALS[code];
      if (mapped) return fail(res, mapped[0], mapped[1], mapped[2]);
      const detail = splitDetail(claimed.error.message ?? '');
      if (code === 'CUSTOMER_NOT_ACTIVE') {
        return fail(res, 'CONFLICT', `This account is not active (${detail}).`, 409);
      }
      return fail(res, 'INTERNAL', 'The account could not be linked. Nothing was changed.', 500);
    }

    const row = (Array.isArray(claimed.data) ? claimed.data[0] : claimed.data) as
      | { customer_id: string; customer_number: string; email: string; outcome: string }
      | undefined;
    if (!row) {
      await db.auth.admin.deleteUser(authUserId).catch(() => undefined);
      return fail(res, 'INTERNAL', 'The account could not be linked. Nothing was changed.', 500);
    }

    const names = await db
      .from('customers')
      .select('first_name, middle_name, last_name, suffix, updated_at')
      .eq('id', row.customer_id)
      .maybeSingle();
    const n = (names.data ?? {}) as Record<string, string | null>;
    const fullName = [n.first_name, n.middle_name, n.last_name, n.suffix]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join(' ');

    return res.status(201).json({
      customerId: row.customer_id,
      customerNumber: row.customer_number,
      email: row.email,
      fullName,
      nextStep: 'sign_in' as const,
      linkedExistingAuth: false,
      // The customer must sign in to receive a session. Nothing token-shaped is
      // returned from this endpoint.
      activatedAt: isoOrNull(n.updated_at),
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[api] customer activation:', error instanceof Error ? error.message : error);
    mapRpcError(res, error as { message?: string });
  }
}
