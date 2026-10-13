/**
 * The single typed API client for the customer portal. Every request goes
 * through here - no ad-hoc `fetch` in a feature - and every response is
 * validated against a `@afhomes/contracts` schema, so a drifting payload surfaces as
 * an error instead of silently rendering undefined.
 *
 * Auth: the customer's Supabase access token is attached as
 * `Authorization: Bearer`. `/auth/customer/activate` is unauthenticated and
 * simply sends no header.
 */
import { listResponseSchema } from '@afhomes/contracts';
import { withRequestDeadline } from '@afhomes/shared';
import type { ZodType } from 'zod';

import { env } from '../env';
import { ApiNetworkError, ApiParseError, toApiError } from './errors';
import {
  clearSession,
  getSupabaseClient,
  isSupabaseConfigured,
  tryRefreshSession,
} from '../supabase';

async function rawRequest(path: string, init?: RequestInit, retried = false): Promise<Response> {
  const url = `${env.VITE_API_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (isSupabaseConfigured()) {
    const { data } = (await getSupabaseClient()?.auth.getSession()) ?? {
      data: { session: null },
    };
    const token = data.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  init?.signal?.throwIfAborted();
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers,
      credentials: init?.credentials ?? 'same-origin',
    });
  } catch (cause) {
    init?.signal?.throwIfAborted();
    throw new ApiNetworkError(cause);
  }
  // An expired or rotated session surfaces as 401 (an under-privileged caller is
  // always 403, never 401). Heal once via rotation, then retry; if rotation
  // fails the session is dead, so clear it and let the guard redirect.
  init?.signal?.throwIfAborted();
  if (res.status === 401 && !retried && isSupabaseConfigured()) {
    const healed = await tryRefreshSession();
    init?.signal?.throwIfAborted();
    if (healed) return rawRequest(path, init, true);
    await clearSession();
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

async function requestBody(path: string, init?: RequestInit) {
  try {
    return await withRequestDeadline(async (signal) => {
      const res = await rawRequest(path, { ...init, signal });
      const body = await parseBody(res);
      return { res, body };
    }, init?.signal);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'TimeoutError') {
      throw new ApiNetworkError(cause);
    }
    throw cause;
  }
}

/** Request a single resource; validate against `schema`. */
export async function request<T>(path: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
  const { res, body } = await requestBody(path, init);
  if (!res.ok) throw toApiError(body, res.status);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiParseError(path, parsed.error.message);
  return parsed.data;
}

/** Request a collection; validate the `{ data, meta }` envelope and return `data`. */
export async function requestList<T>(
  path: string,
  itemSchema: ZodType<T>,
  init?: RequestInit,
): Promise<T[]> {
  const { res, body } = await requestBody(path, init);
  if (!res.ok) throw toApiError(body, res.status);
  const parsed = listResponseSchema(itemSchema).safeParse(body);
  if (!parsed.success) throw new ApiParseError(path, parsed.error.message);
  return parsed.data.data;
}
