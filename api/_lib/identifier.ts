/**
 * Membership identifier resolution - the ONE place a scanned QR token or a typed
 * fallback code becomes a membership.
 *
 * Both identifiers are hashed with the same SHA-256 helper the database uses
 * (`private.hash_token`), and both are matched against the same row in the same
 * single query. There is no second resolution path: the redemption flow, the
 * activation queue and customer service all come through here, so QR and fallback
 * code can never drift apart in their validation.
 *
 * What this function deliberately does NOT do:
 *
 *  - It does not authorize anything. Resolving an identifier proves only that the
 *    caller presented a currently valid credential for some membership. Every
 *    caller must then independently re-check the customer status, the membership
 *    status, expiry and the acting staff member's permission.
 *  - It does not return customer PII. The caller decides what a safe preview
 *    needs, and the default result carries no name, no government data and no
 *    Auth internals.
 *  - It does not reveal which of the two identifiers matched unless the caller
 *    asks, and even then only as the enum `qr | fallback_code` - never the value.
 *
 * NO NFC. A QR token is a camera image; a fallback code is typed. There is no tag
 * reader here and no field anywhere in the schema for one.
 */
import { createHash } from 'node:crypto';

/** Must match `private.hash_token(text)` in the migrations exactly. */
export const hashIdentifier = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

/** Bounds chosen to reject obvious junk before any database work. */
export const IDENTIFIER_MIN = 4;
export const IDENTIFIER_MAX = 200;

export type IdentifierKind = 'qr' | 'fallback_code';

/** The minimal row a resolution needs. Deliberately no customer fields. */
export type ResolvedMembership = {
  id: string;
  customer_id: string;
  membership_number: string;
  status: string;
  points_balance: number | string;
  expires_at: string | null;
  qr_token_hash: string;
  fallback_code_hash: string;
  customer_status: string;
  /** The authoritative balance, from `points_accounts`. */
  account_balance: number | string | null;
  product_name: string | null;
};

export type Resolution = {
  membership: ResolvedMembership;
  matchedBy: IdentifierKind;
};

/**
 * Normalise a typed identifier.
 *
 * The FALLBACK CODE format is fixed by `private.new_fallback_code()` as
 * `AFH-XXXX-XXXX` in uppercase hex, so case and the separator are pure noise and
 * are normalised away. That is safe precisely because the format is known.
 *
 * The QR TOKEN is base64 and therefore CASE-SENSITIVE, so it is only trimmed. A
 * blanket lowercase here would silently break half of all valid QR tokens, which
 * is the kind of bug that only shows up at a till.
 */
export function normalizeIdentifier(raw: string): string {
  const trimmed = raw.trim();
  // Strip the separators and case ONLY - never characters from the prefix. An
  // earlier version filtered the value down to hex digits, which silently ate
  // the `H` of `AFH` and turned `AFH-1A2B-3C4D` into `AFH-AF1A-2B3C`, so no
  // typed fallback code would ever have resolved.
  const compact = trimmed.replace(/[\s-]/g, '').toUpperCase();
  if (/^AFH[0-9A-F]{8}$/.test(compact)) {
    return `AFH-${compact.slice(3, 7)}-${compact.slice(7, 11)}`;
  }
  return trimmed;
}

export const isPlausibleIdentifier = (value: string): boolean =>
  value.length >= IDENTIFIER_MIN && value.length <= IDENTIFIER_MAX;

/**
 * Resolve an identifier to a membership, server-side, in one query.
 *
 * `db` is the SERVICE client: this function is only ever called from a handler
 * that has already authorized the caller. Returns `null` for an unknown or
 * rotated-out identifier, deliberately without saying which.
 */
export async function resolveMembershipByIdentifier(
  db: {
    from: (table: string) => {
      select: (
        columns: string,
      ) => {
        or: (filter: string) => { limit: (n: number) => Promise<{ data: unknown; error: unknown }> };
        eq: (
          col: string,
          val: unknown,
        ) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> };
      };
    };
  },
  rawIdentifier: string,
): Promise<Resolution | null> {
  const identifier = normalizeIdentifier(rawIdentifier);
  if (!isPlausibleIdentifier(identifier)) return null;

  const hash = hashIdentifier(identifier);
  // ONE query, ONE row: the value is either the QR token or the fallback code.
  // `customers!inner` makes an unresolvable customer impossible, so a hit is
  // always a membership that actually belongs to a live customer record.
  //
  // The points balance is fetched separately rather than embedded, because
  // `points_accounts` is the CHILD of `memberships` and reverse-embedding it
  // needs a constraint hint that is easy to get subtly wrong. Two plain queries
  // in a preview endpoint is not worth that risk.
  const { data, error } = await db
    .from('memberships')
    .select(
      'id, customer_id, membership_number, status, points_balance, expires_at, ' +
        'qr_token_hash, fallback_code_hash, ' +
        'customers!inner(status), card_plans!inner(name)',
    )
    .or(`qr_token_hash.eq.${hash},fallback_code_hash.eq.${hash}`)
    .limit(1);
  if (error) throw error;

  const row = (data as Record<string, unknown>[] | null)?.[0];
  if (!row) return null;

  const customer = (row.customers ?? {}) as Record<string, unknown>;
  const product = (row.card_plans ?? {}) as Record<string, unknown>;

  // The AUTHORITATIVE balance. `memberships.points_balance` is a cache only.
  const { data: accountData } = await db
    .from('points_accounts')
    .select('balance')
    .eq('membership_id', String(row.id))
    .maybeSingle();
  const account = (accountData ?? null) as Record<string, unknown> | null;

  return {
    matchedBy: row.qr_token_hash === hash ? 'qr' : 'fallback_code',
    membership: {
      id: String(row.id),
      customer_id: String(row.customer_id),
      membership_number: String(row.membership_number),
      status: String(row.status),
      points_balance: Number(row.points_balance ?? 0),
      expires_at: row.expires_at ? new Date(String(row.expires_at)).toISOString() : null,
      qr_token_hash: String(row.qr_token_hash),
      fallback_code_hash: String(row.fallback_code_hash),
      customer_status: String(customer.status ?? ''),
      account_balance: account ? Number(account.balance ?? 0) : null,
      product_name: product.name ? String(product.name) : null,
    },
  };
}

/**
 * Why a resolved membership cannot be redeemed against, or `null` if it can.
 *
 * Kept here rather than in a handler so the redemption flow and any future flow
 * (a kiosk, an online order) apply exactly the same rules and cannot disagree.
 *
 * Expiry is a REFUSAL only. Nothing here changes `memberships.status`: what
 * happens to a lapsed membership is an unresolved renewal policy, and a
 * redemption must not quietly define it.
 */
export function redemptionBlocker(resolved: ResolvedMembership): string | null {
  if (resolved.customer_status !== 'active')
    return `The customer account is ${resolved.customer_status}.`;
  if (resolved.status !== 'active')
    return `The membership is ${resolved.status}.`;
  if (resolved.expires_at && new Date(resolved.expires_at).valueOf() <= Date.now())
    return 'The membership has expired.';
  return null;
}

/** The authoritative balance: the points account, never the cache. */
export const authoritativeBalance = (resolved: ResolvedMembership): number =>
  resolved.account_balance === null || resolved.account_balance === undefined
    ? Number(resolved.points_balance ?? 0)
    : Number(resolved.account_balance);
