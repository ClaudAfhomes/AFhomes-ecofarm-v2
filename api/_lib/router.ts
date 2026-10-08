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
import { toErrorEnvelope } from './envelope.js';
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
 * family (members, vouchers, withdrawals, CMS, ...) belonged to the retired
 * predecessor platform and was removed - none of it had a table in the AF Homes schema.
 */

/**
 * Business families, each dispatched to one handler through a `familyPath`
 * query parameter. Declared as data so adding a family is a single entry and
 * `route-coverage` can still prove every handler is reachable.
 */
const BUSINESS_FAMILIES = [
  {
    prefix: 'ost-accreditation',
    module: 'ost-accreditation',
    load: () => import('../_handlers/ost-accreditation.js'),
  },
  { prefix: 'card-products', module: 'cards', load: () => import('../_handlers/cards.js') },
  {
    prefix: 'card-categories',
    module: 'cards',
    load: () => import('../_handlers/card-categories.js'),
  },
  { prefix: 'customers', module: 'customers', load: () => import('../_handlers/customers.js') },
  {
    prefix: 'official-forms',
    module: 'forms',
    load: () => import('../_handlers/official-forms.js'),
  },
  {
    prefix: 'customer-imports',
    module: 'customer-imports',
    load: () => import('../_handlers/customer-imports.js'),
  },
  { prefix: 'sales', module: 'sales', load: () => import('../_handlers/sales.js') },
  { prefix: 'payments', module: 'sales', load: () => import('../_handlers/sales.js') },
  {
    prefix: 'memberships',
    module: 'memberships',
    load: () => import('../_handlers/memberships.js'),
  },
  { prefix: 'points', module: 'memberships', load: () => import('../_handlers/memberships.js') },
  {
    prefix: 'commissions',
    module: 'commissions',
    load: () => import('../_handlers/commissions.js'),
  },
  { prefix: 'referrals', module: 'referrals', load: () => import('../_handlers/referrals.js') },
  { prefix: 'genealogy', module: 'genealogy', load: () => import('../_handlers/genealogy.js') },
  { prefix: 'analytics', module: 'analytics', load: () => import('../_handlers/analytics.js') },
  // Phase 15 Reports and Audit Center. One family for the ten scoped reports
  // plus the audit log; the handler authorizes each report against its own
  // module key (`reports` itself is not a permission - the family module here
  // only names the route). The audit route additionally requires
  // `governance.audit`.
  { prefix: 'reports', module: 'reports', load: () => import('../_handlers/reports.js') },
  // Phase 8 OST registration and approval (SM -> OST). One family for the
  // public referral/application surface and the staff review surface; the
  // handler authorizes each route separately (public routes take no session).
  { prefix: 'ost', module: 'ost', load: () => import('../_handlers/ost.js') },
  // Phase 12 identity documents and OCR-assisted extraction. Upload grants,
  // suggestion-only OCR, and human-confirmed review; nothing here finalizes
  // identity on its own.
  { prefix: 'documents', module: 'documents', load: () => import('../_handlers/documents.js') },
  { prefix: 'queues', module: 'queues', load: () => import('../_handlers/queues.js') },
  // Customer portal. Neither family consults the staff permission model - see
  // api/_lib/customer-access.ts, which resolves a customer from ownership alone.
  //
  // `auth` is the UNAUTHENTICATED activation entry point and carries an explicit
  // `path`, so it claims ONLY `auth/customer/activate`. Without that constraint it
  // would also swallow `/api/v1/auth/register` - a route belonging to the
  // retired predecessor platform, which must stay unroutable. Claiming a whole prefix is how a
  // retired surface quietly comes back to life.
  //
  // `customer` (singular) is listed AFTER `customers` (plural) and cannot match
  // it: the prefix must be followed by `/` or end-of-path.
  {
    prefix: 'auth',
    module: 'auth',
    path: 'customer/activate',
    load: () => import('../_handlers/customer-activation.js'),
  },
  {
    prefix: 'auth',
    module: 'auth',
    path: 'portals',
    load: () => import('../_handlers/auth-portals.js'),
  },
  { prefix: 'customer', module: 'customer', load: () => import('../_handlers/customer-portal.js') },
  // Staff redemption. Reuses the Phase 1 `operations.redemption` and
  // `operations.catalog` module keys, so Phase 4 adds NO new authorization
  // vocabulary. `items` and `history` live under the same prefix, and because a
  // prefix must be followed by `/` or end-of-path it cannot shadow the bare
  // `/redemptions` list.
  {
    prefix: 'redemptions',
    module: 'operations.redemption',
    load: () => import('../_handlers/redemptions.js'),
  },
  {
    prefix: 'cms',
    module: 'cms',
    load: () => import('../_handlers/cms.js'),
  },
  // Official Philippine address reference data (province -> city/municipality
  // -> barangay) for the Customer Application form. Read-only. The `module`
  // here only names the route; the handler authorizes against `sales.customers`
  // itself, which is the screen that needs it - so this adds NO new module key.
  //
  // Deliberately NOT `locations`: that prefix belonged to the retired
  // predecessor platform and must stay unroutable (see router.spec.ts).
  {
    prefix: 'address',
    module: 'sales.customers',
    load: () => import('../_handlers/address.js'),
  },
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
    const match = pathname.match(new RegExp(`^/api(?:/v1)?/${family.prefix}(?:/(.*))?$`));
    if (!match) continue;
    const familyPath = decodeURIComponent(match[1] ?? '');
    // A family that owns exactly one route leaves everything else under its
    // prefix unrouted, so a retired sibling route stays retired.
    if ('path' in family && family.path !== familyPath) continue;
    query.familyPath = familyPath;
    return {
      // Keep every import specifier literal. Vercel's function tracer cannot
      // discover a module behind import(variable), so a variable target builds
      // successfully but disappears from the deployed function artifact.
      handler: lazy(family.load),
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
  if (req.headers.authorization) res.setHeader('Cache-Control', 'private, no-store');
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
      const { error, status } = toErrorEnvelope('INTERNAL', 'Internal server error', 500);
      res.status(status).json({ error });
    } catch {
      // Response already sent - nothing more we can do.
    }
  }
  return true;
}
