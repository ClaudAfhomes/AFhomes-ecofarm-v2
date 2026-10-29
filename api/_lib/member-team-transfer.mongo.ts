import { randomUUID } from 'node:crypto';
import type { Db, MongoClient } from 'mongodb';
import { transferOstTeamSchema } from '@afhomes/contracts';
import type { authorizeAfHomes } from './afhomes-access.js';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { createMongoOstAccess } from './ost-accreditation.mongo.js';
import { manilaToday } from './sale-team.mongo.js';
import { jsonBody } from './handler-kit.js';
import type { VercelRequest } from './http.js';

const refuse = (status: number, message: string): never => {
  throw new CustomerActivationError(status, message);
};

/** Native transfer_ost_team: a team move never renews accreditation or rewrites sale history. */
export async function transferMongoOstTeam(
  db: Db,
  client: MongoClient,
  authorize: typeof authorizeAfHomes,
  req: VercelRequest,
  id: string,
) {
  const input = transferOstTeamSchema.parse(jsonBody(req));
  const col = (name: string) => db.collection<MongoRow>(name);
  const access = createMongoOstAccess(db);
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      // Renewals, role changes and transfers take the same organization lock.
      await db
        .collection<{ _id: string; seq: number }>('counters')
        .updateOne({ _id: 'organization-write' }, { $inc: { seq: 1 } }, { upsert: true, session });
      const actor = await authorize(req, 'network.members', 'update');
      if ('error' in actor) return refuse(actor.error.status, 'Member transfer is not permitted');
      const reviewer = await authorize(req, 'network.ost_registrations', 'update');
      if ('error' in reviewer)
        return refuse(reviewer.error.status, 'Accreditation review is not permitted');
      if (
        actor.userId !== reviewer.userId ||
        actor.roleSlug !== reviewer.roleSlug ||
        !['admin', 'super_admin', 'senior_sales_manager', 'vice_director'].includes(
          actor.roleSlug,
        ) ||
        actor.mustChangePassword
      )
        refuse(403, 'Accreditation reviewer permission required');
      const member = await access.required('ost_members', id, session);
      await access.scope(actor, member, session);
      const replay = await col('ost_team_transfers').findOne({ _id: input.requestId }, { session });
      if (replay) {
        if (
          replay.ost_id !== id ||
          replay.approved_by !== actor.userId ||
          replay.new_sponsor_staff_id !== input.sponsorStaffId ||
          replay.reason !== input.reason
        )
          refuse(409, 'This request ID was already used for a different transfer');
        return;
      }
      const staff = await access.required('staff_users', id, session);
      const role = await access.role(id, session);
      if (member.status !== 'active' || staff.status !== 'active' || role?.slug !== 'ost')
        refuse(409, 'Active OST identity required');
      const terms = await col('ost_accreditation_terms')
        .find({ ost_id: id, status: 'active' }, { session })
        .toArray();
      const term = terms[0];
      if (
        terms.length !== 1 ||
        !term ||
        !/^\d{4}-\d{2}-\d{2}$/.test(String(term.expires_on)) ||
        String(term.expires_on) >= manilaToday()
      )
        refuse(409, 'Expired OST accreditation required for a team transfer');
      if (
        await col('ost_accreditation_renewals').findOne(
          {
            ost_id: id,
            status: { $in: ['submitted', 'under_review', 'changes_requested', 'endorsed'] },
          },
          { session },
        )
      )
        refuse(409, 'Complete the in-progress renewal before transferring');
      if (input.sponsorStaffId === member.sponsor_staff_id)
        refuse(409, 'Choose a different Sales Manager');
      await access.sponsor(input.sponsorStaffId, session, true);
      await access.scope(actor, { ...member, sponsor_staff_id: input.sponsorStaffId }, session);
      const edges = await col('referral_relationships')
        .find({ subject_staff_id: id, is_active: true }, { session })
        .toArray();
      const edge = edges[0];
      if (
        edges.length !== 1 ||
        !edge ||
        edge.hierarchy_role !== 'ost' ||
        edge.is_authoritative !== true ||
        edge.upline_staff_id !== member.sponsor_staff_id
      )
        refuse(409, 'Current OST genealogy requires review before transfer');
      const now = new Date().toISOString();
      await col('ost_team_transfers').insertOne(
        {
          _id: input.requestId,
          request_id: input.requestId,
          ost_id: id,
          prior_term_id: term!._id,
          old_sponsor_staff_id: member.sponsor_staff_id,
          new_sponsor_staff_id: input.sponsorStaffId,
          reason: input.reason,
          approved_by: actor.userId,
          approved_at: now,
        },
        { session },
      );
      await col('referral_relationships').updateOne(
        { _id: edge!._id },
        { $set: { is_active: false, updated_at: now } },
        { session },
      );
      await col('referral_relationships').insertOne(
        {
          _id: randomUUID(),
          subject_staff_id: id,
          upline_staff_id: input.sponsorStaffId,
          hierarchy_role: 'ost',
          is_authoritative: true,
          is_active: true,
          assigned_by: actor.userId,
          assigned_at: now,
          updated_at: now,
        },
        { session },
      );
      await col('ost_members').updateOne(
        { _id: id },
        { $set: { sponsor_staff_id: input.sponsorStaffId } },
        { session },
      );
      await col('network_member_profiles').updateOne(
        { staff_id: id },
        { $set: { referrer_staff_id: input.sponsorStaffId } },
        { session },
      );
      await col('audit_events').insertOne(
        {
          _id: randomUUID(),
          actor_id: actor.userId,
          action: 'OST_TEAM_TRANSFER_APPROVED',
          entity_type: 'ost_member',
          entity_id: id,
          before_data: { sponsorStaffId: member.sponsor_staff_id, relationshipId: edge!._id },
          after_data: {
            sponsorStaffId: input.sponsorStaffId,
            requestId: input.requestId,
            reason: input.reason,
          },
          created_at: now,
        },
        { session },
      );
    });
  } finally {
    await session.endSession();
  }
}
