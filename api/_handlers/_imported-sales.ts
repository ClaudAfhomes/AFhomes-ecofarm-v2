import { importedSalesQuerySchema, importedSalesListSchema, isIstRole } from '@afhomes/contracts';
import type { AfHomesPrincipal } from '../_lib/afhomes-access.js';
import { fail, type Db } from '../_lib/handler-kit.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

export async function importedSales(
  req: VercelRequest,
  res: VercelResponse,
  principal: AfHomesPrincipal,
  db: Db,
) {
  const query = importedSalesQuerySchema.safeParse(req.query);
  if (!query.success)
    return fail(res, 'VALIDATION_ERROR', 'Choose a valid imported sales period and page.', 400);
  if (!principal.permissions.some((p) => p.moduleKey === 'sales.card_sales' && p.canView))
    return fail(res, 'FORBIDDEN', 'This module is not permitted.', 403);
  if (query.data.view === 'team-sales' && !isIstRole(principal.roleSlug))
    return fail(res, 'FORBIDDEN', 'Team monitoring requires an IST account.', 403);
  const { data, error } = await db.rpc('imported_sales_for_account', {
    p_actor_id: principal.userId,
    p_team: query.data.view === 'team-sales',
    p_from: query.data.from ?? null,
    p_to: query.data.to ?? null,
    p_page: query.data.page,
  });
  if (error) return fail(res, 'INTERNAL', 'Unable to load imported sales. Try again.', 500);
  const result = importedSalesListSchema.parse(data);
  if (!principal.permissions.some((p) => p.moduleKey === 'sales.customers' && p.canView))
    for (const row of result.data) row.customerName = null;
  return res.status(200).json(result);
}
