import type { ClientSession, Db } from 'mongodb';
import { compareMoney } from '@afhomes/shared';
import { importPaymentClaimSchema } from '@afhomes/contracts';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { purchaseFingerprint } from './purchase-records.mongo.js';

export const importNormalKey = (value: unknown) =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
// BSON dates must participate in review revisions as values, not empty objects.
export const importRevision = (value: unknown) =>
  purchaseFingerprint(JSON.parse(JSON.stringify(value)));
/** Explicit operator/fixture setup only; never called by a request or localhost startup. */
export async function setupMongoImportClaims(db: Db) {
  await db
    .collection('customer_import_purchase_sources')
    .createIndex({ issuer_scope: 1, normalized_reference: 1 }, { unique: true });
  await db
    .collection('customer_import_purchase_sources')
    .createIndex(
      { application_id: 1 },
      { unique: true, partialFilterExpression: { application_id: { $type: 'string' } } },
    );
  await db.collection('customer_import_source_rows').createIndex({ row_id: 1 }, { unique: true });
  await db
    .collection('customer_import_payment_claims')
    .createIndex({ source_id: 1, normalized_reference: 1 }, { unique: true });
  await db.collection('customer_import_payment_claims').createIndex({ fingerprint: 1 });
  for (const key of ['proof_id', 'proof_path'])
    await db
      .collection('customer_import_payment_claims')
      .createIndex(
        { [key]: 1 },
        { unique: true, partialFilterExpression: { [key]: { $type: 'string' } } },
      );
}
export function createMongoImportClaimRecords(db: Db) {
  const col = (table: string) => db.collection<MongoRow>(table);
  const refuse = (message: string): never => {
    throw new CustomerActivationError(409, message);
  };
  async function required(table: string, id: string, session?: ClientSession) {
    const value = await col(table).findOne({ _id: id }, { session });
    if (!value) refuse('Import claim provenance requires review');
    return value!;
  }
  async function teamFor(raw: Record<string, unknown>, session?: ClientSession) {
    return matchStaff(
      ['vd_name', 'ssm_name', 'sm_name', 'referrer_name', 'recommender_name'].map((k) =>
        String(raw[k] ?? ''),
      ),
      session,
    );
  }
  async function matchStaff(references: string[], session?: ClientSession) {
    const names = new Set(references.map(importNormalKey).filter(Boolean));
    const staff = (
      await col('staff_users').find({ status: 'active' }, { session }).toArray()
    ).filter((s) => names.has(importNormalKey(s.full_name)));
    const team: Record<string, unknown>[] = [];
    for (const person of staff) {
      for (const assignment of await col('staff_role_assignments')
        .find({ staff_id: person._id }, { session })
        .toArray()) {
        const role = await col('roles').findOne(
          { _id: String(assignment.role_id), is_active: true },
          { session },
        );
        if (!role) continue;
        let heads = [person._id];
        const ancestorIds: string[] = [];
        for (let depth = 0; depth < 4 && heads.length; depth++) {
          const edges = await col('referral_relationships')
            .find({ subject_staff_id: { $in: heads }, is_active: true }, { session })
            .sort({ _id: 1 })
            .toArray();
          heads = edges.map((e) => String(e.upline_staff_id));
          ancestorIds.push(...heads);
        }
        team.push({
          staff_id: person._id,
          full_name: person.full_name,
          role_slug: role.slug,
          ancestor_ids: ancestorIds,
        });
      }
    }
    for (const member of team)
      member.match_count = team.filter(
        (s) => importNormalKey(s.full_name) === importNormalKey(member.full_name),
      ).length;
    return team.sort((a, b) =>
      `${a.staff_id}:${a.role_slug}`.localeCompare(`${b.staff_id}:${b.role_slug}`),
    );
  }
  async function customerFor(row: MongoRow, session?: ClientSession) {
    const raw = (row.raw_data ?? {}) as Record<string, unknown>;
    const escapedEmail = String(raw.email ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const emailMatches = await col('customers')
      .find({ email: { $regex: `^${escapedEmail}$`, $options: 'i' } }, { session })
      .limit(2)
      .toArray();
    const reference = String(raw.ra_number ?? '').trim();
    const refs = reference
      ? await col('customers')
          .find({ $or: [{ customer_number: reference }, { ra_number: reference }] }, { session })
          .toArray()
      : [];
    const emailId = emailMatches[0]?._id,
      referenceId = refs[0]?._id;
    if (
      emailMatches.length > 1 ||
      refs.length > 1 ||
      (referenceId &&
        (emailId !== referenceId || (row.customer_id && row.customer_id !== referenceId))) ||
      (row.customer_id && emailId !== row.customer_id) ||
      (reference && !referenceId && emailId && !row.customer_id) ||
      (reference.startsWith('AF-CUS-') && !refs.length && !row.customer_id)
    )
      refuse('Imported customer identity requires review');
    const id = row.customer_id || referenceId || emailId;
    return id ? required('customers', String(id), session) : null;
  }
  async function sourceForRow(row: MongoRow, session?: ClientSession) {
    const link = await col('customer_import_source_rows').findOne({ row_id: row._id }, { session });
    return link
      ? required('customer_import_purchase_sources', String(link.source_id), session)
      : null;
  }
  async function targetForRow(row: MongoRow, source: MongoRow | null, session?: ClientSession) {
    const raw = (row.raw_data ?? {}) as Record<string, unknown>,
      customer = await customerFor(row, session);
    if (!source) {
      const reference = importNormalKey(raw.purchase_reference || `legacy-import-${row._id}`);
      const sources = await col('customer_import_purchase_sources')
        .find({ issuer_scope: 'afhomes' }, { session })
        .toArray();
      const matches = sources.filter(
        (s) =>
          s.normalized_reference === reference ||
          importNormalKey(s.purchase_reference) === reference,
      );
      if (matches.length > 1) refuse('Imported purchase source requires review');
      source = matches[0] ?? null;
    }
    if (source && source.customer_id !== customer?._id)
      refuse('Imported purchase source identity requires review');
    const applications = customer
      ? await col('customer_applications')
          .find({ customer_id: customer._id }, { session })
          .sort({ _id: 1 })
          .toArray()
      : [];
    const memberships = customer
      ? await col('memberships')
          .find({ customer_id: customer._id }, { session })
          .sort({ _id: 1 })
          .toArray()
      : [];
    const state: Record<string, unknown> = { customer, source, applications, memberships };
    for (const table of [
      'customer_application_purchase_terms',
      'reservation_agreements',
      'payments',
    ])
      state[table] = customer
        ? await col(table)
            .find({ customer_id: customer._id }, { session })
            .sort({ _id: 1 })
            .toArray()
        : [];
    state.holders = await col('customer_application_holders')
      .find({ application_id: { $in: applications.map((r) => r._id) } }, { session })
      .sort({ _id: 1 })
      .toArray();
    state.claims = source
      ? await col('customer_import_payment_claims')
          .find({ source_id: source._id }, { session })
          .sort({ _id: 1 })
          .toArray()
      : [];
    state.points = await col('points_accounts')
      .find({ membership_id: { $in: memberships.map((r) => r._id) } }, { session })
      .sort({ _id: 1 })
      .toArray();
    if ((row.normalized_data as Record<string, unknown> | undefined)?.externalVerified === true) {
      state.historicalBaselines = await col('customer_import_points_baselines')
        .find({ membership_id: { $in: memberships.map((r) => r._id) } }, { session })
        .sort({ _id: 1 }).toArray();
      state.historicalReceipts = source ? await col('customer_external_import_receipts')
        .find({ source_id: source._id }, { session }).sort({ _id: 1 }).toArray() : [];
      state.historicalPolicy = source ? await col('customer_import_commission_policies')
        .find({ source_id: source._id }, { session }).sort({ _id: 1 }).toArray() : [];
    }
    state.team = await teamFor(raw, session);
    return importRevision(state);
  }
  async function target(source: MongoRow, session?: ClientSession) {
    return targetForRow(
      await required('customer_import_rows', String(source.original_row_id), session),
      source,
      session,
    );
  }
  async function candidates(claim: MongoRow, source: MongoRow, session?: ClientSession) {
    const payments = await col('payments')
      .find(
        {
          customer_id: source.customer_id,
          status: { $nin: ['voided', 'rejected'] },
          method: claim.method,
        },
        { session },
      )
      .sort({ _id: 1 })
      .toArray();
    const linked = await col('customer_import_payment_claims')
      .find({ fingerprint: claim.fingerprint, payment_id: { $ne: null } }, { session })
      .toArray();
    return payments.filter(
      (p) =>
        compareMoney(String(p.amount), String(claim.amount)) === 0 &&
        ((String(claim.bank_reference ?? '') !== '' &&
          importNormalKey(p.reference) === importNormalKey(claim.bank_reference)) ||
          linked.some((c) => c.payment_id === p._id)),
    );
  }
  async function view(
    claim: MongoRow,
    source: MongoRow,
    targetVersion: string,
    session?: ClientSession,
  ) {
    const payment = claim.payment_id
      ? await col('payments').findOne({ _id: String(claim.payment_id) }, { session })
      : null;
    return importPaymentClaimSchema.parse({
      id: claim._id,
      sourceId: source._id,
      paymentKey: claim.claim_reference,
      purpose: claim.purpose,
      amount: claim.amount,
      date: claim.payment_date,
      method: claim.method,
      reference: claim.bank_reference,
      notes: claim.notes ?? '',
      status: payment?.status === 'verified' ? 'verified' : claim.status,
      paymentId: claim.payment_id ?? null,
      expectedClaimVersion: importRevision(claim),
      expectedTargetVersion: targetVersion,
      duplicateCandidates: (await candidates(claim, source, session)).map((p) => ({
        paymentId: p._id,
        reference: p.reference ?? '',
        amount: p.amount,
      })),
      proofDocumentId: claim.proof_id ?? null,
      proofUploaded: claim.proof_uploaded_at != null,
    });
  }
  return {
    required,
    customerFor,
    sourceForRow,
    teamFor,
    matchStaff,
    targetForRow,
    target,
    candidates,
    view,
  };
}
