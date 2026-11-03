import { randomUUID } from 'node:crypto';
import type { ClientSession, Db, MongoClient } from 'mongodb';
import {
  ostAccreditationRecordsSchema,
  ostApplicantSnapshotSchema,
  ostAnnualExpiry,
  ostRenewalDecisionSchema,
  submitOstRenewalSchema,
  updateOstApplicantSchema,
  type SubmitOstRenewal,
} from '@afhomes/contracts';
import type { authorizeAfHomes, resolveAfHomesPrincipal } from './afhomes-access.js';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { createMongoPurchaseRecords, purchaseFingerprint } from './purchase-records.mongo.js';
import { verifyOstAddressDetails } from './ost-address.js';
import { createMongoSaleTeamRecords, manilaToday } from './sale-team.mongo.js';
import { deny, fail, jsonBody, method, subPath } from './handler-kit.js';
import type { VercelRequest, VercelResponse } from './http.js';

type Principal = Exclude<Awaited<ReturnType<typeof authorizeAfHomes>>, { error: unknown }>;
const refuse = (status: number, message: string): never => {
  throw new CustomerActivationError(status, message);
};
const nullable = (value: unknown) => (typeof value === 'string' && value ? value : null);
const reviewers = ['admin', 'super_admin', 'senior_sales_manager', 'vice_director'];

/** Operator-only setup; never invoked by localhost startup or an HTTP request. */
export async function setupMongoOstAccreditation(db: Db) {
  for (const field of ['request_id', 'application_id', 'form_number'])
    await db.collection('ost_registration_details').createIndex(
      { [field]: 1 },
      {
        unique: true,
        partialFilterExpression: { [field]: { $type: 'string' } },
      },
    );
  await db.collection('ost_members').createIndex(
    { application_id: 1 },
    {
      unique: true,
      partialFilterExpression: { application_id: { $type: 'string' } },
    },
  );
  await db.collection('ost_members').createIndex({ ost_number: 1 }, { unique: true });
  await db
    .collection('ost_accreditation_terms')
    .createIndex({ ost_id: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });
  for (const field of ['application_id', 'renewal_id'])
    await db
      .collection('ost_accreditation_terms')
      .createIndex(
        { [field]: 1 },
        { unique: true, partialFilterExpression: { [field]: { $type: 'string' } } },
      );
  for (const field of ['request_id', 'renewal_number'])
    await db.collection('ost_accreditation_renewals').createIndex({ [field]: 1 }, { unique: true });
  await db.collection('ost_accreditation_renewals').createIndex(
    { ost_id: 1 },
    {
      unique: true,
      partialFilterExpression: {
        status: { $in: ['submitted', 'under_review', 'changes_requested', 'endorsed'] },
      },
    },
  );
}

export function createMongoOstAccess(db: Db) {
  const col = (name: string) => db.collection<MongoRow>(name);
  async function required(table: string, id: string, session: ClientSession) {
    const row = await col(table).findOne({ _id: id }, { session });
    if (!row) refuse(404, 'Accreditation record not found');
    return row!;
  }
  async function role(id: string, session: ClientSession) {
    const assignment = await col('staff_role_assignments').findOne({ staff_id: id }, { session });
    return (
      assignment &&
      (await col('roles').findOne(
        { _id: String(assignment.role_id), is_active: true },
        { session },
      ))
    );
  }
  async function sponsor(id: string, session: ClientSession, manual = false) {
    const staff = await required('staff_users', id, session),
      assigned = await role(id, session);
    if (
      staff.status !== 'active' ||
      !assigned ||
      !['vice_director', 'senior_sales_manager', 'sales_manager'].includes(String(assigned.slug))
    )
      refuse(409, 'Active sponsor required');
    if (manual) {
      if (assigned!.slug !== 'sales_manager') refuse(409, 'Active Sales Manager required');
      let current = id;
      const seen = new Set([id]);
      for (const expected of ['senior_sales_manager', 'vice_director']) {
        const edge = await col('referral_relationships').findOne(
          {
            subject_staff_id: current,
            is_active: true,
            hierarchy_role:
              expected === 'senior_sales_manager' ? 'sales_manager' : 'senior_sales_manager',
          },
          { session },
        );
        if (!edge || seen.has(String(edge.upline_staff_id)))
          refuse(409, 'Complete Sales Manager hierarchy required');
        current = String(edge!.upline_staff_id);
        seen.add(current);
        const parent = await required('staff_users', current, session),
          assignedParent = await role(current, session);
        if (parent.status !== 'active' || assignedParent?.slug !== expected)
          refuse(409, 'Complete Sales Manager hierarchy required');
      }
    }
    return { staffId: id, name: String(staff.full_name), email: String(staff.email) };
  }
  async function scope(actor: Principal, member: MongoRow, session: ClientSession) {
    if (actor.roleSlug === 'ost') {
      if (actor.userId !== member._id || member.status !== 'active')
        refuse(403, 'Only your own active accreditation is available');
      return;
    }
    if (
      ['vice_director', 'senior_sales_manager', 'sales_manager'].includes(actor.roleSlug) &&
      member.sponsor_staff_id !== actor.userId
    ) {
      if (actor.roleSlug === 'sales_manager')
        refuse(403, 'Accreditation is outside your authorized team');
      const visited = new Set([actor.userId]),
        queue = [actor.userId];
      let found = false;
      while (queue.length) {
        const head = queue.shift()!;
        for (const edge of await col('referral_relationships')
          .find({ upline_staff_id: head, is_active: true }, { session })
          .toArray()) {
          const id = String(edge.subject_staff_id);
          if (id === member.sponsor_staff_id) found = true;
          if (!visited.has(id)) {
            visited.add(id);
            queue.push(id);
          }
        }
      }
      if (!found) refuse(403, 'Accreditation is outside your authorized team');
    }
  }
  return { required, role, sponsor, scope };
}

/** Registered display projection; callers must enforce permissions and member scope first. */
export async function readMongoOstApplicant(db: Db, member: MongoRow, session: ClientSession) {
    const col = (name: string) => db.collection<MongoRow>(name);
    const { required } = createMongoOstAccess(db);
    const app = await required('ost_applications', String(member.application_id), session),
      staff = await required('staff_users', member._id, session);
    const detail = await col('ost_registration_details').findOne(
      { application_id: app._id },
      { session },
    );
    const fields = (detail?.official_details ?? {}) as Record<string, unknown>;
    const profile = await col('network_member_profiles').findOne(
      { staff_id: member._id },
      { session },
    );
    const customer = await col('customers').findOne({ auth_user_id: member._id }, { session });
    const membership =
      customer &&
      (await col('memberships').findOne(
        {
          customer_id: customer._id,
          status: 'active',
          $or: [{ expires_at: null }, { expires_at: { $gt: new Date().toISOString() } }],
        },
        { session, sort: { activated_at: -1, _id: 1 } },
      ));
    const plan =
      membership &&
      (await col('card_plans').findOne(
        { _id: String(membership.product_id), code: { $in: ['BRONZE', 'SILVER', 'GOLD'] } },
        { session },
      ));
    const tin = nullable(profile?.tin ?? fields.tin);
    const value: Record<string, unknown> = {
      fullName: staff.full_name,
      birthDate: nullable(profile?.date_of_birth ?? app.birth_date),
      email: nullable(staff.email),
      phone: nullable(profile?.mobile_no ?? member.phone),
      sex: nullable(profile?.sex ?? fields.sex)?.toLowerCase() ?? null,
      civilStatus: nullable(profile?.civil_status ?? fields.civilStatus)?.toLowerCase() ?? null,
      address: profile
        ? {
            line1: profile.street_no ?? null,
            city: profile.city_municipality ?? null,
            province: profile.province ?? null,
            postalCode: profile.zip_code ?? null,
            countryCode: 'PH',
          }
        : (app.address ?? null),
      messenger: nullable(profile?.fb_messenger ?? fields.messenger),
      employerName: nullable(profile?.employer_name ?? fields.employerName),
      jobPosition: nullable(profile?.job_position ?? fields.jobPosition),
      tinMasked: tin ? '***' + tin.slice(-4) : null,
      programCategory: !customer ? 'unknown' : plan ? 'vip_holder' : 'non_vip',
      vipCardType: plan?.code ?? null,
    };
    const permitted = new Set([
      'fullName',
      'birthDate',
      'phone',
      'sex',
      'civilStatus',
      'address',
      'messenger',
      'employerName',
      'jobPosition',
    ]);
    for (const change of await col('ost_applicant_changes')
      .find({ ost_id: member._id }, { session })
      .sort({ sequence: 1, created_at: 1, _id: 1 })
      .toArray())
      for (const [key, item] of Object.entries(
        (change.resulting_values ?? {}) as Record<string, unknown>,
      ))
        if (permitted.has(key)) value[key] = item;
    return ostApplicantSnapshotSchema.parse(value);
  }

export function createMongoOstAccreditationHandler(
  db: Db,
  client: MongoClient,
  resolve: typeof resolveAfHomesPrincipal,
  authorize: typeof authorizeAfHomes,
) {
  const col = (name: string) => db.collection<MongoRow>(name);
  const { required, sponsor, scope } = createMongoOstAccess(db);
  const applicant = (member: MongoRow, session: ClientSession) => readMongoOstApplicant(db, member, session);
  async function audit(
    actor: Principal,
    action: string,
    id: string,
    after: Record<string, unknown>,
    session: ClientSession,
    before: Record<string, unknown> | null = null,
  ) {
    await col('audit_events').insertOne(
      {
        _id: randomUUID(),
        actor_id: actor.userId,
        action,
        entity_type: action === 'OST_REFERRER_CHANGED' ? 'ost_member' : 'ost_renewal',
        entity_id: id,
        before_data: before,
        after_data: after,
        created_at: new Date().toISOString(),
      },
      { session },
    );
  }
  async function validate(
    input: Pick<SubmitOstRenewal, 'requestedStart' | 'requestedEnd' | 'proposedNewSponsorStaffId'>,
    member: MongoRow,
    prior: MongoRow,
    session: ClientSession,
  ) {
    if (
      input.requestedEnd !== ostAnnualExpiry(input.requestedStart) ||
      input.requestedStart <= String(prior.expires_on)
    )
      refuse(409, 'Renewal must be one calendar year after the previous term');
    if (input.proposedNewSponsorStaffId) {
      if (input.proposedNewSponsorStaffId === member.sponsor_staff_id)
        refuse(409, 'Choose a different proposed sponsor');
      if (String(prior.expires_on) >= manilaToday())
        refuse(409, 'Accreditation must have expired before changing the referrer');
      await sponsor(input.proposedNewSponsorStaffId, session, true);
    }
  }
  async function records(member: MongoRow, session: ClientSession) {
    const detail = await col('ost_registration_details').findOne(
      { application_id: member.application_id },
      { session },
    );
    let registration: Record<string, unknown> | null = null;
    if (detail) {
      const {
        governmentIdNumber: _id,
        tin: _tin,
        ...official
      } = detail.official_details as Record<string, unknown>;
      registration = {
        ...detail,
        official_details: official,
        endorsed_at: detail.endorsed_at ?? null,
      };
    }
    const terms = await col('ost_accreditation_terms')
      .find({ ost_id: member._id }, { session })
      .sort({ starts_on: 1, _id: 1 })
      .toArray();
    const renewals = await col('ost_accreditation_renewals')
      .find({ ost_id: member._id }, { session })
      .sort({ created_at: -1, _id: 1 })
      .toArray();
    return ostAccreditationRecordsSchema.parse({
      registration,
      currentApplicant: await applicant(member, session),
      terms: terms.map((row) => ({
        ...row,
        id: row._id,
        displayStatus:
          row.status === 'active' && String(row.expires_on) < manilaToday()
            ? 'expired'
            : row.status,
      })),
      renewals: renewals.map((row) => ({
        ...row,
        id: row._id,
        applicant_snapshot: ostApplicantSnapshotSchema.parse(row.applicant_snapshot),
      })),
    });
  }
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    const path = subPath(req),
      verb = method(req),
      match = /^(members|renewals)\/([a-f0-9-]{36})(?:\/(renew|revise|decision|applicant))?$/.exec(path);
    if (!match && !(path === 'sponsors' && verb === 'GET'))
      return fail(
        res,
        'NOT_IMPLEMENTED',
        'This native accreditation workflow is not yet enabled',
        501,
      );
    const principal = await resolve(req);
    if ('error' in principal) return deny(res, principal);
    if (principal.mustChangePassword || principal.mfaRequired)
      return fail(res, 'FORBIDDEN', 'Complete account security setup before continuing', 403);
    if (path === 'sponsors') {
      if (principal.roleSlug === 'ost') {
        if (!(await col('ost_members').findOne({ _id: principal.userId, status: 'active' })))
          return fail(res, 'FORBIDDEN', 'An active OST account is required', 403);
      } else {
        const access = await authorize(req, 'network.ost_registrations');
        if ('error' in access) return deny(res, access);
      }
      const session = client.startSession();
      try {
        const data = await session.withTransaction(async () => {
          const result: { id: string; name: string }[] = [];
          for (const staff of await col('staff_users')
            .find({ status: 'active' }, { session, projection: { full_name: 1 } })
            .sort({ full_name: 1, _id: 1 })
            .toArray()) {
            try {
              const candidate = await sponsor(staff._id, session, true);
              if (principal.roleSlug !== 'ost')
                await scope(principal, { _id: staff._id, sponsor_staff_id: staff._id }, session);
              result.push({ id: candidate.staffId, name: candidate.name });
            } catch (error) {
              if (
                !(error instanceof CustomerActivationError) ||
                ![403, 404, 409].includes(error.status)
              )
                throw error;
            }
          }
          return result;
        });
        return res.status(200).json({ data, meta: { total: data.length } });
      } catch {
        return fail(res, 'INTERNAL', 'Sponsor lookup is unavailable', 503);
      } finally {
        await session.endSession();
      }
    }
    const [, kind, id, operation] = match!;
    if (
      principal.roleSlug === 'ost' &&
      !(
        (kind === 'members' && id === principal.userId) ||
        (kind === 'renewals' && operation === 'revise')
      )
    )
      return fail(res, 'FORBIDDEN', 'Only your own accreditation is available', 403);
    const input =
      operation === 'renew' || operation === 'revise'
        ? submitOstRenewalSchema.safeParse(jsonBody(req))
        : operation === 'decision'
          ? ostRenewalDecisionSchema.safeParse(jsonBody(req))
          : null;
    if (input && !input.success)
      return fail(res, 'VALIDATION_ERROR', 'Check renewal details and signatures', 400);
    if (!(verb === 'GET' && kind === 'members' && !operation) && !(verb === 'POST' && operation))
      return fail(res, 'NOT_FOUND', 'Accreditation endpoint not found', 404);
    const action =
      verb === 'GET' ||
      operation === 'renew' ||
      operation === 'revise' ||
      (operation === 'decision' && (jsonBody(req) as { action?: string })?.action === 'endorse')
        ? 'view'
        : 'update';
    const access =
      principal.roleSlug === 'ost'
        ? principal
        : await authorize(req, 'network.ost_registrations', action);
    if ('error' in access) return deny(res, access);
    const correcting = kind === 'members' && operation === 'applicant';
    const correction = correcting ? updateOstApplicantSchema.safeParse(jsonBody(req)) : null;
    if (operation === 'applicant' && !correcting)
      return fail(res, 'NOT_FOUND', 'Accreditation endpoint not found', 404);
    if (correcting) {
      const editor = await authorize(req, 'network.members', 'update');
      if ('error' in editor) return deny(res, editor);
      if (!correction?.success)
        return fail(
          res,
          'VALIDATION_ERROR',
          'Check applicant details and the reason for identity changes',
          400,
        );
      const data = correction.data;
      if (data.address && data.addressHierarchy) {
        const verified = await verifyOstAddressDetails(data.address, data.addressHierarchy);
        if (!verified.ok)
          return fail(
            res,
            verified.status === 503 ? 'INTERNAL' : 'VALIDATION_ERROR',
            verified.status === 503
              ? 'Address verification is unavailable. Please retry.'
              : 'Choose a consistent address and reference postal code',
            verified.status,
          );
        data.address = { ...verified.address, ...data.addressHierarchy };
      }
    }
    const session = client.startSession();
    try {
      const result = await session.withTransaction(async () => {
        if (verb !== 'GET')
          await db
            .collection<{ _id: string; seq: number }>('counters')
            .updateOne(
              { _id: 'organization-write' },
              { $inc: { seq: 1 } },
              { upsert: true, session },
            );
        const fresh =
          principal.roleSlug === 'ost'
            ? await resolve(req)
            : await authorize(req, 'network.ost_registrations', action);
        if ('error' in fresh) refuse(fresh.error.status, 'Accreditation action is not permitted');
        const actor = fresh as Principal;
        if (actor.roleSlug !== principal.roleSlug)
          refuse(403, 'Your role changed. Reload before continuing');
        if (actor.mustChangePassword || actor.mfaRequired)
          refuse(403, 'Complete account security setup');
        const renewal =
          kind === 'renewals' ? await required('ost_accreditation_renewals', id!, session) : null;
        const member = await required(
          'ost_members',
          renewal ? String(renewal.ost_id) : id!,
          session,
        );
        await scope(actor, member, session);
        if (verb === 'GET') return records(member, session);
        const now = new Date().toISOString();
        if (correcting && correction?.success) {
          const editor = await authorize(req, 'network.members', 'update');
          if ('error' in editor)
            refuse(editor.error.status, 'Member information update is not permitted');
          if (!('error' in editor) && editor.userId !== actor.userId)
            refuse(403, 'Your identity changed. Sign in again');
          const { requestId, reason, addressHierarchy: _codes, ...fields } = correction.data;
          const proposed = Object.fromEntries(
            Object.entries(fields)
              .filter(([, value]) => value !== undefined)
              .map(([key, value]) => [key, value === '' ? null : value]),
          );
          const payload = { ...proposed, ostId: member._id, reason: reason || null };
          const mutations = createMongoPurchaseRecords(db);
          if (
            await mutations.replay(
              actor.userId,
              'ost.applicant.update',
              requestId,
              payload,
              session,
            )
          )
            return { id: member._id };
          const current = await applicant(member, session);
          const changed = Object.keys(proposed).filter(
            (key) =>
              purchaseFingerprint(current[key as keyof typeof current] ?? null) !==
              purchaseFingerprint(proposed[key]),
          );
          if (!changed.length) refuse(400, 'No applicant information changed');
          if (
            changed.some((key) => ['fullName', 'birthDate', 'sex', 'civilStatus'].includes(key)) &&
            reason.length < 5
          )
            refuse(400, 'Provide a reason for identity changes');
          const sequence = await db
            .collection<{ _id: string; seq: number }>('counters')
            .findOneAndUpdate(
              { _id: 'ost-applicant-change' },
              { $inc: { seq: 1 } },
              { upsert: true, returnDocument: 'after', session },
            );
          const changeId = randomUUID();
          await col('ost_applicant_changes').insertOne(
            {
              _id: changeId,
              ost_id: member._id,
              sequence: sequence!.seq,
              changed_fields: changed,
              prior_values: Object.fromEntries(
                changed.map((key) => [key, current[key as keyof typeof current] ?? null]),
              ),
              resulting_values: Object.fromEntries(changed.map((key) => [key, proposed[key]])),
              reason: reason || null,
              changed_by: actor.userId,
              created_at: now,
            },
            { session },
          );
          await mutations.audit(
            actor.userId,
            'OST_APPLICANT_UPDATED',
            'ost_member',
            member._id,
            null,
            { changeId, changedFields: changed },
            session,
          );
          await mutations.complete(
            actor.userId,
            'ost.applicant.update',
            requestId,
            payload,
            member._id,
            session,
          );
          return { id: member._id };
        }
        if (operation === 'renew' || operation === 'revise') {
          if (actor.userId !== member._id && actor.userId !== member.sponsor_staff_id) {
            if (!reviewers.includes(actor.roleSlug))
              refuse(403, 'Renewal review permission required');
            const reviewer = await authorize(req, 'network.ost_registrations', 'update');
            if ('error' in reviewer) refuse(403, 'Renewal review permission required');
          }
          const data = submitOstRenewalSchema.parse(jsonBody(req)),
            hash = purchaseFingerprint(data);
          if (operation === 'renew') {
            if (member.status !== 'active') refuse(409, 'Active OST identity required');
            const prior = await col('ost_accreditation_renewals').findOne(
              { request_id: data.requestId },
              { session },
            );
            if (prior) {
              if (
                prior.created_by !== actor.userId ||
                prior.ost_id !== member._id ||
                prior.payload_hash !== hash
              )
                refuse(409, 'Renewal request payload conflict');
              return { id: prior._id };
            }
            const term = await col('ost_accreditation_terms').findOne(
              { ost_id: member._id, status: 'active' },
              { session },
            );
            if (!term) refuse(409, 'Prior accreditation term required');
            await validate(data, member, term!, session);
            if (
              await col('ost_accreditation_renewals').findOne(
                {
                  ost_id: member._id,
                  status: { $in: ['submitted', 'under_review', 'changes_requested', 'endorsed'] },
                },
                { session },
              )
            )
              refuse(409, 'A renewal is already under review');
            const first = await col('ost_accreditation_terms').findOne(
                { ost_id: member._id },
                { session, sort: { starts_on: 1, _id: 1 } },
              ),
              renewalId = randomUUID();
            await col('ost_accreditation_renewals').insertOne(
              {
                _id: renewalId,
                renewal_number: 'REN-' + renewalId.replaceAll('-', '').toUpperCase(),
                request_id: data.requestId,
                payload_hash: hash,
                ost_id: member._id,
                prior_term_id: term!._id,
                date_of_renewal: data.dateOfRenewal,
                requested_start: data.requestedStart,
                requested_end: data.requestedEnd,
                status: 'submitted',
                applicant_snapshot: await applicant(member, session),
                original_accreditation_date: first!.starts_on,
                last_expiry_date: term!.expires_on,
                old_sponsor_staff_id: member.sponsor_staff_id,
                proposed_new_sponsor_staff_id: data.proposedNewSponsorStaffId,
                reason_for_referrer_change: data.reasonForReferrerChange || null,
                referrer_snapshot: await sponsor(String(member.sponsor_staff_id), session),
                applicant_signature_status: data.applicantSignatureStatus,
                referrer_signature_status: data.referrerSignatureStatus,
                endorsed_at: null,
                endorsed_by: null,
                review_notes: null,
                created_by: actor.userId,
                created_at: now,
                updated_at: now,
                submitted_at: now,
              },
              { session },
            );
            await audit(
              actor,
              'OST_RENEWAL_SUBMITTED',
              renewalId,
              { ostId: member._id, status: 'submitted' },
              session,
            );
            return { id: renewalId };
          }
          if (
            !renewal ||
            !['submitted', 'under_review', 'changes_requested'].includes(String(renewal.status))
          )
            refuse(409, 'Renewal is not editable');
          const term = await required(
            'ost_accreditation_terms',
            String(renewal!.prior_term_id),
            session,
          );
          await validate(data, member, term, session);
          if (renewal!.payload_hash === hash && renewal!.status !== 'changes_requested')
            return { id: renewal!._id };
          await col('ost_accreditation_renewals').updateOne(
            { _id: renewal!._id },
            {
              $set: {
                date_of_renewal: data.dateOfRenewal,
                requested_start: data.requestedStart,
                requested_end: data.requestedEnd,
                proposed_new_sponsor_staff_id: data.proposedNewSponsorStaffId,
                reason_for_referrer_change: data.reasonForReferrerChange || null,
                applicant_signature_status: data.applicantSignatureStatus,
                referrer_signature_status: data.referrerSignatureStatus,
                payload_hash: hash,
                status: 'under_review',
                endorsed_at: null,
                endorsed_by: null,
                updated_at: now,
              },
            },
            { session },
          );
          await audit(
            actor,
            'OST_RENEWAL_REVISED',
            renewal!._id,
            { status: 'under_review' },
            session,
          );
          return { id: renewal!._id };
        }
        if (!renewal || operation !== 'decision') refuse(404, 'Renewal not found');
        const decision = ostRenewalDecisionSchema.parse(jsonBody(req));
        if (decision.action === 'endorse') {
          if (actor.userId !== member.sponsor_staff_id)
            refuse(403, 'Only the current sponsor may endorse');
          await sponsor(actor.userId, session);
        } else if (!reviewers.includes(actor.roleSlug))
          refuse(403, 'Renewal review permission required');
        if (decision.action === 'approve' && renewal!.status === 'approved') {
          const term = await col('ost_accreditation_terms').findOne(
            { renewal_id: renewal!._id },
            { session },
          );
          if (!term) refuse(409, 'Approved renewal term is missing');
          return { id: term!._id };
        }
        if (
          (decision.action === 'reject' && renewal!.status === 'rejected') ||
          (decision.action === 'endorse' && renewal!.endorsed_at)
        )
          return { id: renewal!._id };
        if (
          !['submitted', 'under_review', 'changes_requested', 'endorsed'].includes(
            String(renewal!.status),
          )
        )
          refuse(409, 'Invalid renewal transition');
        let resultId = renewal!._id;
        const patch: Record<string, unknown> = { updated_at: now };
        if (decision.action === 'endorse')
          Object.assign(patch, { status: 'endorsed', endorsed_by: actor.userId, endorsed_at: now });
        else if (decision.action === 'request-changes' || decision.action === 'reject') {
          if (decision.notes.length < 5)
            refuse(400, 'Review notes of at least five characters are required');
          Object.assign(patch, {
            status: decision.action === 'reject' ? 'rejected' : 'changes_requested',
            review_notes: decision.notes,
          });
          if (decision.action === 'reject')
            Object.assign(patch, { rejected_by: actor.userId, rejected_at: now });
          else Object.assign(patch, { endorsed_by: null, endorsed_at: null });
        } else {
          if (
            member.status !== 'active' ||
            !renewal!.endorsed_at ||
            renewal!.applicant_signature_status !== 'received' ||
            renewal!.referrer_signature_status !== 'received'
          )
            refuse(409, 'Sponsor endorsement and both signatures are required');
          const term = await required(
            'ost_accreditation_terms',
            String(renewal!.prior_term_id),
            session,
          );
          if (term.status !== 'active' || term.ost_id !== member._id)
            refuse(409, 'Prior accreditation term is no longer current');
          if (member.sponsor_staff_id !== renewal!.old_sponsor_staff_id)
            refuse(409, 'Sponsor has changed');
          const proposed = nullable(renewal!.proposed_new_sponsor_staff_id),
            nextSponsor = proposed ?? String(member.sponsor_staff_id);
          await validate(
            {
              requestedStart: String(renewal!.requested_start),
              requestedEnd: String(renewal!.requested_end),
              proposedNewSponsorStaffId: proposed,
            },
            member,
            term,
            session,
          );
          await sponsor(nextSponsor, session);
          if (proposed) {
            await col('referral_relationships').updateMany(
              { subject_staff_id: member._id, is_active: true },
              { $set: { is_active: false, updated_at: now } },
              { session },
            );
            await col('referral_relationships').insertOne(
              {
                _id: randomUUID(),
                subject_staff_id: member._id,
                upline_staff_id: nextSponsor,
                hierarchy_role: 'ost',
                is_authoritative: true,
                is_active: true,
                assigned_by: actor.userId,
                assigned_at: now,
              },
              { session },
            );
            await col('ost_members').updateOne(
              { _id: member._id },
              { $set: { sponsor_staff_id: nextSponsor } },
              { session },
            );
            await audit(
              actor,
              'OST_REFERRER_CHANGED',
              member._id,
              { sponsorStaffId: nextSponsor, renewalId: renewal!._id },
              session,
              { sponsorStaffId: member.sponsor_staff_id },
            );
          }
          Object.assign(patch, { status: 'approved', approved_by: actor.userId, approved_at: now });
          await col('ost_accreditation_terms').updateOne(
            { _id: term._id },
            { $set: { status: 'superseded' } },
            { session },
          );
          resultId = randomUUID();
          await col('ost_accreditation_terms').insertOne(
            {
              _id: resultId,
              ost_id: member._id,
              renewal_id: renewal!._id,
              starts_on: renewal!.requested_start,
              expires_on: renewal!.requested_end,
              status: 'active',
              approved_by: actor.userId,
              approved_at: now,
            },
            { session },
          );
          const accreditation = await col('sale_team_accreditations').findOne(
            { staff_id: member._id },
            { session },
          );
          if (accreditation)
            await col('sale_team_accreditations').updateOne(
              { _id: accreditation._id, kind: 'OST' },
              {
                $set: {
                  starts_on: renewal!.requested_start,
                  expires_on: renewal!.requested_end,
                  approved_by: actor.userId,
                  approved_at: now,
                  status: 'active',
                },
              },
              { session },
            );
          else if (['admin', 'super_admin'].includes(actor.roleSlug))
            await createMongoSaleTeamRecords(db).manage(
              member._id,
              actor.userId,
              { kind: 'OST', action: 'approve' },
              session,
            );
        }
        await col('ost_accreditation_renewals').updateOne(
          { _id: renewal!._id },
          { $set: patch },
          { session },
        );
        const auditAction = {
          approve: 'OST_RENEWAL_APPROVED',
          endorse: 'OST_RENEWAL_ENDORSED',
          reject: 'OST_RENEWAL_REJECTED',
          'request-changes': 'OST_RENEWAL_CHANGES_REQUESTED',
        }[decision.action];
        await audit(
          actor,
          auditAction,
          renewal!._id,
          { termId: decision.action === 'approve' ? resultId : null },
          session,
        );
        return { id: resultId };
      });
      return res.status(verb === 'POST' && operation === 'renew' ? 201 : 200).json(result);
    } catch (error) {
      if (error instanceof CustomerActivationError)
        return fail(
          res,
          error.status === 403
            ? 'FORBIDDEN'
            : error.status === 404
              ? 'NOT_FOUND'
              : error.status === 400
                ? 'VALIDATION_ERROR'
                : 'CONFLICT',
          error.message,
          error.status,
        );
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000)
        return fail(res, 'CONFLICT', 'A renewal or accreditation term already exists', 409);
      return fail(res, 'INTERNAL', 'Accreditation could not be processed. Please retry.', 503);
    } finally {
      await session.endSession();
    }
  };
}
