import { staffAlertsSchema, type AfHomesModuleKey } from '@afhomes/contracts';

import { actionAllowed, resolveAfHomesPrincipal } from '../_lib/afhomes-access.js';
import { fail, method, subPath, type Db } from '../_lib/handler-kit.js';
import { serviceClient } from '../_lib/rest.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

/**
 * GET staff-alerts - the admin header badge: live counts of work waiting.
 *
 * Each count is computed only when the caller may VIEW its module; otherwise it
 * is `null`, so the badge reveals nothing about a module the caller cannot open.
 * Nothing is stored: the counts read the work tables directly.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (subPath(req) !== '' || method(req) !== 'GET')
    return fail(res, 'NOT_FOUND', 'Route not found.', 404);
  const principal = await resolveAfHomesPrincipal(req);
  if ('error' in principal)
    return res.status(principal.error.status).json({ error: principal.error.error });
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Alerts are unavailable.', 503);

  // A session that must first change its password or finish MFA sees nothing.
  const locked = principal.mustChangePassword || principal.mfaRequired;
  const may = (key: AfHomesModuleKey) =>
    !locked &&
    actionAllowed(
      principal.permissions.find((p) => p.moduleKey === key),
      'view',
    );

  const count = async (
    enabled: boolean,
    build: () => PromiseLike<{ count: number | null; error: unknown }>,
  ) => {
    if (!enabled) return null;
    const { count: n, error } = await build();
    if (error) throw error;
    return n ?? 0;
  };
  const head = { count: 'exact' as const, head: true };
  const [newInquiries, requestedBookings, awaitingReply] = await Promise.all([
    count(may('sales.inquiries'), () =>
      db.from('website_inquiries').select('id', head).eq('status', 'new'),
    ),
    count(may('operations.bookings'), () =>
      db.from('service_bookings').select('id', head).eq('status', 'requested'),
    ),
    count(may('communication.messages'), () =>
      db
        .from('customer_conversations')
        .select('id', head)
        .eq('status', 'open')
        .eq('last_sender_kind', 'customer'),
    ),
  ]);
  res.setHeader('Cache-Control', 'private, no-store');
  return res
    .status(200)
    .json(staffAlertsSchema.parse({ newInquiries, requestedBookings, awaitingReply }));
}
