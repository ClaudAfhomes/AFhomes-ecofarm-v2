/**
 * Cross-portal identity probe: `GET /auth/portals`.
 *
 * Answers ONE question about the bearer's OWN Auth user: which AF Homes
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
import { serviceClient, anonClient } from '../_lib/rest.js';
import { extractBearerToken } from '../_lib/token.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const anon = anonClient();
  const db = serviceClient() as Db;
  if (!anon || !db)
    return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);

  try {
    if (method(req) !== 'GET') return fail(res, 'NOT_FOUND', 'Not found', 404);

    const token = extractBearerToken(req);
    if (!token) return fail(res, 'UNAUTHORIZED', 'Sign in to continue', 401);
    const { data: authData, error: authError } = await verifySessionToken(anon.auth, token);
    const userId = authData?.user?.id;
    if (authError || !userId)
      return fail(res, 'UNAUTHORIZED', 'Your session has expired. Please sign in again.', 401);

    const [{ data: staff }, { data: assignment }, { data: customer }, { data: ost }] =
      await Promise.all([
        db
          .from('staff_users')
          .select('id, status, must_change_password')
          .eq('id', userId)
          .maybeSingle(),
        db.from('staff_role_assignments').select('role_id').eq('staff_id', userId).maybeSingle(),
        db.from('customers').select('id, status').eq('auth_user_id', userId).maybeSingle(),
        db.from('ost_members').select('id, ost_number, status').eq('id', userId).maybeSingle(),
      ]);

    let roleSlug: string | null = null;
    let roleName: string | null = null;
    const assignmentRow = assignment as { role_id?: string } | null;
    if (assignmentRow?.role_id) {
      const { data: role } = await db
        .from('roles')
        .select('slug, name')
        .eq('id', assignmentRow.role_id)
        .maybeSingle();
      const roleRow = role as { slug?: string; name?: string } | null;
      roleSlug = typeof roleRow?.slug === 'string' ? roleRow.slug : null;
      roleName = typeof roleRow?.name === 'string' ? roleRow.name : null;
    }

    const staffRow = staff as {
      status?: string;
      must_change_password?: boolean;
    } | null;
    const customerRow = customer as { status?: string } | null;
    const ostRow = ost as { status?: string; ost_number?: string } | null;

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
