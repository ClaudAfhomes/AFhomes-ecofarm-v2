import { createClient } from '@supabase/supabase-js';

import { getSupabaseEnv } from './env.js';
import { toErrorEnvelope } from './envelope.js';
import type { VercelResponse } from './http.js';

/**
 * Shared REST helpers for api/ collection handlers: list envelopes matching
 * what `requestList` validates (`{ data, meta: { page, pageSize, total } }`),
 * service-role client acquisition, and small error shortcuts.
 *
 * Clients are cached per Vercel instance (keyed by the resolved URL and key) instead
 * of rebuilt on every request - supabase-js re-initializes its realtime/
 * storage machinery on each `createClient`, which is pure overhead here.
 *
 * The cache variables are typed from the `createClient(...)` call (via the
 * unannotated factory) so the client keeps its exact inferred type - the same
 * inference the pre-cache code relied on.
 */

function makeServiceClient(url: string, serviceKey: string) {
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function makeAnonClient(url: string, anonKey: string, bearer?: string) {
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(bearer ? { global: { headers: { Authorization: `Bearer ${bearer}` } } } : {}),
  });
}

/** Cached service-role client (keyed by URL and key so a changed env rebuilds). */
let serviceClientCached: ReturnType<typeof makeServiceClient> | null = null;
let serviceClientKey = '';

/** Cached anon (client-scoped) client for `auth.getUser` / OTP endpoints. */
let anonClientCached: ReturnType<typeof makeAnonClient> | null = null;
let anonClientKey = '';

/** Service-role client, or null when unconfigured. Callers respond 500. */
export function serviceClient() {
  const { url, serviceKey } = getSupabaseEnv();
  if (!url || !serviceKey) return null;
  if (!serviceClientCached || serviceClientKey !== url + serviceKey) {
    serviceClientCached = makeServiceClient(url, serviceKey);
    serviceClientKey = url + serviceKey;
  }
  return serviceClientCached;
}

/** Anon (client-scoped) client, or null when unconfigured. */
export function anonClient() {
  const { url, anonKey } = getSupabaseEnv();
  if (!url || !anonKey) return null;
  if (!anonClientCached || anonClientKey !== url + anonKey) {
    anonClientCached = makeAnonClient(url, anonKey);
    anonClientKey = url + anonKey;
  }
  return anonClientCached;
}

/**
 * Bearer-scoped client for self reads when the service role is unavailable
 * (e.g. a keyless Preview that must never hold production-write credentials).
 * PostgREST enforces the caller's own RLS policies; every caller additionally
 * asserts row ownership before use, so a misconfigured policy yields absence,
 * never another user's row. NEVER cached: the credential differs per request
 * and a shared instance would leak one user's identity into another's reads.
 */
export function userClient(token: string) {
  const { url, anonKey } = getSupabaseEnv();
  if (!url || !anonKey || !token) return null;
  return makeAnonClient(url, anonKey, token);
}

export function okList(res: VercelResponse, rows: unknown[]): void {
  res
    .status(200)
    .json({ data: rows, meta: { page: 1, pageSize: rows.length, total: rows.length } });
}

export function methodNotAllowed(res: VercelResponse, method: string | undefined): void {
  const { error, status } = toErrorEnvelope('NOT_FOUND', `Method ${method} not allowed`, 405);
  res.status(status).json({ error });
}

/** Service-role client, or a 500 already sent (returns null in that case). */
export function requireService(res: VercelResponse) {
  const supabase = serviceClient();
  if (!supabase) {
    const { error, status } = toErrorEnvelope('INTERNAL', 'Supabase not configured', 500);
    res.status(status).json({ error });
    return null;
  }
  return supabase;
}

/** Parse a JSON-capable request body (dev-server pre-parses; Vercel may give a string). */
export function readJsonBody(req: {
  body?: unknown;
}): { ok: true; body: unknown } | { ok: false; error: ReturnType<typeof toErrorEnvelope> } {
  let body: unknown = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return { ok: false, error: toErrorEnvelope('VALIDATION_ERROR', 'Invalid JSON body', 400) };
    }
  }
  return { ok: true, body };
}
