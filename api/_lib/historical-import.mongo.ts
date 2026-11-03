import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ClientSession, Db } from 'mongodb';
import { paymentSchemeSchema, vipTierSchema } from '@afhomes/contracts';
import {
  addMoney,
  compareMoney,
  multiplyMoney,
  subtractMoney,
  divideMoneyExact,
} from '@afhomes/shared';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { insertMongoApplication } from './application-records.mongo.js';
import { purchaseSellerFor, purchaseTermsForApplication } from './purchase-terms.mongo.js';
import { createMongoPurchaseRecords, purchaseFingerprint } from './purchase-records.mongo.js';
import { createMongoImportClaimRecords } from './import-claim-records.mongo.js';
import { workbookApplicationPrefill } from './customer-workbook.js';
import { manilaToday } from './sale-team.mongo.js';
import { restoreMongoHistoricalMembership } from './historical-membership.mongo.js';

const refuse = (message: string): never => {
  throw new CustomerActivationError(409, message);
};
const rec = (value: unknown) => (value ?? {}) as Record<string, unknown>;
export const HISTORICAL_IMPORT_INDEXES = [
  { table: 'customer_external_import_receipts', key: { source_id: 1 }, partial: null },
  { table: 'customer_external_import_receipts', key: { application_id: 1 }, partial: null },
  {
    table: 'customer_external_import_receipts',
    key: { reservation_id: 1 },
    partial: { reservation_id: { $type: 'string' } },
  },
  {
    table: 'customer_external_import_receipts',
    key: { sale_id: 1 },
    partial: { sale_id: { $type: 'string' } },
  },
  { table: 'customer_import_commission_policies', key: { source_id: 1 }, partial: null },
  { table: 'customer_import_points_baselines', key: { membership_id: 1 }, partial: null },
] as const;
export async function setupMongoHistoricalImports(db: Db) {
  for (const index of HISTORICAL_IMPORT_INDEXES)
    await db
      .collection(index.table)
      .createIndex(index.key, {
        unique: true,
        ...(index.partial ? { partialFilterExpression: index.partial } : {}),
      });
}

export async function requireMongoHistoricalImportSetup(db: Db) {
  for (const expected of HISTORICAL_IMPORT_INDEXES) {
    const indexes = await db
      .collection(expected.table)
      .listIndexes()
      .toArray()
      .catch(() => []);
    if (
      !indexes.some(
        (index) =>
          index.unique === true &&
          index.sparse !== true &&
          purchaseFingerprint(index.key) === purchaseFingerprint(expected.key) &&
          purchaseFingerprint(index.partialFilterExpression ?? null) ===
            purchaseFingerprint(expected.partial),
      )
    )
      throw new CustomerActivationError(
        501,
        'Historical import schema requires reviewed operator setup',
      );
  }
}

/** Guarded source transaction only; review is recomputed by the caller before any writes. */
export async function reconcileMongoHistoricalPurchase(
  db: Db,
  row: MongoRow,
  source: MongoRow,
  actor: string,
  sourceHash: string,
  session: ClientSession,
) {
  const col = (name: string) => db.collection<MongoRow>(name),
    purchase = createMongoPurchaseRecords(db),
    imports = createMongoImportClaimRecords(db),
    raw = row.raw_data as Record<string, string>,
    normalized = rec(row.normalized_data),
    summary = rec(normalized.externalSummary),
    reason = String(normalized.externalReason ?? '').trim(),
    stage = String(summary.stage),
    total = addMoney(String(raw.stated_total), '0.00'),
    fee = addMoney(String(raw.stated_rf), '0.00'),
    paid = addMoney(String(summary.paid), '0.00'),
    now = new Date().toISOString();
  if (
    normalized.externalVerified !== true ||
    reason.length < 10 ||
    reason.length > 500 ||
    !z.iso.date().safeParse(raw.contract_date).success ||
    raw.contract_date! > manilaToday() ||
    compareMoney(fee, '10000.00') !== 0 ||
    compareMoney(total, '0.00') <= 0 ||
    source.customer_id !== row.customer_id
  )
    refuse('Certified historical terms require review');
  const receipt = await col('customer_external_import_receipts').findOne(
    { source_id: source._id },
    { session },
  );
  if (receipt) {
    if (['active', 'inactive'].includes(stage))
      await restoreMongoHistoricalMembership(db, row, String(receipt.sale_id), actor, session);
    return { saleId: receipt.sale_id ?? null, stage };
  }
  const claims = await col('customer_import_payment_claims')
    .find({ source_id: source._id }, { session })
    .sort({ payment_date: 1, _id: 1 })
    .toArray();
  if (claims.some((c) => ['held', 'rejected'].includes(String(c.status))))
    refuse('Historical payment claims need reconciliation');
  const certified = summary.settlement === 'certified';
  const claimTotal = claims.reduce((sum, c) => addMoney(sum, String(c.amount)), '0.00');
  if (
    (certified && (claims.length || !['activation', 'active', 'inactive'].includes(stage))) ||
    compareMoney(certified ? total : claimTotal, paid) !== 0 ||
    compareMoney(paid, total) > 0 ||
    compareMoney(subtractMoney(total, paid), String(summary.balance)) !== 0
  )
    refuse('Historical payment totals conflict');
  const plans = await col('card_plans')
    .find({ code: vipTierSchema.parse(raw.vip_tier), is_active: true }, { session })
    .toArray();
  if (plans.length !== 1 || !raw.referrer_staff_id)
    refuse('Historical plan or registered seller requires review');
  const plan = plans[0]!,
    seller = await purchaseSellerFor(db, actor, raw.referrer_staff_id!, session),
    scheme = paymentSchemeSchema.parse(raw.stated_payment_scheme_code);
  let appId = source.application_id ? String(source.application_id) : null;
  let reservation: MongoRow | null = null;
  if (appId) {
    const app = await purchase.required('customer_applications', appId, session);
    reservation = await col('reservation_agreements').findOne(
      { customer_application_id: appId, status: { $ne: 'cancelled' } },
      { session },
    );
    if (
      stage === 'application' ||
      app.status !== 'approved' ||
      !reservation ||
      reservation.customer_id !== source.customer_id ||
      reservation.seller_staff_id !== seller ||
      compareMoney(String(reservation.total_price_snapshot), total) !== 0 ||
      compareMoney(String(reservation.reservation_fee_snapshot), fee) !== 0 ||
      reservation.tier_snapshot !== plan.code ||
      reservation.payment_scheme_snapshot !== scheme ||
      reservation.reservation_date !== raw.contract_date ||
      (reservation.status === 'executed' && stage === 'reservation') ||
      (reservation.sale_id && !['activation', 'active', 'inactive'].includes(stage))
    )
      refuse('Existing historical application requires explicit reconciliation');
  } else {
    const holders = workbookApplicationPrefill(raw);
    const header = {
      customerId: String(source.customer_id),
      planId: plan._id,
      tier: vipTierSchema.parse(raw.vip_tier),
      paymentScheme: scheme,
      consentAcknowledged: false,
      acknowledgedAt: null,
      primarySignatureStatus: 'pending' as const,
      secondarySignatureStatus: holders.secondary ? ('pending' as const) : undefined,
      validIdReceived: false,
      reservationPaymentProofReceived: false,
      acquisitionChannels: [],
      svdStaffId: raw.vd_staff_id || undefined,
      ssmStaffId: raw.ssm_staff_id || undefined,
      smStaffId: raw.sm_staff_id || undefined,
      referrerStaffId: seller,
      vipRecommenderName: raw.recommender_name || undefined,
      recommenderContact: raw.recommender_contact || undefined,
      recommenderEmail: raw.recommender_email || undefined,
    };
    const primary = { ...holders.primary, holderType: 'PRIMARY' },
      secondary = holders.secondary ? { ...holders.secondary, holderType: 'SECONDARY' } : undefined;
    appId = await insertMongoApplication(
      db,
      actor,
      header,
      primary,
      secondary,
      { primary, secondary: secondary ?? null },
      session,
    );
    await col('customer_import_purchase_sources').updateOne(
      { _id: source._id },
      { $set: { application_id: appId } },
      { session },
    );
    source.application_id = appId;
  }
  const settled = ['activation', 'active', 'inactive'].includes(stage),
    existingPolicy = await col('customer_import_commission_policies').findOne(
      { source_id: source._id },
      { session },
    );
  if (
    existingPolicy &&
    (existingPolicy.settled_before_system !== settled ||
      (existingPolicy.original_summary_hash &&
        existingPolicy.original_summary_hash !== purchaseFingerprint(summary)))
  )
    refuse('Historical commission policy cannot change');
  if (!existingPolicy)
    await col('customer_import_commission_policies').insertOne(
      {
        _id: randomUUID(),
        source_id: source._id,
        settled_before_system: settled,
        original_summary_hash: purchaseFingerprint(summary),
        created_by: actor,
        created_at: now,
      },
      { session },
    );
  let saleId: string | null = reservation?.sale_id ? String(reservation.sale_id) : null;
  if (stage !== 'application') {
    if (!reservation) {
      const terms = await purchaseTermsForApplication(db, appId!, seller, 'review', session),
        initial =
          scheme === 'move_b1_40_12'
            ? multiplyMoney(total, '0.4')
            : scheme === 'move_b2_25_12'
              ? multiplyMoney(total, '0.25')
              : fee;
      const termsId = randomUUID();
      let monthly: string | null = null;
      try {
        if (terms.installmentMonths)
          monthly = divideMoneyExact(subtractMoney(total, initial), terms.installmentMonths);
      } catch {
        refuse('Historical installment schedule does not divide into exact cents');
      }
      const frozen: MongoRow = {
        _id: termsId,
        ...Object.fromEntries(
          Object.entries(terms).map(([key, value]) => [
            key.replace(/[A-Z]/g, (letter) => '_' + letter.toLowerCase()),
            value,
          ]),
        ),
        capture_kind: 'review',
        reason,
        captured_by: actor,
        captured_at: now,
        total_price: total,
        reservation_fee: fee,
        minimum_down_payment: initial,
        required_initial: initial,
        monthly_amount: monthly,
        commission_base: total,
        commission_rule_id: settled ? null : terms.commissionRuleId,
        commission_rate: settled ? '0' : terms.commissionRate,
        expected_commission: settled ? '0.00' : multiplyMoney(total, terms.commissionRate),
      };
      await col('customer_application_purchase_terms').insertOne(frozen, { session });
      await col('customer_applications').updateOne(
        { _id: appId! },
        {
          $set: {
            purchase_terms_id: termsId,
            status: 'approved',
            submitted_at: now,
            approved_at: now,
            approved_by: actor,
            vip_amount_snapshot: total,
            updated_at: now,
          },
        },
        { session },
      );
      const reservationId = await purchase.reserve(
        appId!,
        termsId,
        actor,
        {
          reservationDate: raw.contract_date,
          agreementDate: raw.contract_date,
          primarySignatureStatus: 'pending',
          secondarySignatureStatus: rec(normalized.customerFacts).secondary ? 'pending' : null,
          scheduleNotes: [],
        },
        session,
      );
      reservation = await purchase.required('reservation_agreements', reservationId, session);
    }
    if (reservation!.status !== 'executed')
      await col('reservation_agreements').updateOne(
        { _id: reservation!._id },
        {
          $set: {
            status: stage === 'reservation' ? 'submitted' : 'executed',
            submitted_at: reservation!.submitted_at ?? now,
            ...(stage !== 'reservation' ? { executed_at: reservation!.executed_at ?? now } : {}),
            updated_at: now,
          },
        },
        { session },
      );
    for (const claim of claims) {
      const matches = await imports.candidates(claim, source, session);
      if (claim.payment_id && !matches.some((p) => p._id === claim.payment_id)) {
        const linked = await purchase.required('payments', String(claim.payment_id), session);
        matches.push(linked);
      }
      if (matches.length > 1) refuse('Possible duplicate historical payment requires review');
      let payment = matches[0];
      if (payment) {
        const date = new Date(String(payment.recorded_at));
        const day = Number.isFinite(date.valueOf())
          ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(date)
          : '';
        if (
          payment.reservation_id !== reservation!._id ||
          payment.status !== 'verified' ||
          day !== claim.payment_date ||
          payment.customer_id !== source.customer_id ||
          payment.method !== claim.method ||
          compareMoney(String(payment.amount), String(claim.amount)) !== 0
        )
          refuse('Possible duplicate historical payment requires review');
      } else {
        if (saleId) refuse('Existing historical sale payment requires reconciliation');
        payment = {
          _id: randomUUID(),
          reservation_id: reservation!._id,
          origin: 'reservation',
          sale_id: null,
          customer_id: source.customer_id,
          amount: claim.amount,
          payment_type: claim.purpose === 'reservation' ? 'down_payment' : claim.purpose,
          method: claim.method,
          reference: claim.bank_reference || null,
          notes: `Externally verified historical import: ${source.purchase_reference}. ${claim.notes ?? ''}`,
          status: 'verified',
          recorded_by: actor,
          recorded_at: new Date(`${claim.payment_date}T00:00:00+08:00`).toISOString(),
          verified_by: actor,
          verified_at: now,
        };
        await col('payments').insertOne(payment, { session });
      }
      await col('customer_import_payment_claims').updateOne(
        { _id: claim._id },
        {
          $set: {
            payment_id: payment._id,
            status: 'matched',
            reviewed_by: actor,
            review_reason: reason,
            updated_at: now,
          },
        },
        { session },
      );
    }
    if (
      certified &&
      !(await col('payments').findOne({ reservation_id: reservation!._id }, { session }))
    ) {
      if (saleId) refuse('Existing historical settlement requires reconciliation');
      await col('payments').insertOne(
        {
          _id: randomUUID(),
          reservation_id: reservation!._id,
          origin: 'reservation',
          sale_id: null,
          customer_id: source.customer_id,
          amount: total,
          payment_type: 'full',
          method: 'historical_certification',
          reference: source.purchase_reference,
          notes: `Certified historical settlement; individual receipt dates and methods unavailable. ${reason}`,
          status: 'verified',
          recorded_by: actor,
          recorded_at: now,
          verified_by: actor,
          verified_at: now,
        },
        { session },
      );
    }
    const finance = await purchase.finance(reservation!._id, session);
    if (finance.recordedPaymentCount || compareMoney(finance.verifiedTotal, paid) !== 0)
      refuse('Historical payment totals conflict');
    if (!saleId)
      await col('reservation_agreements').updateOne(
        { _id: reservation!._id },
        {
          $set: {
            total_payment_received_snapshot: paid,
            balance_snapshot: subtractMoney(total, paid),
          },
        },
        { session },
      );
    if (['activation', 'active', 'inactive'].includes(stage))
      saleId = await purchase.finalize(reservation!._id, actor, randomUUID(), session);
  }
  if (['active', 'inactive'].includes(stage)) {
    if (!saleId) refuse('Historical membership has no settled purchase');
    const membershipId = await restoreMongoHistoricalMembership(db, row, saleId!, actor, session);
    await col('customer_import_rows').updateOne(
      { _id: row._id },
      { $set: { membership_id: membershipId } },
      { session },
    );
    await purchase.evidence('membership_activated', membershipId, actor, session);
  }
  await col('customer_external_import_receipts').insertOne(
    {
      _id: randomUUID(),
      source_id: source._id,
      application_id: appId,
      reservation_id: reservation?._id ?? null,
      sale_id: saleId,
      confirmed_by: actor,
      confirmed_at: now,
      source_hash: sourceHash,
      reason,
      paid_total: paid,
      remaining_balance: subtractMoney(total, paid),
      destination: stage,
    },
    { session },
  );
  await purchase.audit(
    actor,
    'EXTERNAL_CUSTOMER_HISTORY_CONFIRMED',
    'customer_import_source',
    source._id,
    null,
    {
      rowId: row._id,
      applicationId: appId,
      reservationId: reservation?._id ?? null,
      saleId,
      paid,
      balance: subtractMoney(total, paid),
      stage,
    },
    session,
  );
  return { saleId, stage };
}
