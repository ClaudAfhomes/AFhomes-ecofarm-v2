import type { ClientSession, Db } from 'mongodb';
import { compareMoney } from '@afhomes/shared';
import { workbookPaymentClaimSchema, type CustomerImportContinuation } from '@afhomes/contracts';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { externalImportSummary } from './external-customer-import.js';
import { importRevision } from './import-claim-records.mongo.js';
import { createMongoPurchaseRecords } from './purchase-records.mongo.js';

/** Source historical-import read model only: certification never authorizes a business write. */
export async function reviewMongoHistoricalImport(
  db: Db,
  row: MongoRow,
  base: CustomerImportContinuation,
  session: ClientSession,
): Promise<CustomerImportContinuation> {
  const normalized = (row.normalized_data ?? {}) as Record<string, unknown>;
  if (normalized.externalVerified !== true) return base;
  const raw = (row.raw_data ?? {}) as Record<string, string>;
  const facts = (normalized.customerFacts ?? {}) as Record<string, unknown>;
  const col = (name: string) => db.collection<MongoRow>(name);
  const reason = String(normalized.externalReason ?? '').trim();
  if (reason.length < 10 || reason.length > 500)
    throw new CustomerActivationError(409, 'Historical certification requires a reviewed reason');
  const claims = workbookPaymentClaimSchema
    .array()
    .safeParse(facts.paymentClaims ?? normalized.paymentClaims ?? []);
  if (!claims.success)
    throw new CustomerActivationError(409, 'Historical payment claims require review');
  let summary: ReturnType<typeof externalImportSummary>;
  try {
    summary = externalImportSummary(raw, claims.data);
  } catch {
    throw new CustomerActivationError(409, 'Historical payment summary requires review');
  }
  if (importRevision(summary) !== importRevision(normalized.externalSummary))
    throw new CustomerActivationError(
      409,
      'Historical payment summary changed; revalidate the workbook',
    );
  const customer = base.customerId
    ? await col('customers').findOne(
        { _id: base.customerId },
        { session, projection: { vip_card_number: 1 } },
      )
    : null;
  const supplied = raw.existing_vip_control_number?.trim() || null;
  const existing = customer?.vip_card_number ? String(customer.vip_card_number) : supplied;
  const result: CustomerImportContinuation = {
    ...base,
    externallyVerified: true,
    externalSummary: summary,
    conflicts: [...base.conflicts],
    missingRequirements: [...base.missingRequirements],
    vipControlNumberPreview: {
      existing,
      generated: null,
      source: existing ? 'provided' : 'generated',
    },
    historicalPointsPreview: {
      eligible: summary.stage === 'active' && summary.existingPoints !== null,
      stayPointsTotal: summary.existingPoints === null ? null : String(summary.existingPoints),
      reason:
        summary.stage === 'active'
          ? 'Confirmed remaining balance; repeat imports do not credit twice.'
          : 'Preserved as source history; this lifecycle receives no spendable points.',
    },
    purchaseReference:
      !base.sourceId && raw.purchase_reference?.startsWith('AUTO-VIP-')
        ? null
        : base.purchaseReference,
  };
  const conflict = (field: string, message: string) => {
    result.stage = 'review';
    result.conflicts.push({ field, message });
  };
  if (
    supplied &&
    (await col('customers').findOne(
      { vip_card_number: supplied, _id: { $ne: base.customerId ?? '' } },
      { session, projection: { _id: 1 } },
    ))
  )
    conflict('purchase_reference', 'This VIP card ID belongs to another customer.');
  if (supplied && customer?.vip_card_number && supplied !== customer.vip_card_number)
    conflict(
      'purchase_reference',
      'The supplied VIP card ID differs from this customer’s existing card ID.',
    );

  if (['active', 'inactive'].includes(summary.stage)) {
    const memberships = base.customerId
      ? await col('memberships')
          .find({ customer_id: base.customerId }, { session, projection: { _id: 1 } })
          .toArray()
      : [];
    // Never pick an arbitrary membership when protected history needs reconciliation.
    if (memberships.length > 1)
      conflict(
        'external_history',
        'Multiple memberships require explicit historical reconciliation.',
      );
    for (const membership of memberships) {
      const baseline = await col('customer_import_points_baselines').findOne(
        { membership_id: membership._id },
        { session },
      );
      if (
        baseline &&
        summary.existingPoints !== null &&
        Number(baseline.confirmed_points) !== summary.existingPoints
      )
        conflict(
          'existing_stay_points_total',
          'A different historical balance is already recorded. Reconcile the ledger instead of importing another opening balance.',
        );
    }
    if (
      !memberships.length &&
      (!raw.existing_card_activation_date || !raw.existing_card_valid_until)
    ) {
      result.stage = 'review';
      result.missingRequirements = [
        'Historical activation and valid-until dates are needed to create this membership; existing memberships keep their actual dates.',
      ];
    }
  }
  const receipt = base.sourceId
    ? await col('customer_external_import_receipts').findOne(
        { source_id: base.sourceId },
        { session },
      )
    : null;
  if (receipt) {
    if (
      (receipt.reservation_id ?? null) !== base.reservationId ||
      (receipt.application_id ?? null) !== base.applicationId
    )
      conflict('external_history', 'The historical receipt does not match this purchase.');
    if (result.stage === 'review') return result;
    if (base.reservationId) {
      const finance = await createMongoPurchaseRecords(db).finance(base.reservationId, session);
      result.externalSummary = {
        ...summary,
        paid: finance.verifiedTotal,
        balance: finance.remainingBalance,
      };
    }
    if (['active', 'inactive'].includes(summary.stage)) result.stage = summary.stage;
    return result;
  }
  if (base.applicationId && !base.reservationId)
    conflict(
      'external_history',
      'Existing application needs explicit reconciliation; import will not replace approved history.',
    );
  if (base.reservationId) {
    const reservation = await col('reservation_agreements').findOne(
      { _id: base.reservationId },
      { session },
    );
    if (
      !reservation ||
      reservation.customer_id !== base.customerId ||
      reservation.customer_application_id !== base.applicationId
    )
      conflict('external_history', 'The existing reservation identity requires review.');
    else {
      const checks: [string, string, boolean][] = [
        [
          'contract_date',
          'Contract date differs from the existing reservation date.',
          reservation.reservation_date !== raw.contract_date,
        ],
        [
          'vip_tier',
          'VIP tier differs from the existing reservation.',
          reservation.tier_snapshot !== raw.vip_tier,
        ],
        [
          'stated_payment_scheme',
          'Payment terms differ from the existing reservation.',
          reservation.payment_scheme_snapshot !== raw.stated_payment_scheme_code,
        ],
        [
          'referrer_staff_id',
          'The registered seller differs from the existing reservation seller.',
          reservation.seller_staff_id !== raw.referrer_staff_id,
        ],
        [
          'stated_status',
          'The workbook status would reverse an executed or finalized reservation.',
          reservation.status === 'cancelled' ||
            (reservation.status === 'executed' && summary.stage === 'reservation') ||
            (Boolean(reservation.sale_id) &&
              !['activation', 'active', 'inactive'].includes(summary.stage)),
        ],
      ];
      for (const [field, stored, message] of [
        [
          'stated_total',
          'total_price_snapshot',
          'Contract total differs from the frozen reservation total.',
        ],
        [
          'stated_rf',
          'reservation_fee_snapshot',
          'Included reservation fee differs from the frozen reservation fee.',
        ],
      ] as const) {
        let mismatch = true;
        try {
          mismatch = compareMoney(String(reservation[stored]), raw[field] ?? '') !== 0;
        } catch {
          /* Invalid history stays review-only. */
        }
        checks.push([field, message, mismatch]);
      }
      for (const [field, message, mismatch] of checks) if (mismatch) conflict(field, message);
    }
  }
  if (result.stage === 'review' || result.conflicts.length) return result;
  const paths = {
    application: '/admin/customers/applications',
    reservation: '/admin/sales/reservations',
    finance: '/admin/finance/payments',
    activation: '/admin/finance/activation',
    active: '/admin/customers',
    inactive: '/admin/customers',
  };
  return {
    ...result,
    stage: summary.stage,
    missingRequirements: [],
    nextAction: {
      label: 'View imported business records',
      path: paths[summary.stage as keyof typeof paths],
    },
  };
}
