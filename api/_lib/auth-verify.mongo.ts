import type { Db } from 'mongodb';
import type { createAfHomesAuth } from './auth.js';
import type { VercelRequest } from './http.js';

export function requestHeaders(req: VercelRequest) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers ?? {})) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) for (const item of value) headers.append(key, item);
  }
  return headers;
}
/** Real cookie validation; no JWT decoding, guessed provider APIs or bearer fallback. */
export function createMongoSessionVerifier(_db: Db, auth: ReturnType<typeof createAfHomesAuth>) {
  return {
    read: (req: VercelRequest) => auth.api.getSession({ headers: requestHeaders(req) }),
  };
}
