/**
 * AF Homes referral / upline relationships (VD -> SSM -> SM -> OST).
 *
 * Once a relationship is authoritative the subject can no longer move
 * themselves: the create and correct paths both require `sales.uplines`, a
 * seller can never call them, and every change is audited. Historical sales keep
 * the relationship id they were created under, so a later correction never
 * rewrites past attribution.
 */
import { createReferralSchema, correctReferralSchema, hierarchyAllowsUpline } from '@jad/contracts';

import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import {
  audit,
  deny,
  fail,
  isoOrNull,
  jsonBody,
  type Db,
  list,
  mapRpcError,
  method,
  route,
  subPath,
} from '../_lib/handler-kit.js';
import { serviceClient } from '../_lib/rest.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

const toRelationship = (row: Record<string, unknown>) => {
  const subject = (row.subject ?? {}) as Record<string, unknown>;
  const upline = (row.upline ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    subjectStaffId: row.subject_staff_id,
    subjectName: String(subject.full_name ?? ''),
    subjectRole: String(subject.slug ?? ''),
    uplineStaffId: row.upline_staff_id,
    uplineName: String(upline.full_name ?? ''),
    hierarchyRole: row.hierarchy_role,
    isAuthoritative: row.is_authoritative === true,
    isActive: row.is_active === true,
    assignedAt: isoOrNull(row.assigned_at) ?? '',
  };
};

const SELECT_RELATIONSHIP =
  '*, subject:staff_users!referral_relationships_subject_staff_id_fkey(full_name), upline:staff_users!referral_relationships_upline_staff_id_fkey(full_name)';

async function roleSlugOf(db: Db, staffId: string): Promise<string> {
  const { data: assignment } = await db
    .from('staff_role_assignments')
    .select('role_id')
    .eq('staff_id', staffId)
    .maybeSingle();
  if (!assignment) return '';
  const { data: role } = await db
    .from('roles')
    .select('slug')
    .eq('id', assignment.role_id)
    .maybeSingle();
  return String((role as { slug?: string } | null)?.slug ?? '');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);

  try {
    if (subPath(req) === '' && method(req) === 'GET') {
      const auth = await authorizeAfHomes(req, 'network.referrals');
      if ('error' in auth) return deny(res, auth);
      const { data, error } = await db
        .from('referral_relationships')
        .select(SELECT_RELATIONSHIP)
        .order('assigned_at', { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as Record<string, unknown>[];
      if (
        !['vice_director', 'senior_sales_manager', 'sales_manager', 'ost'].includes(auth.roleSlug)
      )
        return list(res, rows.map(toRelationship));
      const active = rows.filter((row) => row.is_active === true);
      const parent = new Map(
        active.map((row) => [String(row.subject_staff_id), String(row.upline_staff_id)]),
      );
      const children = new Map<string, string[]>();
      for (const [child, upline] of parent)
        children.set(upline, [...(children.get(upline) ?? []), child]);
      const visible = new Set<string>([auth.userId]);
      let cursor = parent.get(auth.userId);
      let depth = 0;
      while (cursor && depth++ < 4 && !visible.has(cursor)) {
        visible.add(cursor);
        cursor = parent.get(cursor);
      }
      if (auth.roleSlug !== 'ost') {
        const queue = [...(children.get(auth.userId) ?? [])];
        while (queue.length && visible.size < 10000) {
          const id = queue.shift()!;
          if (visible.has(id)) continue;
          visible.add(id);
          queue.push(...(children.get(id) ?? []));
        }
      }
      return list(
        res,
        rows
          .filter(
            (row) =>
              visible.has(String(row.subject_staff_id)) || visible.has(String(row.upline_staff_id)),
          )
          .map(toRelationship),
      );
    }

    /* ---------------- assign an upline ---------------- */
    if (subPath(req) === '' && method(req) === 'POST') {
      const auth = await authorizeAfHomes(req, 'sales.uplines', 'create');
      if ('error' in auth) return deny(res, auth);
      const parsed = createReferralSchema.safeParse(jsonBody(req));
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid upline assignment', 400);
      const input = parsed.data;

      if (input.subjectStaffId === input.uplineStaffId)
        return fail(res, 'VALIDATION_ERROR', 'A person cannot be their own upline', 400);

      const [{ data: subject }, { data: upline }] = await Promise.all([
        db.from('staff_users').select('id, status').eq('id', input.subjectStaffId).maybeSingle(),
        db.from('staff_users').select('id, status').eq('id', input.uplineStaffId).maybeSingle(),
      ]);
      if (!subject) return fail(res, 'NOT_FOUND', 'Subject not found', 404);
      if (!upline) return fail(res, 'NOT_FOUND', 'Upline not found', 404);
      if (subject.status !== 'active') return fail(res, 'CONFLICT', 'Subject is not active', 409);
      if (upline.status !== 'active') return fail(res, 'CONFLICT', 'Upline is not active', 409);

      // The declared level must match the upline's real role, and the upline
      // must sit strictly above the subject in the hierarchy.
      const [subjectRole, uplineRole] = await Promise.all([
        roleSlugOf(db, input.subjectStaffId),
        roleSlugOf(db, input.uplineStaffId),
      ]);
      if (subjectRole !== input.hierarchyRole)
        return fail(
          res,
          'VALIDATION_ERROR',
          `Subject role "${subjectRole}" does not match the declared level`,
          400,
        );
      if (!hierarchyAllowsUpline(input.hierarchyRole, uplineRole as never))
        return fail(
          res,
          'VALIDATION_ERROR',
          `A ${input.hierarchyRole.replace(/_/g, ' ')} cannot report to a ${String(uplineRole).replace(/_/g, ' ')}`,
          400,
        );

      const { data, error } = await db
        .from('referral_relationships')
        .insert({
          subject_staff_id: input.subjectStaffId,
          upline_staff_id: input.uplineStaffId,
          hierarchy_role: input.hierarchyRole,
          is_authoritative: true,
          is_active: true,
          assigned_by: auth.userId,
        })
        .select(SELECT_RELATIONSHIP)
        .single();
      if (error) {
        if ((error as { code?: string }).code === '23505')
          return fail(res, 'CONFLICT', 'That person already has an active upline', 409);
        throw error;
      }

      await audit(
        db,
        auth.userId,
        'UPLINE_ASSIGNED',
        'referral_relationship',
        String((data as { id: string }).id),
        null,
        {
          subjectStaffId: input.subjectStaffId,
          uplineStaffId: input.uplineStaffId,
          hierarchyRole: input.hierarchyRole,
        },
      );
      return res.status(201).json(toRelationship(data as Record<string, unknown>));
    }

    /* ---------------- correct an upline ---------------- */
    const correct = route(req, 'PATCH', /^([0-9a-f-]+)$/);
    if (correct) {
      const auth = await authorizeAfHomes(req, 'sales.uplines', 'update');
      if ('error' in auth) return deny(res, auth);
      const parsed = correctReferralSchema.safeParse(jsonBody(req));
      if (!parsed.success)
        return fail(res, 'VALIDATION_ERROR', 'A correction requires a reason', 400);
      const id = correct[1]!;

      const { data: before, error: readError } = await db
        .from('referral_relationships')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (readError) throw readError;
      if (!before) return fail(res, 'NOT_FOUND', 'Relationship not found', 404);
      if (before.upline_staff_id === parsed.data.uplineStaffId)
        return fail(res, 'CONFLICT', 'That is already the assigned upline', 409);
      if (before.subject_staff_id === parsed.data.uplineStaffId)
        return fail(res, 'VALIDATION_ERROR', 'A person cannot be their own upline', 400);

      const { data: upline } = await db
        .from('staff_users')
        .select('id, status')
        .eq('id', parsed.data.uplineStaffId)
        .maybeSingle();
      if (!upline) return fail(res, 'NOT_FOUND', 'Upline not found', 404);
      if (upline.status !== 'active') return fail(res, 'CONFLICT', 'Upline is not active', 409);

      // The retire-then-insert must be atomic: the partial unique index allows
      // only one active upline per subject, so two separate writes would either
      // violate it or strand the subject. The RPC does both under a row lock.
      const uplineRole = await roleSlugOf(db, parsed.data.uplineStaffId);
      if (!hierarchyAllowsUpline(before.hierarchy_role as never, uplineRole as never))
        return fail(
          res,
          'VALIDATION_ERROR',
          `A ${String(before.hierarchy_role).replace(/_/g, ' ')} cannot report to a ${String(uplineRole).replace(/_/g, ' ')}`,
          400,
        );

      const { data: newId, error: rpcError } = await db.rpc('correct_referral_upline', {
        p_relationship_id: id,
        p_upline_staff_id: parsed.data.uplineStaffId,
        p_reason: parsed.data.reason,
        p_actor_id: auth.userId,
      });
      if (rpcError) return mapRpcError(res, rpcError);

      const { data: created, error: readBack } = await db
        .from('referral_relationships')
        .select(SELECT_RELATIONSHIP)
        .eq('id', String(newId))
        .maybeSingle();
      if (readBack) throw readBack;
      if (!created) return fail(res, 'INTERNAL', 'Correction did not produce a relationship', 500);
      return res.status(200).json(toRelationship(created as Record<string, unknown>));
    }

    return fail(res, 'NOT_FOUND', 'Referral endpoint not found', 404);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[api] referrals:', error instanceof Error ? error.message : error);
    mapRpcError(res, error as { message?: string });
  }
}
