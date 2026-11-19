/**
 * Single Vercel Function for the whole API surface.
 *
 * `vercel.json` rewrites every `/api/v1/:path*` request to this function, which
 * dispatches through the shared router (`api/_lib/router.ts`). This keeps the
 * deployment at ONE function so it fits Vercel's Hobby plan limit. Handlers
 * live under `api/_handlers/**` (ignored by Vercel's function discovery) and
 * are imported + routed here.
 *
 * Rewrites preserve the original request path in `req.url`, so routing sees the
 * real endpoint (e.g. `/api/v1/admin/afhomes/session`), not `/api/router`.
 */
import { toErrorEnvelope } from './_lib/envelope.js';
import type { VercelRequest, VercelResponse } from './_lib/http.js';
import { resolveRequestUrl, routeRequest } from './_lib/router.js';

export default async function handler(
  req: VercelRequest & { url?: string },
  res: VercelResponse,
): Promise<void> {
  const handled = await routeRequest(req, res);
  if (!handled) {
    const { error, status } = toErrorEnvelope(
      'NOT_FOUND',
      `No handler for ${resolveRequestUrl(req)}`,
      404,
    );
    res.status(status).json({ error });
  }
}
