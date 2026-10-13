/**
 * Cross-portal identity probe: `GET /auth/portals`.
 *
 * Answers ONE question about the bearer's OWN Auth user: which AFHomes
 * identities exist (a staff row, a customer row, an OST row). Login screens
 * call it after Supabase authentication to route to the right portal and to
 * name the wrong-portal message.
 *
 * Read-only and self-scoped: the user id comes from the verified JWT, never
 * from a parameter, so a caller can only ever learn about themselves. It
 * authorizes nothing - every portal guard and every endpoint re-validates
 * server-side. A staff row here does not grant a staff capability, and a
 * customer row here does not prove an active membership.
 */
import { authPortalsSchema } from '@afhomes/contracts';

import { verifySessionToken } from '../_lib/auth-verify.js';
import { fail, type Db, mapRpcError, method } from '../_lib/handler-kit.js';
import { serviceClient, anonClient, userClient } from '../_lib/rest.js';
import { extractBearerToken } from '../_lib/token.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (method(req) !== 'GET') return fail(res, 'NOT_FOUND', 'Not found', 404);

    const token = extractBearerToken(req);
    if (!token) return fail(res, 'UNAUTHORIZED', 'Sign in to continue', 401);
    const anon = anonClient();
    const svc = serviceClient() as Db;
    if (!anon) return fail(res, 'INTERNAL', 'Supabase authentication is not configured', 500);
    const db = svc;
    const { data: authData, error: authError } = await verifySessionToken(anon.auth, token);
    const userId = authData?.user?.id;
    if (authError || !userId)
      return fail(res, 'UNAUTHORIZED', 'Your session has expired. Please sign in again.', 401);

    if (!db) {
      const caller = userClient(token);
      if (!caller) return fail(res, 'INTERNAL', 'Supabase authentication is not configured', 500);
      const result = await caller.rpc('afhomes_self_portals', {});
      if (result.error)
        return fail(
          res,
          'INTERNAL',
          'Secure portal verification is unavailable. Contact the administrator.',
          503,
        );
      const own = authPortalsSchema.safeParse(result.data);
      if (!own.success) return fail(res, 'INTERNAL', 'Could not resolve your portals', 500);
      return res.status(200).json(own.data);
    }
    const identities = await Promise.all([
      db
        .from('staff_users')
        .select('id, status, must_change_password')
        .eq('id', userId)
        .maybeSingle(),
      db
        .from('staff_role_assignments')
        .select('staff_id, role_id')
        .eq('staff_id', userId)
        .maybeSingle(),
      db
        .from('customers')
        .select('id, status, auth_user_id')
        .eq('auth_user_id', userId)
        .maybeSingle(),
      db.from('ost_members').select('id, ost_number, status').eq('id', userId).maybeSingle(),
    ]);

    if (identities.some((result) => result.error))
      return fail(
        res,
        'INTERNAL',
        'Secure portal verification is unavailable. Contact the administrator.',
        503,
      );
    const [{ data: staff }, { data: assignment }, { data: customer }, { data: ost }] = identities;

    // Ownership re-check (defense in depth): RLS already scopes fallback
    // reads to the caller, and the service path filters by the same id. A
    // row that does not belong to the bearer reads as absent, never leaks.
    const ownStaff = staff?.id === userId ? staff : null;
    const ownAssignment = assignment?.staff_id === userId ? assignment : null;
    const ownCustomer = customer?.auth_user_id === userId ? customer : null;
    const ownOst = ost?.id === userId ? ost : null;

    let roleSlug: string | null = null;
    let roleName: string | null = null;
    const assignmentRow = ownAssignment as { role_id?: string } | null;
    if (assignmentRow?.role_id) {
      const { data: role, error: roleError } = await db
        .from('roles')
        .select('slug, name')
        .eq('id', assignmentRow.role_id)
        .maybeSingle();
      if (roleError)
        return fail(
          res,
          'INTERNAL',
          'Secure portal verification is unavailable. Contact the administrator.',
          503,
        );
      const roleRow = role as { slug?: string; name?: string } | null;
      roleSlug = typeof roleRow?.slug === 'string' ? roleRow.slug : null;
      roleName = typeof roleRow?.name === 'string' ? roleRow.name : null;
    }

    const staffRow = ownStaff as {
      status?: string;
      must_change_password?: boolean;
    } | null;
    const customerRow = ownCustomer as { status?: string } | null;
    const ostRow = ownOst as { status?: string; ost_number?: string } | null;

    const parsed = authPortalsSchema.safeParse({
      staff: staffRow
        ? {
            roleSlug,
            roleName,
            status: staffRow.status ?? 'inactive',
            mustChangePassword: staffRow.must_change_password === true,
          }
        : null,
      customer: customerRow ? { status: customerRow.status ?? 'prospect' } : null,
      ost:
        ostRow && typeof ostRow.ost_number === 'string'
          ? { status: ostRow.status ?? 'inactive', ostNumber: ostRow.ost_number }
          : null,
    });
    if (!parsed.success) return fail(res, 'INTERNAL', 'Could not resolve your portals', 500);
    return res.status(200).json(parsed.data);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[api] auth portals:', error instanceof Error ? error.message : error);
    return mapRpcError(res, error as { message?: string });
  }
}
