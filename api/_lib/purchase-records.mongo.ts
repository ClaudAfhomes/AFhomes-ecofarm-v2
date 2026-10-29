import { purchaseFingerprint } from './purchase-fingerprint.js';
export { purchaseFingerprint } from './purchase-fingerprint.js';
import { randomBytes, randomUUID } from 'node:crypto';
import type { ClientSession, Db } from 'mongodb';
import {
  AF_ID_ALPHABET,
  purchaseDocumentEvidenceSchema,
  type PurchaseDocumentKind,
  type PaymentStatus,
} from '@afhomes/contracts';
import { addMoney } from '@afhomes/shared';
import { summarizePayments } from './commerce.js';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { captureMongoSaleHierarchy } from './sale-hierarchy.mongo.js';
import { mongoImportPurchasePolicy } from './import-purchase-policy.mongo.js';

const refuse = (message: string): never => {
  throw new CustomerActivationError(409, message);
};
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const nullable = (value: unknown) => text(value) || null;
export async function allocatePurchaseId(
  db: Db,
  prefix: string,
  table: string,
  field: string,
  session: ClientSession,
  length = 5,
) {
  for (let attempt = 0; attempt < 64; attempt++) {
    const id = `${prefix}-${Array.from(randomBytes(length), (byte) => AF_ID_ALPHABET[byte & 31]).join('')}`;
    if (!(await db.collection<MongoRow>(table).findOne({ [field]: id }, { session }))) return id;
  }
  throw new Error('Business identifier allocation failed');
}
/** Native purchase records. All mutators require the caller's guarded transaction. */
export function createMongoPurchaseRecords(db: Db) {
  const col = (name: string) => db.collection<MongoRow>(name);
  async function required(table: string, id: string, session?: ClientSession) {
    const row = await col(table).findOne({ _id: id }, { session });
    if (!row) throw new CustomerActivationError(404, 'Purchase record not found');
    return row;
  }
  async function audit(
    actor: string,
    action: string,
    type: string,
    id: string,
    before: unknown,
    after: unknown,
    session: ClientSession,
  ) {
    await col('audit_events').insertOne(
      {
        _id: randomUUID(),
        actor_id: actor,
        action,
        entity_type: type,
        entity_id: id,
        before_data: before,
        after_data: after,
        created_at: new Date().toISOString(),
      },
      { session },
    );
  }
  async function replay(
    actor: string,
    operation: string,
    requestId: string,
    payload: unknown,
    session: ClientSession,
  ) {
    const prior = await col('mutation_requests').findOne(
      { actor_id: actor, operation, request_id: requestId },
      { session },
    );
    if (prior && prior.payload_hash !== purchaseFingerprint(payload))
      refuse('The request ID was already used with different details');
    return prior;
  }
  async function complete(
    actor: string,
    operation: string,
    requestId: string,
    payload: unknown,
    resultId: string,
    session: ClientSession,
  ) {
    await col('mutation_requests').insertOne(
      {
        _id: randomUUID(),
        actor_id: actor,
        operation,
        request_id: requestId,
        payload_hash: purchaseFingerprint(payload),
        result_id: resultId,
        created_at: new Date().toISOString(),
      },
      { session },
    );
  }
  async function finance(id: string, session?: ClientSession) {
    const reservation = await required('reservation_agreements', id, session);
    const payments = await col('payments')
      .find(
        {
          $or: [
            { reservation_id: id },
            ...(reservation.sale_id ? [{ sale_id: reservation.sale_id }] : []),
          ],
        },
        { session },
      )
      .sort({ recorded_at: -1, _id: -1 })
      .toArray();
    const totals = summarizePayments({
      cashPrice: text(reservation.total_price_snapshot),
      minimumDownPayment: text(reservation.minimum_down_payment_snapshot) || '0.00',
      requiredInitial: nullable(reservation.required_initial_snapshot),
      spotCashStartedAt: nullable(reservation.spot_cash_started_at),
      spotCashDeadline: nullable(reservation.spot_cash_deadline),
      payments: payments.map((row) => ({
        amount: text(row.amount),
        status: row.status as PaymentStatus,
      })),
    });
    return {
      reservation,
      payments,
      ...totals,
      recordedPaymentCount: payments.filter((row) => row.status === 'recorded').length,
    };
  }
  async function evidence(
    kind: PurchaseDocumentKind,
    sourceId: string,
    actor: string,
    session: ClientSession,
  ) {
    let payment: MongoRow | undefined, membership: MongoRow | undefined;
    let reservation: MongoRow;
    if (kind === 'reservation')
      reservation = await required('reservation_agreements', sourceId, session);
    else if (kind === 'payment_recorded' || kind === 'payment_verified') {
      payment = await required('payments', sourceId, session);
      reservation = await required('reservation_agreements', text(payment.reservation_id), session);
    } else {
      const saleId =
        kind === 'membership_activated'
          ? text((membership = await required('memberships', sourceId, session)).sale_id)
          : sourceId;
      const found = await col('reservation_agreements').findOne(
        { sale_id: saleId, origin: 'application' },
        { session },
      );
      if (!found) refuse('Application purchase evidence is unavailable');
      reservation = found!;
    }
    // One session executes operations sequentially; the driver does not support parallel transaction work.
    const application = await required(
      'customer_applications',
      text(reservation.customer_application_id),
      session,
    );
    const customer = await required('customers', text(reservation.customer_id), session);
    const seller = await required('staff_users', text(reservation.seller_staff_id), session);
    const actorRow = await required('staff_users', actor, session);
    const terms = await required(
      'customer_application_purchase_terms',
      text(reservation.purchase_terms_id),
      session,
    );
    const holders = await col('reservation_agreement_holders')
      .find({ agreement_id: reservation._id }, { session })
      .toArray();
    const schedule = await col('reservation_agreement_schedule')
      .find({ agreement_id: reservation._id }, { session })
      .sort({ line_number: 1 })
      .toArray();
    const state = await finance(reservation._id, session);
    const sale = reservation.sale_id
      ? await required('card_sales', text(reservation.sale_id), session)
      : null;
    const identity = {
      reservationNumber: nullable(reservation.reservation_number),
      saleNumber: nullable(sale?.sale_number),
      applicationNumber: nullable(application.application_number),
      customerNumber: text(customer.customer_number),
      customerName: [customer.first_name, customer.middle_name, customer.last_name, customer.suffix]
        .filter(Boolean)
        .join(' '),
      sellerName: text(seller.full_name),
      actorName: text(actorRow.full_name),
      totalPrice: text(terms.total_price),
    };
    const commercial = {
      ...identity,
      purchaseTermsId: terms._id,
      termsVersion: Number(terms.version),
      tier: terms.tier,
      paymentScheme: terms.payment_scheme,
      reservationFee: text(terms.reservation_fee),
      requiredInitial: text(terms.required_initial),
      yearlyPoints: Number(terms.yearly_points),
      validityMonths: Number(terms.validity_months),
      commissionRate: text(terms.commission_rate),
      expectedCommission: text(terms.expected_commission),
      minimumDownPayment: text(terms.minimum_down_payment),
      installmentMonths: terms.installment_months ?? null,
      monthlyAmount: terms.monthly_amount ?? null,
      spotCashDays: Number(terms.spot_cash_days),
      discountPercent: Number(terms.discount_percent),
      annualPointsTranches: Number(terms.annual_points_tranches),
      holderLimit: Number(terms.holder_limit),
      inclusions: terms.inclusions,
    };
    let fields: Record<string, unknown>;
    if (kind === 'reservation') {
      const primary = holders.find((row) => row.holder_type === 'PRIMARY'),
        secondary = holders.find((row) => row.holder_type === 'SECONDARY');
      fields = {
        ...commercial,
        status: reservation.status,
        primaryName: text(primary?.name),
        primaryAddress: text(primary?.address),
        secondaryName: nullable(secondary?.name),
        secondaryAddress: nullable(secondary?.address),
        reservationDate: reservation.reservation_date,
        agreementDate: reservation.agreement_date,
        revisionNumber: nullable(reservation.revision_number),
        monthlyAmortizationStart: nullable(reservation.monthly_amortization_start),
        monthlyAmortizationEnd: nullable(reservation.monthly_amortization_end),
        paymentDueDay: reservation.payment_due_day ?? null,
        schedule: schedule.map((row) => ({
          lineNumber: Number(row.line_number),
          particular: text(row.particular),
          amount: text(row.amount_snapshot),
          paymentDate: nullable(row.payment_date),
        })),
        verifiedTotal: state.verifiedTotal,
        balance: state.remainingBalance,
      };
    } else if (payment) {
      const before =
        kind === 'payment_verified' ? text(payment.verified_before_snapshot) : state.verifiedTotal;
      const beforeState = summarizePayments({
        cashPrice: text(terms.total_price),
        minimumDownPayment: '0.00',
        payments: [{ amount: before, status: 'verified' }],
      });
      fields = {
        ...identity,
        paymentNumber: text(payment.payment_number),
        amount: text(payment.amount),
        method: text(payment.method),
        reference: nullable(payment.reference),
        verifiedBefore: before,
        verifiedAfter: state.verifiedTotal,
        balanceBefore: beforeState.remainingBalance,
        balanceAfter: state.remainingBalance,
        status: kind === 'payment_verified' ? 'verified' : 'recorded',
      };
    } else if (kind === 'purchase_finalized')
      fields = {
        ...commercial,
        saleNumber: text(sale?.sale_number),
        status: 'payment_verified',
        paymentNumbers: state.payments
          .filter((row) => row.status === 'verified')
          .map((row) => text(row.payment_number)),
        verifiedTotal: state.verifiedTotal,
        remainingBalance: state.remainingBalance,
        finalizedAt: text(reservation.finalized_at),
      };
    else
      fields = {
        ...identity,
        membershipNumber: text(membership!.membership_number),
        status: 'active',
        yearlyPoints: Number(terms.yearly_points),
        pointsAllocated: Number(membership!.yearly_points_allocated ?? 0),
        validityMonths: Number(terms.validity_months),
        verifiedTotal: state.verifiedTotal,
        expiresAt: text(membership!.expires_at),
      };
    const previous = await col('purchase_document_evidence')
      .find({ kind, source_id: sourceId }, { session })
      .sort({ revision: -1 })
      .limit(1)
      .next();
    const revision = kind === 'reservation' ? Number(previous?.revision ?? 0) + 1 : 1;
    const parsed = purchaseDocumentEvidenceSchema.parse({
      id: randomUUID(),
      kind,
      sourceId,
      revision,
      schemaVersion: 1,
      actorId: actor,
      capturedAt: new Date().toISOString(),
      fields,
    });
    await col('purchase_document_evidence').insertOne(
      {
        _id: parsed.id,
        kind,
        source_id: sourceId,
        reservation_id: reservation._id,
        ...(payment ? { payment_id: sourceId } : {}),
        ...(sale ? { sale_id: sale._id } : {}),
        ...(membership ? { membership_id: membership._id } : {}),
        revision,
        schema_version: 1,
        actor_id: actor,
        captured_at: parsed.capturedAt,
        fields: parsed.fields,
      },
      { session },
    );
    return parsed.id;
  }
  async function reserve(
    applicationId: string,
    termsId: string,
    actor: string,
    input: Record<string, unknown>,
    session: ClientSession,
  ) {
    const app = await required('customer_applications', applicationId, session),
      terms = await required('customer_application_purchase_terms', termsId, session),
      customer = await required('customers', text(app.customer_id), session);
    if (
      app.status !== 'approved' ||
      app.purchase_terms_id !== termsId ||
      terms.application_id !== applicationId ||
      terms.customer_id !== app.customer_id ||
      terms.plan_id !== app.plan_id
    )
      refuse('Approved application and its exact frozen terms are required');
    if (
      customer.status === 'cancelled' ||
      !(await col('staff_users').findOne(
        { _id: text(terms.seller_staff_id), status: 'active' },
        { session },
      ))
    )
      refuse('Active seller and eligible customer are required');
    if (
      await col('reservation_agreements').findOne(
        { customer_application_id: applicationId, status: { $ne: 'cancelled' } },
        { session },
      )
    )
      refuse('Reservation already exists');
    const holders = await col('customer_application_holders')
      .find({ application_id: applicationId }, { session })
      .toArray();
    if (holders.filter((row) => row.holder_type === 'PRIMARY').length !== 1)
      refuse('Primary holder required');
    const id = randomUUID(),
      now = new Date().toISOString(),
      number = await allocatePurchaseId(
        db,
        'AF-RES',
        'reservation_agreements',
        'reservation_number',
        session,
      );
    await col('reservation_agreements').insertOne(
      {
        _id: id,
        reservation_number: number,
        revision_number: input.revisionNumber ?? null,
        reservation_date: input.reservationDate,
        agreement_date: input.agreementDate,
        sale_id: null,
        origin: 'application',
        customer_application_id: applicationId,
        customer_id: app.customer_id,
        seller_staff_id: terms.seller_staff_id,
        purchase_terms_id: termsId,
        plan_id: app.plan_id,
        created_by: actor,
        tier_snapshot: terms.tier,
        inclusions_snapshot: { items: terms.inclusions },
        total_price_snapshot: terms.total_price,
        reservation_fee_snapshot: terms.reservation_fee,
        down_payment_snapshot: terms.required_initial,
        total_payment_received_snapshot: '0.00',
        balance_snapshot: terms.total_price,
        monthly_amortization_snapshot: terms.monthly_amount,
        installment_months_snapshot: terms.installment_months,
        payment_scheme_snapshot: terms.payment_scheme,
        discount_percent_snapshot: terms.discount_percent,
        validity_years_snapshot: Number(terms.validity_months) / 12,
        validity_months_snapshot: terms.validity_months,
        yearly_points_snapshot: terms.yearly_points,
        annual_points_tranches_snapshot: terms.annual_points_tranches,
        holder_limit_snapshot: terms.holder_limit,
        minimum_down_payment_snapshot: terms.minimum_down_payment,
        required_initial_snapshot: terms.required_initial,
        spot_cash_days_snapshot: terms.spot_cash_days,
        commission_rule_id: terms.commission_rule_id,
        commission_rate_snapshot: terms.commission_rate,
        commission_base_snapshot: terms.commission_base,
        expected_commission_snapshot: terms.expected_commission,
        monthly_amortization_start: input.monthlyAmortizationStart ?? null,
        monthly_amortization_end: input.monthlyAmortizationEnd ?? null,
        payment_due_day: input.paymentDueDay ?? null,
        status: 'draft',
        created_at: now,
        updated_at: now,
      },
      { session },
    );
    for (const holder of holders)
      await col('reservation_agreement_holders').insertOne(
        {
          _id: randomUUID(),
          agreement_id: id,
          holder_type: holder.holder_type,
          name: [holder.first_name, holder.middle_name, holder.last_name, holder.suffix]
            .filter(Boolean)
            .join(' '),
          address: [
            holder.permanent_address_line_1,
            holder.permanent_address_line_2,
            holder.city_municipality,
            holder.province,
            holder.postal_code,
          ]
            .filter(Boolean)
            .join(', '),
          contact_number: holder.mobile ?? holder.landline,
          email: holder.email,
          tin_number: holder.tin_number ?? null,
        },
        { session },
      );
    await saveSchedule(id, (input.scheduleNotes as Record<string, unknown>[]) ?? [], session);
    await evidence('reservation', id, actor, session);
    await audit(
      actor,
      'RESERVATION_AGREEMENT_CREATED',
      'reservation_agreement',
      id,
      null,
      { origin: 'application', applicationId, purchaseTermsId: termsId, reservationNumber: number },
      session,
    );
    return id;
  }
  async function saveSchedule(
    id: string,
    lines: Record<string, unknown>[],
    session: ClientSession,
  ) {
    await col('reservation_agreement_schedule').deleteMany({ agreement_id: id }, { session });
    let line = 0;
    for (const item of lines)
      await col('reservation_agreement_schedule').insertOne(
        {
          _id: randomUUID(),
          agreement_id: id,
          line_number: ++line,
          particular: item.particular,
          amount_snapshot: addMoney(text(item.amount), '0.00'),
          payment_date: item.paymentDate ?? null,
        },
        { session },
      );
  }
  async function transition(
    id: string,
    action: string,
    actor: string,
    input: Record<string, unknown>,
    session: ClientSession,
  ) {
    const row = await required('reservation_agreements', id, session);
    if (
      row.origin === 'application' &&
      (await required('customer_applications', text(row.customer_application_id), session))
        .status !== 'approved'
    )
      refuse('Approved application required');
    const now = new Date().toISOString();
    const transitions: Record<string, [string[], string]> = {
      submit: [['draft'], 'submitted'],
      execute: [['submitted'], 'executed'],
      reopen: [['submitted'], 'draft'],
      cancel: [['draft', 'submitted'], 'cancelled'],
      save: [['draft', 'submitted', 'executed'], text(row.status)],
    };
    const rule = transitions[action];
    if (!rule || !rule[0].includes(text(row.status))) refuse('Invalid agreement transition');
    if (
      action === 'submit' &&
      (await col('reservation_agreement_holders').countDocuments(
        { agreement_id: id, holder_type: 'PRIMARY' },
        { session },
      )) !== 1
    )
      refuse('Primary holder required');
    const patch: Record<string, unknown> = { status: rule[1], updated_at: now };
    if (action === 'submit') patch.submitted_at = row.submitted_at ?? now;
    if (action === 'execute') patch.executed_at = now;
    if (action === 'save') {
      for (const [key, field] of [
        ['revisionNumber', 'revision_number'],
        ['monthlyAmortizationStart', 'monthly_amortization_start'],
        ['monthlyAmortizationEnd', 'monthly_amortization_end'],
        ['paymentDueDay', 'payment_due_day'],
      ])
        if (input[key!] !== undefined) patch[field!] = input[key!];
      await saveSchedule(id, (input.scheduleNotes as Record<string, unknown>[]) ?? [], session);
    }
    await col('reservation_agreements').updateOne({ _id: id }, { $set: patch }, { session });
    if (row.origin === 'application') await evidence('reservation', id, actor, session);
    await audit(
      actor,
      (
        {
          save: 'RESERVATION_AGREEMENT_UPDATED',
          submit: 'RESERVATION_AGREEMENT_SUBMITTED',
          execute: 'RESERVATION_AGREEMENT_EXECUTED',
          reopen: 'RESERVATION_AGREEMENT_REOPENED',
          cancel: 'RESERVATION_AGREEMENT_CANCELLED',
        } as Record<string, string>
      )[action]!,
      'reservation_agreement',
      id,
      { status: row.status },
      { status: rule[1] },
      session,
    );
  }
  async function record(
    id: string,
    actor: string,
    requestId: string,
    input: Record<string, unknown>,
    session: ClientSession,
  ) {
    const payload = { reservationId: id, input };
    const prior = await replay(actor, 'reservation.payment.record', requestId, payload, session);
    if (prior) return text(prior.result_id);
    const row = await required('reservation_agreements', id, session),
      app = await required('customer_applications', text(row.customer_application_id), session);
    if (
      row.origin !== 'application' ||
      row.status !== 'executed' ||
      row.sale_id ||
      app.status !== 'approved'
    )
      refuse('Reservation is not accepting payments');
    const paymentId = randomUUID(),
      now = new Date().toISOString();
    await col('payments').insertOne(
      {
        _id: paymentId,
        origin: 'reservation',
        reservation_id: id,
        sale_id: null,
        customer_id: row.customer_id,
        payment_number: await allocatePurchaseId(
          db,
          'AF-PAY',
          'payments',
          'payment_number',
          session,
        ),
        amount: addMoney(text(input.amount), '0.00'),
        payment_type: input.paymentType,
        method: input.method,
        reference: nullable(input.reference),
        notes: nullable(input.notes),
        receipt_storage_path: nullable(input.receiptStoragePath),
        status: 'recorded',
        recorded_by: actor,
        recorded_at: now,
        verified_by: null,
        verified_at: null,
        rejection_reason: null,
      },
      { session },
    );
    await evidence('payment_recorded', paymentId, actor, session);
    await audit(
      actor,
      'PAYMENT_RECORDED',
      'payment',
      paymentId,
      null,
      { reservationId: id, status: 'recorded', amount: input.amount },
      session,
    );
    await complete(actor, 'reservation.payment.record', requestId, payload, paymentId, session);
    return paymentId;
  }
  async function verify(
    id: string,
    paymentId: string,
    actor: string,
    requestId: string,
    decision: 'verified' | 'rejected',
    reason: string | undefined,
    session: ClientSession,
  ) {
    const payload = { paymentId, decision, reason: reason?.trim() || null };
    if (await replay(actor, 'reservation.payment.verify', requestId, payload, session)) return;
    const payment = await required('payments', paymentId, session);
    if (payment.reservation_id !== id) throw new CustomerActivationError(404, 'Payment not found');
    if (payment.status === decision) {
      await complete(actor, 'reservation.payment.verify', requestId, payload, paymentId, session);
      return;
    }
    if (payment.status !== 'recorded') refuse('Payment is not pending verification');
    const state = await finance(id, session),
      row = state.reservation,
      app = await required('customer_applications', text(row.customer_application_id), session);
    if (
      row.origin !== 'application' ||
      row.status !== 'executed' ||
      app.status !== 'approved' ||
      row.sale_id
    )
      refuse('Reservation is not accepting payment decisions');
    const now = new Date().toISOString();
    await col('payments').updateOne(
      { _id: paymentId, status: 'recorded' },
      {
        $set: {
          status: decision,
          verified_by: actor,
          verified_at: now,
          rejection_reason: decision === 'rejected' ? reason : null,
          verified_before_snapshot: state.verifiedTotal,
        },
      },
      { session },
    );
    if (decision === 'verified' && !row.spot_cash_started_at)
      await col('reservation_agreements').updateOne(
        { _id: id },
        {
          $set: {
            spot_cash_started_at: now,
            spot_cash_deadline: new Date(
              Date.now() + Number(row.spot_cash_days_snapshot) * 86400000,
            ).toISOString(),
            updated_at: now,
          },
        },
        { session },
      );
    if (decision === 'verified') await evidence('payment_verified', paymentId, actor, session);
    const after = await finance(id, session);
    await audit(
      actor,
      decision === 'verified' ? 'PAYMENT_VERIFIED' : 'PAYMENT_REJECTED',
      'payment',
      paymentId,
      { status: payment.status },
      {
        status: decision,
        amount: payment.amount,
        verifiedBefore: state.verifiedTotal,
        verifiedTotal: after.verifiedTotal,
        reason: reason ?? null,
      },
      session,
    );
    await complete(actor, 'reservation.payment.verify', requestId, payload, paymentId, session);
  }
  async function finalize(id: string, actor: string, requestId: string, session: ClientSession) {
    const payload = { reservationId: id };
    const prior = await replay(actor, 'purchase.finalize', requestId, payload, session);
    if (prior) return text(prior.result_id);
    const { reservation: row, payments, fullyPaid, verifiedTotal } = await finance(id, session),
      app = await required('customer_applications', text(row.customer_application_id), session);
    if (row.sale_id) {
      if (!row.finalized_at) refuse('Reservation linkage requires review');
      await complete(actor, 'purchase.finalize', requestId, payload, text(row.sale_id), session);
      return text(row.sale_id);
    }
    if (
      row.origin !== 'application' ||
      row.status !== 'executed' ||
      app.status !== 'approved' ||
      app.sale_id
    )
      refuse('Approved executed purchase required');
    const terms = await required(
      'customer_application_purchase_terms',
      text(row.purchase_terms_id),
      session,
    );
    for (const field of ['customer_id', 'plan_id', 'seller_staff_id'])
      if (terms[field] !== row[field]) refuse('Frozen terms identity mismatch');
    if (terms.application_id !== app._id) refuse('Frozen terms application mismatch');
    for (const [snapshot, field] of [
      ['total_price_snapshot', 'total_price'],
      ['reservation_fee_snapshot', 'reservation_fee'],
      ['required_initial_snapshot', 'required_initial'],
      ['commission_rate_snapshot', 'commission_rate'],
      ['expected_commission_snapshot', 'expected_commission'],
    ])
      if (row[snapshot!] !== terms[field!]) refuse('Frozen reservation economics mismatch');
    if (
      !(await col('staff_users').findOne(
        { _id: text(terms.seller_staff_id), status: 'active' },
        { session },
      ))
    )
      refuse('Seller inactive');
    if (payments.some((payment) => payment.status === 'recorded'))
      refuse('Undecided payments exist');
    if (!fullyPaid) refuse('Reservation not fully paid');
    const imported = await mongoImportPurchasePolicy(db, app._id, text(row.customer_id), session);
    if (
      await col('card_sales').findOne(
        { customer_id: row.customer_id, status: { $nin: ['cancelled', 'active', 'rejected'] } },
        { session },
      )
    )
      refuse('Customer already has an open sale');
    const saleId = randomUUID(),
      now = new Date().toISOString(),
      saleNumber = await allocatePurchaseId(db, 'AF-CSALE', 'card_sales', 'sale_number', session);
    const schedule = await col('reservation_agreement_schedule')
      .find({ agreement_id: id, payment_date: { $type: 'string' } }, { session })
      .sort({ payment_date: -1 })
      .limit(1)
      .next();
    const due = new Date(
        text(row.spot_cash_deadline) ||
          text(schedule?.payment_date) ||
          text(row.spot_cash_started_at) ||
          now,
      ),
      day = due.getUTCDate();
    due.setUTCDate(1);
    due.setUTCMonth(due.getUTCMonth() + Number(terms.installment_months ?? 12));
    due.setUTCDate(
      Math.min(
        day,
        new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() + 1, 0)).getUTCDate(),
      ),
    );
    const relationship = await col('referral_relationships').findOne(
      { subject_staff_id: row.seller_staff_id, is_active: true },
      { session, sort: { is_authoritative: -1, _id: 1 } },
    );
    await col('card_sales').insertOne(
      {
        _id: saleId,
        sale_number: saleNumber,
        customer_id: row.customer_id,
        plan_id: row.plan_id,
        seller_type: 'staff',
        seller_staff_id: row.seller_staff_id,
        seller_ost_id: null,
        cash_price: terms.total_price,
        cash_price_snapshot: terms.total_price,
        minimum_down_payment_snapshot: terms.minimum_down_payment,
        yearly_points_snapshot: terms.yearly_points,
        payment_scheme: terms.payment_scheme,
        reservation_fee_snapshot: terms.reservation_fee,
        required_initial_snapshot: terms.required_initial,
        installment_months_snapshot: terms.installment_months,
        monthly_amount_snapshot: terms.monthly_amount,
        validity_months_snapshot: terms.validity_months,
        commission_rate_snapshot: terms.commission_rate,
        commission_rule_id: terms.commission_rule_id ?? null,
        commission_base_snapshot: terms.commission_base,
        expected_commission_snapshot: terms.expected_commission,
        status: 'payment_verified',
        submitted_at: now,
        payment_verified_at: now,
        fully_paid_at: now,
        balance_due_at: due.toISOString(),
        spot_cash_started_at: row.spot_cash_started_at,
        spot_cash_deadline: row.spot_cash_deadline,
        referral_relationship_id: imported ? null : relationship?._id ?? null,
        created_by: actor,
        origin: imported ? 'legacy_import' : 'normal',
        ...(imported ? { import_job_id: imported.importJobId, import_row_id: imported.importRowId } : {}),
        created_at: now,
        updated_at: now,
      },
      { session },
    );
    if (!imported) await captureMongoSaleHierarchy(db, saleId, text(row.seller_staff_id), now, session);
    const commissionId = imported?.settledBeforeSystem ? null : randomUUID();
    if (commissionId) await col('commissions').insertOne(
      {
        _id: commissionId,
        commission_number: await allocatePurchaseId(
          db,
          'AF-COM',
          'commissions',
          'commission_number',
          session,
        ),
        sale_id: saleId,
        ost_id: null,
        beneficiary_type: 'staff',
        beneficiary_staff_id: row.seller_staff_id,
        amount: terms.expected_commission,
        rate_snapshot: terms.commission_rate,
        basis_amount_snapshot: terms.commission_base,
        commission_rule_id: terms.commission_rule_id ?? null,
        status: 'payment_verified',
        created_at: now,
      },
      { session },
    );
    await col('payments').updateMany(
      { reservation_id: id, sale_id: null },
      { $set: { sale_id: saleId } },
      { session },
    );
    await col('reservation_agreements').updateOne(
      { _id: id },
      { $set: { sale_id: saleId, finalized_at: now, finalized_by: actor, updated_at: now } },
      { session },
    );
    await col('customer_applications').updateOne(
      { _id: app._id },
      { $set: { sale_id: saleId, updated_at: now } },
      { session },
    );
    const evidenceId = await evidence('purchase_finalized', saleId, actor, session);
    await audit(
      actor,
      'PURCHASE_FINALIZED',
      'card_sale',
      saleId,
      null,
      {
        reservationId: id,
        saleNumber,
        purchaseTermsId: terms._id,
        verifiedTotal,
        expectedCommission: terms.expected_commission,
        commissionId,
        documentEvidenceId: evidenceId,
      },
      session,
    );
    await complete(actor, 'purchase.finalize', requestId, payload, saleId, session);
    return saleId;
  }
  async function saveSaleAgreement(
    id: string | null,
    actor: string,
    input: Record<string, unknown>,
    session: ClientSession,
  ) {
    const sale = await required('card_sales', text(input.saleId), session),
      plan = await required('card_plans', text(sale.plan_id), session);
    if (input.vipTier && input.vipTier !== text(plan.code).toUpperCase())
      refuse('Imported tier does not match the selected sale');
    if (input.secondary && text(plan.code).toUpperCase() !== 'GOLD')
      refuse('Secondary holder is Gold-only');
    const now = new Date().toISOString(),
      agreementId = id ?? randomUUID();
    if (id) {
      const before = await required('reservation_agreements', id, session);
      if (before.origin !== 'sale' || before.status !== 'draft' || before.sale_id !== sale._id)
        refuse('Only the original draft sale agreement is editable');
    }
    const mutable = {
      revision_number: input.revisionNumber ?? null,
      reservation_date: input.reservationDate,
      agreement_date: input.agreementDate,
      customer_application_id: input.customerApplicationId ?? null,
      monthly_amortization_start: input.monthlyAmortizationStart ?? null,
      monthly_amortization_end: input.monthlyAmortizationEnd ?? null,
      payment_due_day: input.paymentDueDay ?? null,
      updated_at: now,
    };
    if (!id) {
      const payments = await col('payments').find({ sale_id: sale._id }, { session }).toArray();
      const totals = summarizePayments({
        cashPrice: text(sale.cash_price_snapshot ?? sale.cash_price),
        minimumDownPayment: '0.00',
        payments: payments.map((row) => ({
          amount: text(row.amount),
          status: row.status as PaymentStatus,
        })),
      });
      await col('reservation_agreements').insertOne(
        {
          _id: agreementId,
          ...mutable,
          reservation_number: await allocatePurchaseId(
            db,
            'AF-RES',
            'reservation_agreements',
            'reservation_number',
            session,
          ),
          origin: 'sale',
          sale_id: sale._id,
          plan_id: sale.plan_id,
          customer_id: sale.customer_id,
          tier_snapshot: text(plan.code).toUpperCase(),
          inclusions_snapshot: {
            priorityReservation: plan.priority_reservation ?? false,
            noMonthlyAnnualDues: plan.no_monthly_annual_dues ?? false,
            baseValidityYears: plan.base_validity_years ?? null,
            extensionYears: plan.validity_extension_years ?? null,
            totalLoyaltyValue: plan.total_loyalty_value ?? null,
          },
          total_price_snapshot: text(sale.cash_price_snapshot ?? sale.cash_price),
          reservation_fee_snapshot: sale.reservation_fee_snapshot,
          down_payment_snapshot: sale.required_initial_snapshot,
          total_payment_received_snapshot: totals.verifiedTotal,
          balance_snapshot: totals.remainingBalance,
          monthly_amortization_snapshot: sale.monthly_amount_snapshot ?? null,
          installment_months_snapshot: sale.installment_months_snapshot ?? null,
          payment_scheme_snapshot: sale.payment_scheme,
          discount_percent_snapshot: Number(plan.discount_percent ?? 0),
          validity_years_snapshot: Number(plan.validity_years ?? 1),
          yearly_points_snapshot: Number(sale.yearly_points_snapshot ?? 0),
          annual_points_tranches_snapshot: Number(plan.annual_points_tranches ?? 1),
          holder_limit_snapshot: Number(plan.cardholder_limit ?? 1),
          status: 'draft',
          created_by: actor,
          created_at: now,
          submitted_at: null,
          executed_at: null,
        },
        { session },
      );
    } else
      await col('reservation_agreements').updateOne({ _id: id }, { $set: mutable }, { session });
    await col('reservation_agreement_holders').deleteMany(
      { agreement_id: agreementId },
      { session },
    );
    for (const [kind, value] of [
      ['PRIMARY', input.primary],
      ['SECONDARY', input.secondary],
    ])
      if (value) {
        const holder = value as Record<string, unknown>;
        await col('reservation_agreement_holders').insertOne(
          {
            _id: randomUUID(),
            agreement_id: agreementId,
            holder_type: kind,
            name: holder.name,
            address: holder.address,
            contact_number: holder.contactNumber,
            email: holder.email,
            tin_number: holder.tinNumber ?? null,
          },
          { session },
        );
      }
    await saveSchedule(
      agreementId,
      (input.scheduleNotes as Record<string, unknown>[]) ?? [],
      session,
    );
    await audit(
      actor,
      id ? 'RESERVATION_AGREEMENT_UPDATED' : 'RESERVATION_AGREEMENT_CREATED',
      'reservation_agreement',
      agreementId,
      null,
      { status: 'draft', saleId: sale._id },
      session,
    );
    return agreementId;
  }
  return {
    finance,
    evidence,
    reserve,
    transition,
    record,
    verify,
    finalize,
    saveSaleAgreement,
    replay,
    complete,
    required,
    audit,
  };
}
