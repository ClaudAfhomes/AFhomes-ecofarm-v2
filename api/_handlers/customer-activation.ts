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
 *      customer record - never from the request body.
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
      // holds this address. That is a conflict we must never resolve by
      // attaching that user to this customer.
      const raw = created?.error?.message ?? '';
      if (/already (been )?registered|already exists|duplicate/i.test(raw)) {
        return fail(
          res,
          'CONFLICT',
          'A sign-in already exists for this email address. Contact staff for help.',
          409,
        );
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
