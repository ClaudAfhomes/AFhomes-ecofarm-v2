import { listResponseSchema } from '@jad/contracts';
import type { ZodType } from 'zod';

import { env } from '../env';
import { ApiError, ApiNetworkError, ApiParseError, toApiError } from './errors';
import {
  clearSession,
  getSupabaseClient,
  isSupabaseConfigured,
  tryRefreshSession,
} from '../supabase';

/**
 * Single typed fetch-based API client (FRONTEND-ARCHITECTURE §5). All requests
 * go through here - no ad-hoc `fetch` in features.
 *
 * Auth: the session is a Supabase JWT. When Supabase is configured, the access
 * token is attached as `Authorization: Bearer` on authenticated requests (the
 * API accepts Bearer or the PKCE cookie). Protected requests fail locally when
 * no token can be recovered; public requests may continue anonymously.
 * Credentials stay `same-origin` (the default `/api/v1` deployment).
 */
export type ApiRequestInit = RequestInit & { auth?: 'optional' | 'required' };

let testAccessToken: string | null | undefined;

/** Test harness seam. Production bundles reject attempts to override authentication. */
export function setApiAccessTokenForTests(token: string | null | undefined): void {
  if (import.meta.env.MODE !== 'test') {
    throw new Error('API authentication overrides are available only in tests.');
  }
  testAccessToken = token;
}

const sessionExpired = () =>
  new ApiError({
    code: 'UNAUTHORIZED',
    message: 'Your session has expired. Please sign in again.',
    status: 401,
  });

async function currentAccessToken(): Promise<string | null> {
  if (testAccessToken !== undefined) return testAccessToken;
  const client = getSupabaseClient();
  if (!client) return null;
  try {
    const { data, error } = await client.auth.getSession();
    return error ? null : (data.session?.access_token ?? null);
  } catch {
    return null;
  }
}

/** Resolve a usable token, rotating once when storage has no current session. */
export async function getFreshAccessToken(forceRefresh = false): Promise<string | null> {
  if (testAccessToken !== undefined) return testAccessToken;
  if (!isSupabaseConfigured()) return null;
  if (!forceRefresh) {
    const current = await currentAccessToken();
    if (current) return current;
  }
  if (!(await tryRefreshSession())) return null;
  return currentAccessToken();
}

async function rawRequest(
  path: string,
  init?: ApiRequestInit,
  retried = false,
  forcedAccessToken?: string,
): Promise<Response> {
  const url = `${env.VITE_API_BASE_URL}${path}`;
  const { auth = 'optional', ...fetchInit } = init ?? {};
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(fetchInit.headers as Record<string, string> | undefined),
  };
  const token =
    forcedAccessToken ??
    (auth === 'required' ? await getFreshAccessToken() : await currentAccessToken());
  if (auth === 'required' && !token) {
    throw sessionExpired();
  }
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...fetchInit,
      headers,
      credentials: fetchInit.credentials ?? 'same-origin',
    });
  } catch (cause) {
    throw new ApiNetworkError(cause);
  }
  // A 401 is rejected before a protected business mutation runs, so exactly
  // one refreshed retry is safe even for POST/PATCH/DELETE. Rebuild the
  // headers with the newly rotated token; never retry timeouts or 5xx errors.
  if (res.status === 401 && auth === 'required') {
    if (!retried) {
      const refreshedToken = await getFreshAccessToken(true);
      if (refreshedToken) return rawRequest(path, init, true, refreshedToken);
    }
    await clearSession();
    throw sessionExpired();
  }
  return res;
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** GET a single resource; validates against `schema`; throws ApiError / ApiParseError. */
export async function request<T>(
  path: string,
  schema: ZodType<T>,
  init?: ApiRequestInit,
): Promise<T> {
  const res = await rawRequest(path, init);
  const body = await parseBody(res);

  if (!res.ok) {
    throw toApiError(body, res.status);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiParseError(path, parsed.error.message);
  }
  return parsed.data;
}

/** GET a collection; validates `{ data, meta }` and returns `data` (API-SPECIFICATION §1.1/§4). */
export async function requestList<T>(
  path: string,
  itemSchema: ZodType<T>,
  init?: ApiRequestInit,
): Promise<T[]> {
  const listSchema = listResponseSchema(itemSchema);
  const res = await rawRequest(path, init);
  const body = await parseBody(res);

  if (!res.ok) {
    throw toApiError(body, res.status);
  }

  const parsed = listSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiParseError(path, parsed.error.message);
  }
  return parsed.data.data;
}

/**
 * GET a collection and return the full `{ data, meta }` envelope - for callers
 * that need `meta` beyond the list (e.g. the registrations queue's
 * `meta.invalid` dropped-row count). Auth + 401 healing are identical to the
 * other helpers.
 */
export async function requestListEnvelope<T>(
  path: string,
  itemSchema: ZodType<T>,
  init?: ApiRequestInit,
): Promise<{ data: T[]; meta: Record<string, unknown> }> {
  const listSchema = listResponseSchema(itemSchema);
  const res = await rawRequest(path, init);
  const body = await parseBody(res);

  if (!res.ok) {
    throw toApiError(body, res.status);
  }

  const parsed = listSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiParseError(path, parsed.error.message);
  }
  return { data: parsed.data.data, meta: (parsed.data.meta ?? {}) as Record<string, unknown> };
}

/** Cursor-paginated page of `{ data, meta.pagination.nextCursor }` (API-SPECIFICATION §4). */
export interface PageResult<T> {
  items: T[];
  nextCursor?: string;
}

/** GET a cursor-paginated collection (threads/ledger streams - API-SPECIFICATION §4). */
export async function requestPage<T>(
  path: string,
  itemSchema: ZodType<T>,
  init?: ApiRequestInit,
): Promise<PageResult<T>> {
  const listSchema = listResponseSchema(itemSchema);
  const res = await rawRequest(path, init);
  const body = await parseBody(res);

  if (!res.ok) {
    throw toApiError(body, res.status);
  }

  const parsed = listSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiParseError(path, parsed.error.message);
  }
  const pagination = parsed.data.meta?.pagination as { nextCursor?: string } | undefined;
  return { items: parsed.data.data, nextCursor: pagination?.nextCursor };
}

export const protectedRequest = <T>(path: string, schema: ZodType<T>, init?: ApiRequestInit) =>
  request(path, schema, { ...init, auth: 'required' });

export const protectedRequestList = <T>(
  path: string,
  itemSchema: ZodType<T>,
  init?: ApiRequestInit,
) => requestList(path, itemSchema, { ...init, auth: 'required' });

export const protectedRequestListEnvelope = <T>(
  path: string,
  itemSchema: ZodType<T>,
  init?: ApiRequestInit,
) => requestListEnvelope(path, itemSchema, { ...init, auth: 'required' });

export const protectedRequestPage = <T>(
  path: string,
  itemSchema: ZodType<T>,
  init?: ApiRequestInit,
) => requestPage(path, itemSchema, { ...init, auth: 'required' });
