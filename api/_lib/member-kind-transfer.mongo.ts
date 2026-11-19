import { randomUUID } from 'node:crypto';
import type { Db, MongoClient } from 'mongodb';
import {
  transferMemberSchema,
  ostAnnualExpiry,
  MEMBER_UPLINE_ROLE,
  MEMBER_POSITIONS,
  type MemberPosition,
} from '@afhomes/contracts';
import type { authorizeAfHomes } from './afhomes-access.js';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import {
  createMongoPurchaseRecords,
  allocatePurchaseId,
  purchaseFingerprint,
} from './purchase-records.mongo.js';
import { createMongoOstAccess } from './ost-accreditation.mongo.js';
import { createMongoSaleTeamRecords, manilaToday } from './sale-team.mongo.js';
import { verifyOstAddress } from './ost-address.js';
import { hashIdentifier } from './identifier.js';
import { jsonBody } from './handler-kit.js';
import type { VercelRequest } from './http.js';

const refuse = (status: number, message: string): never => {
  throw new CustomerActivationError(status, message);
};

/** Latest transfer_sale_team_member rules; no Auth identity or credential is replaced. */
export async function transferMongoMemberKind(
  db: Db,
  client: MongoClient,
  authorize: typeof authorizeAfHomes,
  req: VercelRequest,
  id: string,
) {
  const input = transferMemberSchema.parse(jsonBody(req));
  if (input.direction === 'IST_TO_OST') {
    const verified = await verifyOstAddress(input.identity);
    if (!verified.ok) refuse(verified.status, 'Choose a verified address hierarchy');
    if (verified.ok) input.identity = verified.identity;
  }
  const col = (name: string) => db.collection<MongoRow>(name);
  const records = createMongoPurchaseRecords(db),
    access = createMongoOstAccess(db);
  const payload = { staffId: id, ...input },
    session = client.startSession();
  try {
    await session.withTransaction(async () => {
      await db
        .collection<{ _id: string; seq: number }>('counters')
        .updateOne({ _id: 'organization-write' }, { $inc: { seq: 1 } }, { upsert: true, session });
      const actor = await authorize(req, 'network.members', 'update');
      if ('error' in actor) return refuse(actor.error.status, 'Member conversion is not permitted');
      const manager = await authorize(req, 'organization.staff', 'update');
      if ('error' in manager)
        return refuse(manager.error.status, 'Staff management permission required');
      if (actor.userId !== manager.userId || !['admin', 'super_admin'].includes(manager.roleSlug))
        refuse(403, 'Administrator approval required');
      if (
        await records.replay(actor.userId, 'sale_team.transfer', input.requestId, payload, session)
      )
        return;
      const staff = await access.required('staff_users', id, session),
        currentRole = await access.role(id, session);
      if (!currentRole || !MEMBER_POSITIONS.includes(currentRole.slug as MemberPosition))
        refuse(404, 'Member not found');
      if (staff.status !== 'active') refuse(409, 'Active member required');
      const old = await col('sale_team_accreditations').findOne({ staff_id: id }, { session });
      if (!old) refuse(409, 'Accreditation required');
      const now = new Date().toISOString();
      let number: string, kind: 'IST' | 'OST', start: string | null, end: string | null;
      let role: MongoRow | null, head: string | null;
      let evidence: Record<string, unknown> = {};
      if (input.direction === 'IST_TO_OST') {
        if (
          old!.kind !== 'IST' ||
          old!.status !== 'active' ||
          !/^AAI[0-9]+$/.test(String(old!.aa_number))
        )
          refuse(409, 'Active IST accreditation required');
        if (input.sponsorStaffId === id) refuse(400, 'A member cannot sponsor themselves');
        const sponsor = await access.sponsor(input.sponsorStaffId, session, true);
        if (input.identity.email?.toLowerCase() !== String(staff.email).toLowerCase())
          refuse(409, 'The OST identity must use the existing staff login email');
        if (
          await col('ost_members').findOne(
            { _id: { $ne: id }, email: String(staff.email).toLowerCase() },
            { session },
          )
        )
          refuse(409, 'An OST identity with this email already exists');
        if (
          await col('ost_applications').findOne(
            {
              status: { $in: ['submitted', 'under_review', 'changes_requested'] },
              $or: [{ email: String(staff.email).toLowerCase() }, { phone: input.identity.phone }],
            },
            { session },
          )
        )
          refuse(409, 'Complete the in-progress OST application first');
        if (input.expiresOn !== ostAnnualExpiry(input.startsOn))
          refuse(400, 'OST accreditation requires one-year validity');
        if (!input.form.applicantSignedOn || !input.form.referrerSignedOn)
          refuse(400, 'Signed evidence dates required');
        if (
          await col('referral_relationships').findOne(
            { upline_staff_id: id, is_active: true },
            { session },
          )
        )
          refuse(409, 'Reassign active downlines before converting to OST');
        number = 'AAO' + String(old!.aa_number).slice(3);
        kind = 'OST';
        start = input.startsOn;
        end = input.expiresOn;
        head = input.sponsorStaffId;
        for (const table of ['sale_team_accreditations', 'sale_team_accreditation_history'])
          if (await col(table).findOne({ aa_number: number }, { session }))
            refuse(409, 'Accreditation number already used');
        const oldEdge = await col('referral_relationships').findOne(
          { subject_staff_id: id, is_active: true },
          { session },
        );
        await col('ost_ist_conversions').insertOne(
          {
            _id: input.requestId,
            request_id: input.requestId,
            staff_id: id,
            from_aa_number: old!.aa_number,
            to_aa_number: number,
            from_role: currentRole!.slug,
            from_upline_staff_id: oldEdge?.upline_staff_id ?? null,
            effective_date: start,
            approved_by: actor.userId,
            approved_at: now,
          },
          { session },
        );
        const application = randomUUID(),
          code = randomUUID();
        await col('referral_codes').insertOne(
          {
            _id: code,
            code_hash: hashIdentifier(randomUUID()),
            code_hint: 'MANUAL',
            sponsor_staff_id: head,
            expires_at: now,
            max_uses: 1,
            use_count: 1,
            is_active: false,
            created_by: actor.userId,
          },
          { session },
        );
        await col('ost_applications').insertOne(
          {
            _id: application,
            referral_code_id: code,
            sponsor_staff_id: head,
            email: String(staff.email).toLowerCase(),
            phone: input.identity.phone,
            first_name: input.identity.firstName,
            middle_name: input.identity.middleName || null,
            last_name: input.identity.lastName,
            birth_date: input.identity.birthDate,
            address: input.identity.address,
            registration_details: {
              officialAccreditation: true,
              addressHierarchy: input.identity.addressHierarchy ?? null,
            },
            status: 'approved',
            reviewed_by: actor.userId,
            reviewed_at: now,
            submitted_at: now,
          },
          { session },
        );
        const {
          dateApplied,
          programCategory,
          vipCardType,
          applicantSignatureStatus,
          referrerSignatureStatus,
          referrerSnapshot,
          ...official
        } = input.form;
        await col('ost_registration_details').insertOne(
          {
            _id: randomUUID(),
            application_id: application,
            request_id: randomUUID(),
            payload_hash: purchaseFingerprint({
              direction: input.direction,
              staff: id,
              identity: input.identity,
              form: input.form,
              sponsor: head,
            }),
            date_applied: dateApplied,
            form_number: 'AF-' + application.replaceAll('-', '').toUpperCase(),
            program_category: programCategory,
            vip_card_type: vipCardType,
            official_details: official,
            referrer_snapshot: { ...referrerSnapshot, ...sponsor },
            applicant_signature_status: applicantSignatureStatus,
            referrer_signature_status: referrerSignatureStatus,
            applicant_signed_on: input.form.applicantSignedOn,
            referrer_signed_on: input.form.referrerSignedOn,
            source: 'manual',
            created_by: actor.userId,
            created_at: now,
            endorsed_at: null,
            endorsed_by: null,
          },
          { session },
        );
        const member = await col('ost_members').findOne({ _id: id }, { session });
        const ostNumber =
          member?.ost_number ??
          (await allocatePurchaseId(db, 'AF-OST', 'ost_members', 'ost_number', session));
        await col('ost_members').updateOne(
          { _id: id },
          {
            $set: {
              application_id: application,
              sponsor_staff_id: head,
              full_name: [
                input.identity.firstName,
                input.identity.middleName,
                input.identity.lastName,
              ]
                .filter(Boolean)
                .join(' '),
              phone: input.identity.phone,
              status: 'active',
              approved_by: actor.userId,
              approved_at: now,
            },
            $setOnInsert: {
              email: String(staff.email).toLowerCase(),
              ost_number: ostNumber,
              created_at: now,
            },
          },
          { upsert: true, session },
        );
        const term = randomUUID();
        await col('ost_accreditation_terms').insertOne(
          {
            _id: term,
            ost_id: id,
            application_id: application,
            starts_on: start,
            expires_on: end,
            status: 'active',
            approved_by: actor.userId,
            approved_at: now,
          },
          { session },
        );
        role = await col('roles').findOne({ slug: 'ost', is_active: true }, { session });
        evidence = { termId: term, ostNumber, applicationId: application };
      } else {
        if (old!.kind !== 'OST') refuse(409, 'OST accreditation required');
        if (
          await col('ost_accreditation_renewals').findOne(
            {
              ost_id: id,
              status: { $in: ['submitted', 'under_review', 'changes_requested', 'endorsed'] },
            },
            { session },
          )
        )
          refuse(409, 'Complete the in-progress renewal first');
        const member = await col('ost_members').findOne({ _id: id, status: 'active' }, { session });
        const terms = await col('ost_accreditation_terms')
          .find({ ost_id: id, status: 'active' }, { session })
          .toArray();
        if (
          !member ||
          terms.length !== 1 ||
          !/^\d{4}-\d{2}-\d{2}$/.test(String(terms[0]?.expires_on)) ||
          String(terms[0]?.expires_on) >= manilaToday()
        )
          refuse(409, 'Expired active OST accreditation required');
        role = await col('roles').findOne(
          { slug: input.targetPosition, is_active: true },
          { session },
        );
        head = input.headStaffId;
        if (head) {
          const parent = await access.required('staff_users', head, session),
            parentRole = await access.role(head, session);
          if (
            head === id ||
            parent.status !== 'active' ||
            parentRole?.slug !== MEMBER_UPLINE_ROLE[input.targetPosition]
          )
            refuse(400, 'Head must be the active immediate upline');
          const seen = new Set([id]);
          let cursor: string | null = head;
          while (cursor) {
            if (seen.has(cursor)) refuse(400, 'Genealogy cycle');
            seen.add(cursor);
            const edge: MongoRow | null = await col('referral_relationships').findOne(
              { subject_staff_id: cursor, is_active: true },
              { session },
            );
            cursor = edge ? String(edge.upline_staff_id) : null;
          }
        }
        await col('ost_members').updateOne(
          { _id: id },
          { $set: { status: 'inactive' } },
          { session },
        );
        await col('ost_accreditation_terms').updateOne(
          { _id: terms[0]!._id },
          { $set: { status: 'revoked' } },
          { session },
        );
        kind = 'IST';
        start = null;
        end = null;
        number = await createMongoSaleTeamRecords(db).allocate('IST', manilaToday(), session);
        await col('network_member_profiles').updateOne(
          { staff_id: id },
          { $set: { referrer_staff_id: head, ost_referrer_staff_id: null, updated_at: now } },
          { session },
        );
        evidence = { identityIssuedOn: manilaToday(), startsOn: null, expiresOn: null };
        if (!staff.sales_number)
          await col('staff_users').updateOne(
            { _id: id },
            {
              $set: {
                sales_number: await allocatePurchaseId(
                  db,
                  'AF-SALES',
                  'staff_users',
                  'sales_number',
                  session,
                ),
              },
            },
            { session },
          );
      }
      if (!role) refuse(409, 'Target position is not active');
      await col('sale_team_accreditation_history').insertOne(
        {
          _id: randomUUID(),
          staff_id: id,
          aa_number: old!.aa_number,
          kind: old!.kind,
          public_name: old!.public_name,
          starts_on: old!.starts_on ?? null,
          expires_on: old!.expires_on ?? null,
          event: 'transferred',
          status: 'superseded',
          successor_aa_number: number!,
          reason: input.reason,
          recorded_by: actor.userId,
          recorded_at: now,
        },
        { session },
      );
      await col('sale_team_accreditations').updateOne(
        { _id: old!._id },
        {
          $set: {
            aa_number: number!,
            kind: kind!,
            public_name: staff.full_name,
            status: 'active',
            starts_on: start!,
            expires_on: end!,
            approved_by: actor.userId,
            approved_at: now,
            revoked_by: null,
            revoked_at: null,
          },
        },
        { session },
      );
      await col('staff_role_assignments').updateOne(
        { staff_id: id },
        { $set: { role_id: role!._id, assigned_by: actor.userId } },
        { session },
      );
      await col('referral_relationships').updateMany(
        { subject_staff_id: id, is_active: true },
        { $set: { is_active: false, updated_at: now } },
        { session },
      );
      if (head!)
        await col('referral_relationships').insertOne(
          {
            _id: randomUUID(),
            subject_staff_id: id,
            upline_staff_id: head!,
            hierarchy_role: role!.slug,
            is_authoritative: true,
            is_active: true,
            assigned_by: actor.userId,
            assigned_at: now,
            updated_at: now,
          },
          { session },
        );
      await records.audit(
        actor.userId,
        'SALE_TEAM_ACCREDITATION_TRANSFERRED',
        'staff_user',
        id,
        {
          kind: old!.kind,
          aaNumber: old!.aa_number,
          startsOn: old!.starts_on ?? null,
          expiresOn: old!.expires_on ?? null,
        },
        {
          direction: input.direction,
          kind: kind!,
          aaNumber: number!,
          reason: input.reason,
          ...evidence,
        },
        session,
      );
      await records.complete(
        actor.userId,
        'sale_team.transfer',
        input.requestId,
        payload,
        id,
        session,
      );
    });
  } finally {
    await session.endSession();
  }
}
