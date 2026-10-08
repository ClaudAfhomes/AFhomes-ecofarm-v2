/**
 * Task I: historical printable records, rendered from immutable evidence.
 *
 * The renderer is a PURE function of the evidence JSON the database returned. It
 * reads nothing from the current business tables, so a reprint months later
 * cannot substitute today's price, seller, commission, balance or plan benefits
 * for what was true at the time.
 *
 * The field list is an EXPLICIT ALLOWLIST. There is no path by which a
 * government ID, a QR token, a fallback code, a credential hash, an onboarding
 * token or a storage URL reaches a page: those keys are simply never rendered,
 * and `FORBIDDEN_FIELD_PATTERN` fails a test if one ever appears in an evidence
 * payload.
 */
import type { PurchaseDocumentKind } from '@afhomes/contracts';
import { toPdf } from './report-export.js';

export type { PurchaseDocumentKind };

/** The shape `public.purchase_document` answers with. */
export type PurchaseDocumentEvidence = {
  kind: PurchaseDocumentKind;
  sourceId: string;
  evidenceAvailable: boolean;
  revision: number | null;
  schemaVersion?: number;
  actor?: string | null;
  capturedAt?: string | null;
  fields?: Record<string, unknown>;
  unavailableReason?: string;
};

/** Keys that must never appear in a rendered page, in any form. */
export const FORBIDDEN_FIELD_PATTERN =
  /qr_?token|fallback_?code|credential|hash|onboarding|government|secret|password|storage_?path/i;

type Row = [string, string];

const text = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((item) => String((item as Record<string, unknown>)?.particular ?? item)).join('; ');
  if (typeof value === 'object') {
    const items = value as Record<string, unknown>;
    if (Array.isArray(items.items)) return String(items.items.length) + ' item(s)';
    return JSON.stringify(items);
  }
  return String(value);
};

const push = (rows: Row[], label: string, value: unknown) => {
  rows.push([label, text(value)]);
};

const identity = (rows: Row[], fields: Record<string, unknown>) => {
  push(rows, 'Reservation (AF-RES)', fields.reservationNumber);
  push(rows, 'Sale (AF-CSALE)', fields.saleNumber);
  push(rows, 'Application (AF-APP)', fields.applicationNumber);
  push(rows, 'Payment (AF-PAY)', fields.paymentNumber);
  push(rows, 'Customer number', fields.customerNumber);
  push(rows, 'Customer', fields.customerName);
  push(rows, 'Seller', fields.sellerName);
  push(rows, 'Recorded by', fields.actorName);
  push(rows, 'Total price', fields.totalPrice);
};

const economics = (rows: Row[], fields: Record<string, unknown>) => {
  push(rows, 'Tier', fields.tier);
  push(rows, 'Payment scheme', fields.paymentScheme);
  push(rows, 'Reservation amount (included in total)', fields.reservationFee);
  push(rows, 'Required initial', fields.requiredInitial);
  push(rows, 'Installment months', fields.installmentMonths);
  push(rows, 'Monthly amount', fields.monthlyAmount);
  push(rows, 'Validity months', fields.validityMonths);
  push(rows, 'Yearly points', fields.yearlyPoints);
  push(rows, 'Annual points tranches', fields.annualPointsTranches);
  push(rows, 'Holder limit', fields.holderLimit);
  push(rows, 'Benefits captured', fields.inclusions);
};

const money = (rows: Row[], fields: Record<string, unknown>) => {
  push(rows, 'Amount', fields.amount);
  push(rows, 'Method', fields.method);
  push(rows, 'Reference', fields.reference);
  push(rows, 'Verified before', fields.verifiedBefore);
  push(rows, 'Verified after', fields.verifiedAfter);
  push(rows, 'Balance before', fields.balanceBefore);
  push(rows, 'Balance after', fields.balanceAfter);
};

/**
 * The status label that must never be ambiguous.
 *
 * A RECORDED receipt says so in the title, in the summary line and in a field of
 * its own. A recorded payment is not money yet, and a receipt that could be read
 * as a verified one is a business document lying to a customer.
 */
const STATUS_LABEL: Record<PurchaseDocumentKind, string> = {
  reservation: 'DRAFT / EXECUTED AS RECORDED',
  payment_recorded: 'RECORDED - NOT VERIFIED',
  payment_verified: 'VERIFIED',
  purchase_finalized: 'FINAL PURCHASE',
  membership_activated: 'MEMBERSHIP ACTIVATION',
};

const TITLE: Record<PurchaseDocumentKind, string> = {
  reservation: 'Reservation Agreement',
  payment_recorded: 'Payment Receipt (Recorded, Not Verified)',
  payment_verified: 'Payment Verification Record',
  purchase_finalized: 'Final Purchase Record',
  membership_activated: 'Membership Activation Confirmation',
};

export function purchaseDocumentPdf(evidence: PurchaseDocumentEvidence): Uint8Array {
  const rows: Row[] = [];
  const summary: string[] = [];
  summary.push(`STATUS: ${STATUS_LABEL[evidence.kind]}`);
  summary.push(
    `Historical document. Rendered from immutable capture revision ${String(evidence.revision ?? '-')}; no figure on this page is read from current business data.`,
  );

  if (!evidence.evidenceAvailable || !evidence.fields) {
    summary.push(
      'EVIDENCE UNAVAILABLE: this record predates evidence capture. No amount, balance or term is shown, because none was captured at the time.',
    );
    return toPdf({
      title: `AF Homes Ecofarm\n${TITLE[evidence.kind]}`,
      generatedAt: new Date().toISOString(),
      scopeLabel: 'Historical purchase record',
      windowLabel: 'Evidence capture',
      summaryLines: summary,
      headers: ['Field', 'Value'],
      rows: [
        ['Record kind', evidence.kind],
        ['Source id', evidence.sourceId],
        ['Evidence', 'NOT AVAILABLE'],
        ['Reason', evidence.unavailableReason ?? 'LEGACY_RECORD_WITHOUT_CAPTURED_EVIDENCE'],
      ],
    });
  }

  const fields = evidence.fields;
  identity(rows, fields);

  switch (evidence.kind) {
    case 'reservation':
      economics(rows, fields);
      push(rows, 'Agreement state at capture', fields.status);
      push(rows, 'Revision number', fields.revisionNumber);
      push(rows, 'Primary holder', fields.primaryName);
      push(rows, 'Primary address', fields.primaryAddress);
      push(rows, 'Secondary holder', fields.secondaryName);
      push(rows, 'Secondary address', fields.secondaryAddress);
      push(rows, 'Primary signature', fields.primarySignatureStatus);
      push(rows, 'Secondary signature', fields.secondarySignatureStatus);
      push(rows, 'Payment schedule', fields.schedule);
      push(rows, 'Verified total at capture', fields.verifiedTotal);
      push(rows, 'Balance at capture', fields.balance);
      break;
    case 'payment_recorded':
      money(rows, fields);
      push(rows, 'Status of this payment', fields.status);
      push(rows, 'Verified total at recording', fields.verifiedAfter);
      push(rows, 'Balance at recording', fields.balanceAfter);
      summary.push(
        'This payment was RECORDED and has NOT been verified. It is not money until a Finance verifier confirms it.',
      );
      break;
    case 'payment_verified':
      money(rows, fields);
      push(rows, 'Status of this payment', fields.status);
      push(rows, 'Verified total after', fields.verifiedAfter);
      push(rows, 'Balance after', fields.balanceAfter);
      push(rows, 'Frozen purchase total', fields.totalPrice);
      break;
    case 'purchase_finalized':
      economics(rows, fields);
      push(rows, 'Purchase terms id', fields.purchaseTermsId);
      push(rows, 'Purchase terms version', fields.termsVersion);
      push(rows, 'Commission rate captured', fields.commissionRate);
      push(rows, 'Expected commission captured', fields.expectedCommission);
      push(rows, 'Payment numbers', fields.paymentNumbers);
      push(rows, 'Verified total', fields.verifiedTotal);
      push(rows, 'Remaining balance', fields.remainingBalance);
      push(rows, 'Finalized at', fields.finalizedAt);
      break;
    case 'membership_activated':
      push(rows, 'Membership', fields.membershipNumber);
      push(rows, 'Tier', fields.tier);
      push(rows, 'Points allocated', fields.yearlyPoints);
      push(rows, 'Term months', fields.validityMonths);
      push(rows, 'Frozen purchase total', fields.totalPrice);
      push(rows, 'Verified total at activation', fields.verifiedTotal);
      push(rows, 'Activated at', fields.activatedAt);
      push(rows, 'Expires at', fields.expiresAt);
      summary.push(
        'Card credentials are never printed here. A member collects them once, through the authorized onboarding flow.',
      );
      break;
  }

  rows.push(['Captured at', evidence.capturedAt ?? '']);
  rows.push(['Captured by (staff id)', evidence.actor ?? '']);

  return toPdf({
    title: `AF Homes Ecofarm\n${TITLE[evidence.kind]}`,
    generatedAt: new Date().toISOString(),
    scopeLabel: 'Historical purchase record',
    windowLabel: `Evidence capture revision ${String(evidence.revision ?? '-')}`,
    summaryLines: summary,
    headers: ['Field', 'Value'],
    rows,
  });
}

/** Filename stem for the download, derived only from the record kind. */
export function purchaseDocumentFilename(kind: PurchaseDocumentKind): string {
  return `AF-Homes-${kind.replace(/_/g, '-')}.pdf`;
}