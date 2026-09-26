/**
 * Shared API router - single source of the URL->handler table.
 *
 * Both `api/dev-server.ts` (local) and the single Vercel catch-all function
 * `api/router.ts` dispatch through `routeRequest`, so every endpoint is served
 * identically in dev and production. The handler files live under
 * `api/_handlers/**` (underscore-prefixed -> Vercel never turns them into
 * functions; they are bundled into the catch-all instead).
 *
 * A new handler must be added as a lazy branch here (`lazy(() => import(...))`)
 * - `api/_lib/route-coverage.ts` fails CI if one is forgotten. Handlers are
 * loaded on first use (cold-start win); shared libs stay imported eagerly.
 */
import type { VercelRequest, VercelResponse } from './http.js';

type HandlerFn = (req: VercelRequest, res: VercelResponse) => Promise<void> | void;

export type RouteMatch = { handler: HandlerFn; routeKey: string | null };

/**
 * Lazy handler loader - defers a handler module's evaluation until its first
 * request (per-route code splitting). Big cold-start win for the monolith:
 * only the matched handler (plus shared libs) is evaluated per boot instead of
 * every module. Cached per instance; each route gets its own loader.
 */
function lazy(load: () => Promise<{ default: HandlerFn }>): HandlerFn {
  let cached: HandlerFn | null = null;
  return (req: VercelRequest, res: VercelResponse) => {
    if (cached) return cached(req, res);
    return load().then((mod) => {
      cached = mod.default;
      return cached(req, res);
    });
  };
}

/**
 * Route `pathname` (+ the mutable `query` object to populate path params) to a
 * handler. Supports both `/api/v1/...` and bare `/api/...` prefixes (the bare
 * prefix only matters for the local dev server; Vercel only serves `/api/v1`).
 *
 * Phase 2 surface: the AF Homes operations API, the business families
 * (card products, customers, sales, payments, activation, memberships, points,
 * commissions, referrals, queues), and the health probe. Every other route
 * family (members, vouchers, withdrawals, CMS, ...) belonged to the retired JAD
 * platform and was removed - none of it had a table in the AF Homes schema.
 */

/**
 * Business families, each dispatched to one handler through a `familyPath`
 * query parameter. Declared as data so adding a family is a single entry and
 * `route-coverage` can still prove every handler is reachable.
 */
const BUSINESS_FAMILIES = [
  { prefix: 'card-products', module: 'cards', handler: '../_handlers/cards.js' },
  { prefix: 'customers', module: 'customers', handler: '../_handlers/customers.js' },
  { prefix: 'sales', module: 'sales', handler: '../_handlers/sales.js' },
  { prefix: 'payments', module: 'sales', handler: '../_handlers/sales.js' },
  { prefix: 'memberships', module: 'memberships', handler: '../_handlers/memberships.js' },
  { prefix: 'points', module: 'memberships', handler: '../_handlers/memberships.js' },
  { prefix: 'commissions', module: 'commissions', handler: '../_handlers/commissions.js' },
  { prefix: 'referrals', module: 'referrals', handler: '../_handlers/referrals.js' },
  { prefix: 'queues', module: 'queues', handler: '../_handlers/queues.js' },
] as const;

export function selectHandler(
  pathname: string,
  query: Record<string, string | string[] | undefined>,
): RouteMatch | null {
  const afHomesMatch = pathname.match(/^\/api(?:\/v1)?\/admin\/afhomes\/(.+)$/);
  if (afHomesMatch) {
    query.afPath = decodeURIComponent(afHomesMatch[1] ?? '');
    return {
      handler: lazy(() => import('../_handlers/admin/afhomes.js')),
      routeKey: `admin/afhomes/${query.afPath}`,
    };
  }
  for (const family of BUSINESS_FAMILIES) {
    const match = pathname.match(
      new RegExp(`^/api(?:/v1)?/${family.prefix}(?:/(.*))?$`),
    );
    if (!match) continue;
    query.familyPath = decodeURIComponent(match[1] ?? '');
    return {
      handler: lazy(() => import(family.handler)),
      routeKey: `${family.module}/${query.familyPath || family.prefix}`,
    };
  }
  if (pathname === '/api/v1/health' || pathname === '/health') {
    return { handler: lazy(() => import('../_handlers/health.js')), routeKey: 'health' };
  }
  return null;
}

type RoutableRequest = { url?: string; query: VercelRequest['query'] };

/**
 * Resolve the API path to route on. `vercel.json` rewrites `/api/v1/:path*`
 * to `/api/router?path=:path*`; some runtimes expose the original URL while
 * others expose the rewritten one. Prefer the original `/api/v1/...` URL
 * (keeps its query string) and otherwise rebuild it from the captured `path`.
 */
export function resolveRequestUrl(req: RoutableRequest): string {
  const originalUrl = req.url ?? '/';
  const captured = req.query.path;
  const capturedPath = Array.isArray(captured) ? captured.join('/') : captured;
  if (/^\/api\/v1(\/|\?|$)/.test(originalUrl)) return originalUrl;
  if (capturedPath) return `/api/v1/${capturedPath}`;
  return originalUrl;
}

/**
 * Dispatch a request to the matching handler. Returns `true` when a handler
 * matched (its response is already written via `res`), `false` when no route
 * exists - the caller is responsible for the 404.
 */
export async function routeRequest(
  req: VercelRequest & { url?: string },
  res: VercelResponse,
): Promise<boolean> {
  const pathname = resolveRequestUrl(req).split('?')[0] ?? '/';
  const match = selectHandler(pathname, req.query);
  if (!match) return false;
  try {
    await match.handler(req as VercelRequest, res);
  } catch (e) {
    const err = e as Error;
    console.error(
      `[api] handler error for ${req.method ?? 'GET'} ${pathname}:`,
      err?.message ?? err,
    );
    try {
      res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
    } catch {
      // Response already sent - nothing more we can do.
    }
  }
  return true;
}
