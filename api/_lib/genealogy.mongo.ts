import type { Db } from 'mongodb';
import { z } from 'zod';
import type { authorizeAfHomes } from './afhomes-access.js';
import { projectGenealogy, type GenealogyInput } from './genealogy-model.js';
import type { MongoRow } from './customer-activation.mongo.js';
import { deny, fail, list, method, subPath } from './handler-kit.js';
import type { VercelRequest, VercelResponse } from './http.js';

export function createMongoGenealogyHandler(db: Db, authorize: typeof authorizeAfHomes) {
  const col = (name: string) => db.collection<MongoRow>(name);
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    if (method(req) !== 'GET') return fail(res, 'NOT_FOUND', 'Genealogy endpoint not found', 404);
    const auth = await authorize(req, 'network.genealogy');
    if ('error' in auth) return deny(res, auth);
    try {
      const path = subPath(req);
      if (path === 'ost-contacts') {
        const ids = z
          .string()
          .max(40000)
          .parse(req.query.staffIds)
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean);
        const [staff, ost] = await Promise.all([
          col('staff_users')
            .find({ _id: { $in: ids } }, { projection: { email: 1 } })
            .toArray(),
          col('ost_members')
            .find({ _id: { $in: ids } }, { projection: { phone: 1, email: 1 } })
            .toArray(),
        ]);
        return res
          .status(200)
          .json(
            Object.fromEntries(
              ids.map((id) => [
                id,
                {
                  phone: ost.find((row) => row._id === id)?.phone ?? null,
                  email:
                    staff.find((row) => row._id === id)?.email ??
                    ost.find((row) => row._id === id)?.email ??
                    '',
                },
              ]),
            ),
          );
      }
      const [staff, assign, roles, rels, ost] = await Promise.all([
        col('staff_users')
          .find({}, { projection: { full_name: 1, status: 1 } })
          .sort({ _id: 1 })
          .toArray(),
        col('staff_role_assignments')
          .find({}, { projection: { staff_id: 1, role_id: 1 } })
          .sort({ staff_id: 1, role_id: 1 })
          .toArray(),
        col('roles')
          .find({ is_active: true }, { projection: { slug: 1 } })
          .sort({ _id: 1 })
          .toArray(),
        col('referral_relationships')
          .find({}, { projection: { subject_staff_id: 1, upline_staff_id: 1, is_active: 1 } })
          .sort({ subject_staff_id: 1, upline_staff_id: 1 })
          .toArray(),
        col('ost_members')
          .find({}, { projection: { status: 1 } })
          .sort({ _id: 1 })
          .toArray(),
      ]);
      const input: GenealogyInput = {
        staff: z
          .array(
            z.object({
              _id: z.string(),
              full_name: z.string(),
              status: z.enum(['invited', 'active', 'inactive', 'suspended']),
            }),
          )
          .parse(staff)
          .map((row) => ({ ...row, id: row._id })),
        assign: z.array(z.object({ staff_id: z.string(), role_id: z.string() })).parse(assign),
        roles: z
          .array(z.object({ _id: z.string(), slug: z.string() }))
          .parse(roles)
          .map((row) => ({ ...row, id: row._id })),
        rels: z
          .array(
            z.object({
              subject_staff_id: z.string(),
              upline_staff_id: z.string(),
              is_active: z.boolean(),
            }),
          )
          .parse(rels),
        ost: z
          .array(z.object({ _id: z.string(), status: z.enum(['active', 'inactive', 'suspended']) }))
          .parse(ost)
          .map((row) => ({ ...row, id: row._id })),
      };
      const graph = projectGenealogy(input, auth);
      if (!path) return list(res, graph.nodes);
      const match = /^([a-f0-9-]{36})(?:\/(upline|downline|summary))?$/.exec(path);
      if (!match) return fail(res, 'NOT_FOUND', 'Genealogy endpoint not found', 404);
      const id = match[1]!,
        sellers = ['vice_director', 'senior_sales_manager', 'sales_manager', 'ost'];
      const target = graph.nodes.find((row) => row.staffId === id);
      const permitted =
        !sellers.includes(auth.roleSlug) ||
        id === auth.userId ||
        (['vice_director', 'senior_sales_manager', 'sales_manager'].includes(auth.roleSlug) &&
          graph.descendants(auth.userId).includes(id) &&
          !!target &&
          (auth.roleSlug !== 'sales_manager' || input.ost.some((row) => row.id === id)));
      if (!permitted)
        return fail(res, 'FORBIDDEN', 'Genealogy record is outside your authorized scope', 403);
      if (!target) return fail(res, 'NOT_FOUND', 'Seller not found', 404);
      const members = graph
        .descendants(id)
        .filter((key) => graph.visible.has(key))
        .flatMap((key) => graph.nodes.filter((row) => row.staffId === key));
      if (match[2] === 'upline')
        return list(
          res,
          graph.ancestors(id).flatMap((key) => graph.nodes.filter((row) => row.staffId === key)),
        );
      if (match[2] === 'downline') return list(res, members);
      if (match[2] === 'summary') {
        const counts = { vice_director: 0, senior_sales_manager: 0, sales_manager: 0, ost: 0 };
        for (const row of members) counts[row.role]++;
        const active = members.filter(
          (row) =>
            row.status === 'active' && (row.ostStatus === null || row.ostStatus === 'active'),
        ).length;
        return res
          .status(200)
          .json({
            staffId: id,
            totalDirectDownline: target.directDownlineCount,
            totalDescendants: members.length,
            activeSellerCount: active,
            inactiveSellerCount: members.length - active,
            roleCounts: counts,
          });
      }
      return res.status(200).json(target);
    } catch (error) {
      if (error instanceof z.ZodError)
        return fail(res, 'VALIDATION_ERROR', 'Invalid genealogy query or record', 400);
      return fail(res, 'INTERNAL', 'Genealogy service is unavailable', 503);
    }
  };
}
