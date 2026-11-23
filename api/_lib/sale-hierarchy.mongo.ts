import type { Db, ClientSession } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
export async function captureMongoSaleHierarchy(
  db: Db,
  saleId: string,
  sellerId: string,
  now: string,
  session: ClientSession,
) {
  const col = (name: string) => db.collection<MongoRow>(name);
  const refuse = (status: number, message: string): never => {
    throw new CustomerActivationError(status, message);
  };
  const roleOf = async (id: string, session: ClientSession) => {
    const assignment = await col('staff_role_assignments').findOne({ staff_id: id }, { session });
    return assignment
      ? col('roles').findOne({ _id: String(assignment.role_id) }, { session })
      : null;
  };
  const role = await roleOf(sellerId, session),
    slug = String(role?.slug ?? '');
  if (['admin', 'super_admin'].includes(slug)) return;
  const expected = { vice_director: 0, senior_sales_manager: 1, sales_manager: 2, ost: 3 }[
    slug as 'ost'
  ];
  if (expected === undefined) refuse(409, 'SALE_SELLER_HIERARCHY_ROLE_REQUIRED');
  let current = sellerId,
    currentRole = slug,
    depth = 0;
  const seen = new Set<string>();
  while (true) {
    if (seen.has(current) || depth > 3) refuse(409, 'SALE_HIERARCHY_TOO_DEEP');
    seen.add(current);
    await col('card_sale_hierarchy_snapshots').insertOne(
      {
        _id: randomUUID(),
        sale_id: saleId,
        ancestor_staff_id: current,
        ancestor_role: currentRole,
        depth,
        captured_at: now,
      },
      { session },
    );
    if (currentRole === 'vice_director') break;
    const edges = await col('referral_relationships')
      .find({ subject_staff_id: current, is_active: true, is_authoritative: true }, { session })
      .limit(2)
      .toArray();
    if (edges.length !== 1 || !edges[0]?.upline_staff_id)
      refuse(409, 'SALE_COMPLETE_HIERARCHY_REQUIRED');
    current = String(edges[0]!.upline_staff_id);
    currentRole = String((await roleOf(current, session))?.slug ?? '');
    depth++;
  }
  if (depth !== expected) refuse(409, 'SALE_COMPLETE_HIERARCHY_REQUIRED');
}
