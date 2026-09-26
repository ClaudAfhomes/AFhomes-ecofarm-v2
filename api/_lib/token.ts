import type { VercelRequest } from './http.js';

function headerValue(
  headers: VercelRequest['headers'],
  name: string,
): string | undefined {
  const raw = headers[name.toLowerCase()] ?? headers[name];
  if (Array.isArray(raw)) return raw[0];
  if (typeof raw === 'string') return raw;
  return undefined;
}

/**
 * Bearer token from the `Authorization` header, else the Supabase auth cookie
 * (`sb-<ref>-auth-token`, which carries a JSON or base64 chunked payload).
 *
 * The header is the contract; the cookie is a fallback so the two SPAs sharing
 * one origin keep working when a client sends credentials implicitly. The value
 * is still verified server-side via `auth.getUser` - nothing here trusts it.
 */
export function extractBearerToken(req: VercelRequest): string | undefined {
  const authHeader = headerValue(req.headers, 'authorization') ?? '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  const cookie = headerValue(req.headers, 'cookie') ?? '';
  const match = cookie.match(/sb-[^-]+-auth-token=([^;]+)/);
  if (!match) return undefined;
  try {
    const decoded = decodeURIComponent(match[1]);
    const parsed: unknown = JSON.parse(decoded);
    if (parsed && typeof parsed === 'object') {
      const rec = parsed as Record<string, unknown>;
      if (typeof rec.access_token === 'string') return rec.access_token;
      const first = Array.isArray(parsed)
        ? (parsed[0] as Record<string, unknown> | undefined)
        : undefined;
      if (first && typeof first.access_token === 'string') return first.access_token;
    }
    return decoded;
  } catch {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return undefined;
    }
  }
}
