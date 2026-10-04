/**
 * Shared plumbing for the AF Homes API handlers.
 *
 * Keeps the sub-path dispatch, error envelope, audit insert, and JSON body
 * reading in one place so every Phase 2 handler behaves identically: same error
 * shape, same audit semantics, same "never leak the driver message" rule.
 */
import { toErrorEnvelope } from './envelope.js';
import type { VercelRequest, VercelResponse } from './http.js';

// Supabase's fluent query type stays behind this server-only adapter.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = any;

export type FailureCode = Parameters<typeof toErrorEnvelope>[0];

export function fail(
  res: VercelResponse,
  code: FailureCode,
  message: string,
  status: number,
): void {
  const envelope = toErrorEnvelope(code, message, status);
  res.status(envelope.status).json({ error: envelope.error });
}

export function list(res: VercelResponse, data: unknown[]): void {
  res.status(200).json({ data, meta: { total: data.length } });
}

/** The shape `authorizeAfHomes`/`resolveAfHomesPrincipal` return on failure. */
export type Denied = { error: { error: { code: string; message: string }; status: number } };

/**
 * Relay an authorization denial using its own status and envelope, so the
 * client sees the resolver's code (401 vs 403) rather than a flattened one.
 */
export function deny(res: VercelResponse, denied: Denied): void {
  res.status(denied.error.status).json({ error: denied.error.error });
}

/**
 * The sub-path a family handler is dispatching on, e.g. `sales` -> `42/payments`.
 *
 * CANONICAL ROUTING CONTRACT (Phase 13): the sub-path NEVER carries the family
 * prefix. The router strips `/api/v1/<family>/` before dispatch, so a handler
 * matches `42/payments` - never `sales/42/payments`. The collection root is
 * always `''`. The single exception is an exact-path family (`auth`), whose
 * configured full path passes through unchanged.
 *
 * Handler tests must pass the same stripped paths production sends; a test
 * that passes a prefixed path is testing a request that cannot exist.
 */
export function subPath(req: VercelRequest): string {
  return String(req.query.familyPath ?? '').replace(/^\/+|\/+$/g, '');
}

export function method(req: VercelRequest): string {
  return req.method ?? 'GET';
}

/** True when the request matches `VERB /pattern`; captures params on success. */
export function route(req: VercelRequest, verb: string, pattern: RegExp): RegExpMatchArray | null {
  if (method(req) !== verb.toUpperCase()) return null;
  return subPath(req).match(pattern);
}

/**
 * Append an audit event. Throws on failure on purpose: a business mutation that
 * cannot be audited must not be reported as a success.
 */
export async function audit(
  db: Db,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  before?: unknown,
  after?: unknown,
  extra?: { reason?: string; requestId?: string },
): Promise<void> {
  const { error } = await db.from('audit_events').insert({
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    before_data: before ?? null,
    after_data: after ?? null,
    reason: extra?.reason ?? null,
    request_id: extra?.requestId ?? null,
  });
  if (error) throw new Error(`Audit write failed: ${error.message}`);
}

/**
 * Map a Postgres RPC error onto a client error. The raw driver message is
 * logged server-side only - it can name relations, columns, and constraints.
 */
export function mapRpcError(res: VercelResponse, error: { message?: string } | null): void {
  const message = String(error?.message ?? '');
  const [code] = message.split(':');

  const byCode: Record<string, [FailureCode, number]> = {
    SALE_NOT_FOUND: ['NOT_FOUND', 404],
    PAYMENT_NOT_FOUND: ['NOT_FOUND', 404],
    ACTOR_REQUIRED: ['UNAUTHORIZED', 401],
    SALE_NOT_ACTIVATABLE: ['CONFLICT', 409],
    SALE_NOT_FULLY_PAID: ['CONFLICT', 409],
    SALE_NOT_ACCEPTING_PAYMENTS: ['CONFLICT', 409],
    SALE_HAS_NO_PRICE_SNAPSHOT: ['CONFLICT', 409],
    PAYMENT_NOT_PENDING: ['CONFLICT', 409],
    AMOUNT_MUST_BE_POSITIVE: ['VALIDATION_ERROR', 400],
    INVALID_PAYMENT_TYPE: ['VALIDATION_ERROR', 400],
    INVALID_DECISION: ['VALIDATION_ERROR', 400],
    INVALID_VALIDITY_MONTHS: ['VALIDATION_ERROR', 400],
    REASON_REQUIRED: ['VALIDATION_ERROR', 400],
    UPLINE_ALREADY_ASSIGNED: ['CONFLICT', 409],
    UPLINE_SELF_REFERENCE: ['VALIDATION_ERROR', 400],
    INVALID_HIERARCHY: ['VALIDATION_ERROR', 400],
    INVALID_HIERARCHY_DIRECTION: ['VALIDATION_ERROR', 400],
    SUBJECT_ROLE_MISMATCH: ['VALIDATION_ERROR', 400],
    GENEALOGY_CYCLE: ['VALIDATION_ERROR', 400],
    INSUFFICIENT_PERMISSION: ['FORBIDDEN', 403],
    SUBJECT_NOT_FOUND: ['NOT_FOUND', 404],
    UPLINE_NOT_FOUND: ['NOT_FOUND', 404],
    APPLICATION_NOT_FOUND: ['NOT_FOUND', 404],
    AGREEMENT_NOT_FOUND: ['NOT_FOUND', 404],
    PLAN_NOT_FOUND: ['NOT_FOUND', 404],
    ACTOR_INACTIVE: ['FORBIDDEN', 403],
    SECONDARY_HOLDER_GOLD_ONLY: ['VALIDATION_ERROR', 400],
    PRIMARY_HOLDER_REQUIRED: ['VALIDATION_ERROR', 400],
    APPLICATION_REVIEW_INCOMPLETE: ['VALIDATION_ERROR', 400],
    APPLICATION_NOT_EDITABLE: ['CONFLICT', 409],
    AGREEMENT_NOT_EDITABLE: ['CONFLICT', 409],
    AGREEMENT_SALE_IMMUTABLE: ['CONFLICT', 409],
    INVALID_APPLICATION_TRANSITION: ['CONFLICT', 409],
    INVALID_AGREEMENT_TRANSITION: ['CONFLICT', 409],
    SALE_COMPLETE_HIERARCHY_REQUIRED: ['CONFLICT', 409],
    SALE_HIERARCHY_TOO_DEEP: ['CONFLICT', 409],
    SALE_SELLER_REQUIRED: ['VALIDATION_ERROR', 400],
    SALE_SELLER_HIERARCHY_ROLE_REQUIRED: ['CONFLICT', 409],
    IMPORT_JOB_NOT_FOUND: ['NOT_FOUND', 404],
    IMPORT_JOB_NOT_COMMITTABLE: ['CONFLICT', 409],
    IMPORT_DUPLICATE_MEMBERSHIP: ['CONFLICT', 409],
    IMPORT_DUPLICATE_EMAIL: ['CONFLICT', 409],
    IMPORT_BAD_PAYMENT: ['VALIDATION_ERROR', 400],
    IMPORT_BAD_OPENING_BALANCE: ['VALIDATION_ERROR', 400],
    IMPORT_NOT_FULLY_PAID: ['CONFLICT', 409],
  };

  if (code === 'MUTATION_PAYLOAD_CONFLICT')
    return fail(
      res,
      'CONFLICT',
      'This request identifier was already used with different data.',
      409,
    );
  if (message.includes('payments_sale_reference_unique'))
    return fail(
      res,
      'CONFLICT',
      'This payment reference has already been recorded for this sale.',
      409,
    );
  if (code === 'MUTATION_FORBIDDEN')
    return fail(res, 'FORBIDDEN', 'This operation is not authorized', 403);
  if (code === 'MUTATION_REQUEST_REQUIRED' || code === 'INVALID_DOCUMENT_REVIEW')
    return fail(
      res,
      'VALIDATION_ERROR',
      'A valid request identity and mutation data are required',
      400,
    );
  if (code === 'DOCUMENT_NOT_FOUND') return fail(res, 'NOT_FOUND', 'Document not found', 404);
  const mapped = byCode[code ?? ''];
  // eslint-disable-next-line no-console
  console.error('[api] rpc error:', message);
  if (mapped)
    return fail(
      res,
      mapped[0],
      code === 'SALE_COMPLETE_HIERARCHY_REQUIRED'
        ? 'Complete the seller hierarchy before creating this sale.'
        : code!.replace(/_/g, ' ').toLowerCase(),
      mapped[1],
    );

  // Postgres unique violation (23505) surfaces as a duplicate conflict rather
  // than an opaque 500.
  if (
    error &&
    'code' in (error as Record<string, unknown>) &&
    (error as { code?: string }).code === '23505'
  ) {
    return fail(res, 'CONFLICT', 'A record with these details already exists', 409);
  }
  return fail(res, 'INTERNAL', 'Internal server error', 500);
}

/** Read a JSON body, tolerating Vercel's string-encoded form. */
export function jsonBody(req: VercelRequest): unknown {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return undefined;
    }
  }
  return req.body;
}

/** ISO timestamp or null, for nullable timestamptz columns. */
export function isoOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function requireString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Extract the single row of a `RETURNS TABLE` RPC result.
 *
 * Live PostgREST returns a set-returning function as an ARRAY of rows
 * (`[{ sale_number: 'SALE-000001' }]`), never a bare object. A bare object
 * is tolerated only so older scripted doubles keep working; anything else -
 * an empty array, more than one row, a scalar, null - yields null so the
 * caller fails closed BEFORE persisting anything.
 */
export function singleRpcRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? (data.length === 1 ? data[0] : undefined) : data;
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  return row as Record<string, unknown>;
}

/**
 * Extract a single non-blank text column from a `RETURNS TABLE` RPC result.
 * Returns null when the shape is wrong, the column is missing, or the value
 * is blank - every one of those is a generation failure, never an empty
 * string to persist.
 */
export function singleRpcText(data: unknown, column: string): string | null {
  const row = singleRpcRow(data);
  if (!row) return null;
  const value = row[column];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
