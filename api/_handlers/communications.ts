import { toErrorEnvelope } from '../_lib/envelope.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';
import { setCors } from '../_lib/cors.js';

/**
 * AF Homes communications - direct and group messages, announcements and
 * personal notifications, served from the TOP-LEVEL `/api/v1/communications`
 * family. See the entry in `api/_lib/router.ts` for why the prefix is not
 * `admin/afhomes/communications`.
 *
 * This is a routing stub: the family's routes, contracts and authorization are
 * added in the following tasks. It deliberately answers EVERY path with 404
 * from inside the handler rather than silently serving anything, so a client that
 * reaches a route before it exists gets an honest NOT_FOUND instead of a blank
 * 200.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res, req, 'GET,POST,PATCH,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  const { error, status } = toErrorEnvelope(
    'NOT_FOUND',
    'Communications endpoint not found',
    404,
  );
  res.status(status).json({ error });
}