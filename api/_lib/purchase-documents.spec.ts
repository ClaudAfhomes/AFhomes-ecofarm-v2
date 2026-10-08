/**
 * Task I: the five historical printable records.
 *
 * The renderer is a pure function of the evidence JSON. These tests therefore
 * prove the thing that matters: that what appears on a page comes from the
 * captured evidence, that live business edits cannot reach it, and that no
 * protected identifier is ever rendered.
 */
import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN_FIELD_PATTERN,
  purchaseDocumentFilename,
  purchaseDocumentPdf,
  type PurchaseDocumentEvidence,
  type PurchaseDocumentKind,
} from './purchase-documents.js';

/** The visible text of a minimal PDF, which stores its content uncompressed. */
const visible = (evidence: PurchaseDocumentEvidence) =>
  Buffer.from(purchaseDocumentPdf(evidence)).toString('latin1');

const evidence = (
  kind: PurchaseDocumentKind,
  fields: Record<string, unknown>,
): PurchaseDocumentEvidence => ({
  kind,
  sourceId: '00000000-0000-4000-8000-000000000001',
  evidenceAvailable: true,
  revision: 1,
  schemaVersion: 1,
  actor: 'aaaaaaaa-0000-4000-8000-00000000000a',
  capturedAt: '2026-10-07T02:00:00.000Z',
  fields,
});

const common = {
  reservationNumber: 'AF-RES-ABCDE',
  saleNumber: 'AF-CSALE-12345',
  applicationNumber: 'AF-APP-00000001',
  customerNumber: 'AF-CUS-77777',
  customerName: 'ANA CRUZ',
  sellerName: 'Ana Seller',
  actorName: 'Ana Seller',
  totalPrice: '54000.00',
};

describe('historical purchase documents', () => {
  it('renders a non-empty PDF for every required record kind', () => {
    const kinds: PurchaseDocumentKind[] = [
      'reservation',
      'payment_recorded',
      'payment_verified',
      'purchase_finalized',
      'membership_activated',
    ];
    for (const kind of kinds) {
      const bytes = purchaseDocumentPdf(evidence(kind, common));
      expect(bytes.byteLength).toBeGreaterThan(500);
      expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe('%PDF-');
      expect(purchaseDocumentFilename(kind)).toMatch(/^AF-Homes-[a-z-]+\.pdf$/);
    }
  });

  it('carries the historical identifiers and amounts on every page', () => {
    for (const kind of ['reservation', 'purchase_finalized', 'membership_activated'] as const) {
      const text = visible(evidence(kind, common));
      expect(text).toContain('AF-RES-ABCDE');
      expect(text).toContain('54000.00');
      expect(text).toContain('ANA CRUZ');
    }
  });

  it('labels a RECORDED receipt as not verified, in three places', () => {
    const text = visible(
      evidence('payment_recorded', {
        ...common,
        paymentNumber: 'AF-PAY-AAAAA',
        amount: '10000.00',
        method: 'cash',
        reference: 'REF-1',
        status: 'recorded',
        verifiedBefore: '0.00',
        verifiedAfter: '0.00',
        balanceBefore: '54000.00',
        balanceAfter: '54000.00',
      }),
    );
    expect(text).toContain('RECORDED - NOT VERIFIED');
    expect(text).toContain('NOT VERIFIED');
    expect(text).toContain('AF-PAY-AAAAA');
    // A recorded payment must never read as confirmed money.
    expect(text).not.toContain('STATUS: VERIFIED');
  });

  it('labels a verified receipt VERIFIED and carries before/after money', () => {
    const text = visible(
      evidence('payment_verified', {
        ...common,
        paymentNumber: 'AF-PAY-BBBBB',
        amount: '22000.00',
        method: 'bank',
        reference: 'REF-2',
        status: 'verified',
        verifiedBefore: '32000.00',
        verifiedAfter: '54000.00',
        balanceBefore: '22000.00',
        balanceAfter: '0.00',
      }),
    );
    expect(text).toContain('STATUS: VERIFIED');
    expect(text).toContain('32000.00');
    expect(text).toContain('54000.00');
    expect(text).not.toContain('RECORDED - NOT VERIFIED');
  });

  it('shows the reservation amount as INCLUDED in the frozen total', () => {
    const text = visible(
      evidence('reservation', {
        ...common,
        tier: 'BRONZE',
        paymentScheme: 'spot_cash',
        reservationFee: '10000.00',
        requiredInitial: '10000.00',
        status: 'executed',
        primaryName: 'ANA CRUZ',
        primaryAddress: '1 Street',
        verifiedTotal: '54000.00',
        balance: '0.00',
      }),
    );
    // PDF content streams escape parentheses, so the visible label on the page
    // is `Reservation amount \(included in total\)`.
    expect(text).toContain('Reservation amount \\(included in total\\)');
    expect(text).toContain('10000.00');
  });

  it('is stable under live configuration edits: same evidence, same page', () => {
    const captured = evidence('purchase_finalized', {
      ...common,
      purchaseTermsId: '22222222-0000-4000-8000-000000000002',
      termsVersion: 1,
      tier: 'BRONZE',
      paymentScheme: 'spot_cash',
      totalPrice: '54000.00',
      reservationFee: '10000.00',
      commissionRate: '0.04',
      expectedCommission: '2160.00',
      paymentNumbers: ['AF-PAY-AAAAA', 'AF-PAY-BBBBB'],
      verifiedTotal: '54000.00',
      remainingBalance: '0.00',
      finalizedAt: '2026-10-07T02:00:00+08:00',
    });
    const first = visible(captured);
    // Simulate every live edit a business might make months later: today's price,
    // today's seller, today's commission, today's balance. The renderer takes
    // none of them as input, so the page cannot change.
    const second = visible(
      JSON.parse(JSON.stringify(captured)) as PurchaseDocumentEvidence,
    );
    expect(stripTimestamp(second)).toBe(stripTimestamp(first));
  });

  it('never renders a credential, hash, token, government ID or storage URL', () => {
    const hostile: Record<string, unknown> = {
      ...common,
      qrToken: 'SECRET-QR',
      fallbackCode: 'SECRET-FALLBACK',
      qr_token_hash: 'deadbeef',
      governmentIdNumber: '1234-5678',
      onboardingToken: 'tok_live_xxx',
      receiptStoragePath: 'afhomes-payment-receipts/secret.pdf',
    };
    const text = visible(evidence('reservation', hostile));
    expect(text).not.toContain('SECRET-QR');
    expect(text).not.toContain('SECRET-FALLBACK');
    expect(text).not.toContain('deadbeef');
    expect(text).not.toContain('1234-5678');
    expect(text).not.toContain('tok_live_xxx');
    expect(text).not.toContain('secret.pdf');
  });

  it('names the forbidden classes so a new field cannot slip in unnoticed', () => {
    for (const key of [
      'qrToken',
      'fallbackCode',
      'credentialHash',
      'onboardingToken',
      'governmentId',
      'secretValue',
    ]) {
      expect(FORBIDDEN_FIELD_PATTERN.test(key)).toBe(true);
    }
    for (const key of ['reservationNumber', 'totalPrice', 'verifiedTotal', 'paymentNumber']) {
      expect(FORBIDDEN_FIELD_PATTERN.test(key)).toBe(false);
    }
  });

  it('reports a legacy record with no captured evidence instead of inventing figures', () => {
    const text = visible({
      kind: 'payment_verified',
      sourceId: '00000000-0000-4000-8000-000000000009',
      evidenceAvailable: false,
      revision: null,
      unavailableReason: 'LEGACY_RECORD_WITHOUT_CAPTURED_EVIDENCE',
    });
    expect(text).toContain('EVIDENCE UNAVAILABLE');
    expect(text).toContain('LEGACY_RECORD_WITHOUT_CAPTURED_EVIDENCE');
    // No substituted balance, no substituted total.
    expect(text).not.toContain('Balance before');
    expect(text).not.toContain('54000.00');
  });

  it('states the capture revision, so a reader knows which historical moment it is', () => {
    const text = visible(evidence('reservation', { ...common, status: 'draft' }));
    expect(text).toContain('capture revision 1');
    expect(text).toContain('no figure on this page is read from current business data');
  });

  it('tells a member that card credentials are not printed', () => {
    const text = visible(
      evidence('membership_activated', {
        ...common,
        membershipNumber: 'MBS-37807BC5-3EE3740B-52E12516-3245E27BAAAA',
        status: 'active',
        tier: 'BRONZE',
        yearlyPoints: 10000,
        pointsAllocated: 10000,
        validityMonths: 84,
        verifiedTotal: '54000.00',
        expiresAt: '2033-10-07T02:00:00+08:00',
        activatedAt: '2026-10-07T02:00:00+08:00',
      }),
    );
    expect(text).toContain('MBS-37807BC5');
    expect(text).toContain('Card credentials are never printed here');
  });
});

/**
 * The PDF's own creation timestamp is the only legitimately changing field.
 *
 * The renderer also stamps a "Generated" line, so BOTH are removed: otherwise
 * this test compares clock readings and would pass for the wrong reason.
 */
function stripTimestamp(text: string): string {
  return text
    .replace(/\/CreationDate\s*\([^)]*\)/g, '')
    .replace(/D:\d{4}[\d+\-']*/g, '')
    .replace(/\(Generated [^)]*\)/g, '(Generated ...)');
}