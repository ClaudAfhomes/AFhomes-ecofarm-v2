/**
 * Shared plumbing for the AFHomes API handlers (MongoDB version).
 *
 * Keeps the sub-path dispatch, error envelope, audit insert, and JSON body
 * reading in one place so every handler behaves identically: same error
 * shape, same audit semantics, same "never leak the driver message" rule.
 */
import { toErrorEnvelope } from './envelope.js';
import type { VercelRequest, VercelResponse } from './http.js';
import { randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongodb';

// MongoDB database type
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = any;

export type MongoRow = Record<string, unknown> & {
  _id: string;
};

export type FailureCode = Parameters<typeof toErrorEnvelope>[0];

export function fail(
  res: VercelResponse,
  code: FailureCode,
  message: string,
  status: number,
  details?: unknown,
): void {
  const envelope = toErrorEnvelope(code, message, status, details);
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
 * Requires a ClientSession for transactional writes.
 */
export async function audit(
  db: Db,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  before?: unknown,
  after?: unknown,
  extra?: Record<string, unknown> | { reason?: string; requestId?: string },
  session?: ClientSession,
): Promise<void> {
  const { error } = await db.collection('audit_events').insertOne(
    {
      _id: randomUUID(),
      actor_id: actorId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      before_data: before ?? null,
      after_data: after ?? null,
      reason: extra && 'reason' in extra ? extra.reason ?? null : null,
      request_id: extra && 'requestId' in extra ? extra.requestId ?? null : null,
      created_at: new Date(),
    },
    { session },
  );
  if (error) throw new Error(`Audit write failed: ${error.message}`);
}

/** Extract the single row of a result. */
export function singleResult(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? (data.length === 1 ? data[0] : undefined) : data;
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  return row as Record<string, unknown>;
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

/** Map MongoDB error onto a client error. */
export function mapMongoError(
  res: VercelResponse,
  error: { message?: string; code?: number; keyValue?: Record<string, unknown> } | null,
): void {
  const message = String(error?.message ?? '');
  const code = error?.code;

  // Duplicate key error (11000)
  if (code === 11000 || code === 11001) {
    const field = error?.keyValue ? Object.keys(error.keyValue)[0] : 'field';
    return fail(res, 'CONFLICT', `A record with this ${field} already exists`, 409);
  }

  return fail(res, 'INTERNAL', 'Internal server error', 500);
}