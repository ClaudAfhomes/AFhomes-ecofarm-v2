import { describe, expect, it } from 'vitest';
import {
  purchaseReservationCreateSchema,
  purchaseReservationUpdateSchema,
  purchasePaymentSchema,
  purchaseTermsSchema,
  reviewPurchaseTermsSchema,
  recordPurchasePaymentSchema,
  verifyPurchasePaymentSchema,
  financeCollectionQueueItemSchema,
  purchaseDocumentEvidenceSchema,
  reservationAcceptsCollection,
} from './purchase-flow.js';
import { financeQueueItemSchema } from './finance.js';

const app = '11111111-1111-4111-8111-111111111111';
const termsId = '22222222-2222-4222-8222-222222222222';
const actor = '33333333-3333-4333-8333-333333333333';
const requestId = '44444444-4444-4444-8444-444444444444';
const create = {
  origin: 'application',
  requestId,
  customerApplicationId: app,
  purchaseTermsId: termsId,
  reservationDate: '2026-10-07',
  agreementDate: '2026-10-07',
  primarySignatureStatus: 'pending',
  scheduleNotes: [],
};
const terms = {
  id: termsId,
  applicationId: app,
  customerId: app,
  planId: app,
  sellerStaffId: actor,
  version: 1,
  captureKind: 'submission',
  reason: null,
  capturedBy: actor,
  capturedAt: '2026-10-07T00:00:00Z',
  tier: 'BRONZE',
  paymentScheme: 'spot_cash',
  totalPrice: '54000.00',
  reservationFee: '10000.00',
  minimumDownPayment: '10000.00',
  requiredInitial: '10000.00',
  installmentMonths: null,
  monthlyAmount: null,
  spotCashDays: 7,
  validityMonths: 84,
  discountPercent: 5,
  yearlyPoints: 60000,
  annualPointsTranches: 7,
  holderLimit: 1,
  inclusions: ['VIP BENEFITS'],
  commissionRuleId: null,
  commissionRate: '0',
  commissionBase: '54000.00',
  expectedCommission: '0.00',
};
const payment = {
  id: app,
  origin: 'reservation',
  reservationId: termsId,
  saleId: null,
  paymentNumber: 'AF-PAY-ABCDE',
  customerId: app,
  amount: '10000.00',
  paymentType: 'down_payment',
  method: 'cash',
  reference: null,
  notes: null,
  status: 'recorded',
  rejectionReason: null,
  recordedBy: actor,
  verifiedBy: null,
  recordedAt: '2026-10-07T00:00:00Z',
  verifiedAt: null,
};

describe('application-first purchase contracts', () => {
  it('creates from an application without a sale or browser holders', () => {
    expect(purchaseReservationCreateSchema.parse(create).origin).toBe('application');
  });
  it.each(['saleId', 'sellerStaffId', 'totalPrice', 'actorId', 'status', 'primary'])(
    'rejects authoritative application-create field %s',
    (field) => {
      expect(purchaseReservationCreateSchema.safeParse({ ...create, [field]: app }).success).toBe(
        false,
      );
    },
  );
  it('requires the exact terms ID and request identity', () => {
    expect(
      purchaseReservationCreateSchema.safeParse({ ...create, purchaseTermsId: undefined }).success,
    ).toBe(false);
    expect(
      purchaseReservationCreateSchema.safeParse({ ...create, requestId: undefined }).success,
    ).toBe(false);
  });
  it('rejects unknown nested schedule fields', () => {
    expect(
      purchaseReservationCreateSchema.safeParse({
        ...create,
        scheduleNotes: [{ particular: 'NOTE', amount: '10000.00', status: 'verified' }],
      }).success,
    ).toBe(false);
  });
  it('updates agreement fields without accepting source or immutable date changes', () => {
    expect(
      purchaseReservationUpdateSchema.safeParse({ requestId, primarySignatureStatus: 'received' })
        .success,
    ).toBe(true);
    expect(
      purchaseReservationUpdateSchema.safeParse({ requestId, purchaseTermsId: app }).success,
    ).toBe(false);
    expect(
      purchaseReservationUpdateSchema.safeParse({ requestId, reservationDate: '2026-10-08' })
        .success,
    ).toBe(false);
  });
  it('accepts canonical terms with included fee and zero commission', () => {
    expect(purchaseTermsSchema.parse(terms).totalPrice).toBe('54000.00');
  });
  it.each([
    { reservationFee: '20000.00' },
    { expectedCommission: '1.00' },
    { validityMonths: 85 },
    { paymentScheme: 'move_a', installmentMonths: 3, monthlyAmount: '14666.67' },
    { totalPrice: '9999.00' },
    { commissionRate: '1.0001' },
    { monthlyAmount: '1.00' },
    { installmentMonths: 4 },
    { version: 0 },
    { captureKind: 'review', reason: null },
    { requiredInitial: '9999.00' },
  ])('rejects contradictory or incomplete terms %j', (patch) => {
    expect(purchaseTermsSchema.safeParse({ ...terms, ...patch }).success).toBe(false);
  });
  it('rejects overriding prices and sellers in a review request', () => {
    const input = { requestId, expectedProposalHash: 'a'.repeat(64), reason: 'CONFIRM NEW OFFER' };
    expect(reviewPurchaseTermsSchema.safeParse(input).success).toBe(true);
    expect(reviewPurchaseTermsSchema.safeParse({ ...input, totalPrice: '1.00' }).success).toBe(
      false,
    );
    expect(reviewPurchaseTermsSchema.safeParse({ ...input, sellerStaffId: actor }).success).toBe(
      false,
    );
  });
  it('permits reservation payments before and after sale linking', () => {
    expect(purchasePaymentSchema.safeParse(payment).success).toBe(true);
    expect(purchasePaymentSchema.safeParse({ ...payment, saleId: app }).success).toBe(true);
  });
  it('rejects neither source and contradictory legacy sources', () => {
    expect(purchasePaymentSchema.safeParse({ ...payment, reservationId: null }).success).toBe(
      false,
    );
    expect(
      purchasePaymentSchema.safeParse({ ...payment, origin: 'sale', saleId: app }).success,
    ).toBe(false);
    expect(
      purchasePaymentSchema.safeParse({
        ...payment,
        origin: 'sale',
        saleId: app,
        reservationId: null,
      }).success,
    ).toBe(true);
  });
  it('requires reservation payment request identity and rejects totals', () => {
    const input = { requestId, amount: '10000.00', paymentType: 'down_payment', method: 'cash' };
    expect(recordPurchasePaymentSchema.safeParse(input).success).toBe(true);
    expect(recordPurchasePaymentSchema.safeParse({ ...input, requestId: undefined }).success).toBe(
      false,
    );
    expect(recordPurchasePaymentSchema.safeParse({ ...input, balance: '44000.00' }).success).toBe(
      false,
    );
    expect(recordPurchasePaymentSchema.safeParse({ ...input, amount: '0.00' }).success).toBe(false);
  });
  it('requires rejection reason and rejects an actor assertion', () => {
    expect(verifyPurchasePaymentSchema.safeParse({ requestId, decision: 'rejected' }).success).toBe(
      false,
    );
    expect(
      verifyPurchasePaymentSchema.safeParse({ requestId, decision: 'verified', actorId: actor })
        .success,
    ).toBe(false);
  });
  it('collects only executed, unfinalized reservations from approved applications', () => {
    expect(reservationAcceptsCollection('executed', 'approved', null)).toBe(true);
    for (const status of ['draft', 'submitted', 'cancelled'] as const)
      expect(reservationAcceptsCollection(status, 'approved', null)).toBe(false);
    expect(reservationAcceptsCollection('executed', 'cancelled', null)).toBe(false);
    expect(reservationAcceptsCollection('executed', 'approved', app)).toBe(false);
  });
  it('keeps the activation queue sale-only and rejects an incomplete source queue item', () => {
    expect(financeQueueItemSchema.safeParse({ saleId: null }).success).toBe(false);
    expect(
      financeCollectionQueueItemSchema.safeParse({ origin: 'reservation', saleId: app }).success,
    ).toBe(false);
  });
  it('freezes agreement schedules without accepting nested private fields', () => {
    const fields = {
      reservationNumber: 'AF-RES-ABCDE',
      saleNumber: null,
      applicationNumber: 'AF-APP-ABCDE',
      customerNumber: 'AF-CUS-ABCDE',
      customerName: 'TEST CUSTOMER',
      sellerName: 'TEST SELLER',
      actorName: 'TEST ACTOR',
      totalPrice: '54000.00',
      purchaseTermsId: termsId,
      termsVersion: 1,
      tier: 'BRONZE',
      paymentScheme: 'spot_cash',
      reservationFee: '10000.00',
      requiredInitial: '10000.00',
      minimumDownPayment: '10000.00',
      installmentMonths: null,
      monthlyAmount: null,
      spotCashDays: 7,
      discountPercent: 5,
      yearlyPoints: 60000,
      validityMonths: 84,
      annualPointsTranches: 7,
      holderLimit: 1,
      inclusions: ['VIP BENEFITS'],
      commissionRate: '0',
      expectedCommission: '0.00',
      status: 'executed',
      primaryName: 'TEST CUSTOMER',
      primaryAddress: 'TEST ADDRESS',
      secondaryName: null,
      secondaryAddress: null,
      verifiedTotal: '0.00',
      balance: '54000.00',
      reservationDate: '2026-10-07',
      agreementDate: '2026-10-07',
      revisionNumber: null,
      monthlyAmortizationStart: null,
      monthlyAmortizationEnd: null,
      paymentDueDay: null,
      primarySignatureStatus: 'received',
      secondarySignatureStatus: null,
      schedule: [
        {
          lineNumber: 1,
          particular: 'RESERVATION',
          amount: '10000.00',
          paymentDate: null,
          remarks: null,
        },
      ],
    };
    const document = {
      id: app,
      kind: 'reservation',
      sourceId: app,
      revision: 1,
      schemaVersion: 1,
      actorId: actor,
      capturedAt: '2026-10-07T00:00:00Z',
      fields,
    };
    expect(purchaseDocumentEvidenceSchema.safeParse(document).success).toBe(true);
    expect(
      purchaseDocumentEvidenceSchema.safeParse({
        ...document,
        fields: { ...fields, schedule: [{ ...fields.schedule[0], receiptStoragePath: 'PRIVATE' }] },
      }).success,
    ).toBe(false);
  });
  it('allowlists document fields and distinguishes recorded from verified evidence', () => {
    const document = {
      id: app,
      kind: 'payment_recorded',
      sourceId: app,
      revision: 1,
      schemaVersion: 1,
      actorId: actor,
      capturedAt: '2026-10-07T00:00:00Z',
      fields: {
        paymentNumber: 'AF-PAY-ABCDE',
        reservationNumber: 'AF-RES-ABCDE',
        saleNumber: null,
        applicationNumber: 'AF-APP-ABCDE',
        customerNumber: 'AF-CUS-ABCDE',
        customerName: 'TEST CUSTOMER',
        sellerName: 'TEST SELLER',
        actorName: 'TEST ACTOR',
        totalPrice: '54000.00',
        amount: '10000.00',
        method: 'cash',
        reference: null,
        verifiedBefore: '0.00',
        verifiedAfter: '0.00',
        balanceBefore: '54000.00',
        balanceAfter: '54000.00',
        status: 'recorded',
      },
    };
    expect(purchaseDocumentEvidenceSchema.safeParse(document).success).toBe(true);
    expect(
      purchaseDocumentEvidenceSchema.safeParse({ ...document, kind: 'payment_verified' }).success,
    ).toBe(false);
    for (const field of [
      'governmentIdNumber',
      'qrToken',
      'fallbackCode',
      'activationUrl',
      'receiptStoragePath',
    ])
      expect(
        purchaseDocumentEvidenceSchema.safeParse({
          ...document,
          fields: { ...document.fields, [field]: 'SECRET' },
        }).success,
      ).toBe(false);
  });
});
