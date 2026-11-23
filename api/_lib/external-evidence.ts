import { randomUUID } from 'node:crypto';

import {
  externalEvidenceUploadRequestSchema,
  recordExternalEvidenceSchema,
  reviewEvidenceExceptionSchema,
  type AfHomesModuleKey,
  type ExternalPaymentSubject,
} from '@afhomes/contracts';

import { authorizeAfHomes } from './afhomes-access.js';
import {
  UUID_GROUP as ID,
  deny,
  fail,
  isoOrNull,
  jsonBody,
  mapRpcError,
  route,
  strOrNull as str,
  type Db,
} from './handler-kit.js';
import type { VercelRequest, VercelResponse } from './http.js';
import { PAYMENT_RECEIPT_BUCKET } from './payment-receipts.js';
import { createUploadGrant, storageClient } from './storage.js';

/**
 * Verifiable evidence for payments made OUTSIDE AF Homes (owner decision
 * 2026-11-19, migration 20270105000023). Mounted twice:
 *
 *   commissions family:  payouts/:id/evidence[/upload|/exception-review]
 *   payroll (queues):    payroll/disbursements/:id/evidence[/upload]
 *
 *   GET  .../evidence                    list + SUPPORTED / EVIDENCE_EXCEPTION
 *   POST .../evidence/upload             signed upload grant (server-chosen path)
 *   POST .../evidence                    record one piece of evidence (SQL validates)
 *   POST .../evidence/exception-review   commission payouts only; payroll uses the
 *                                        existing disbursement reconciliation review
 *
 * Nothing here verifies a transaction or creates a document. Returns true when handled.
 */
const EXTENSION = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' } as const;

const SUBJECTS: Record<
  ExternalPaymentSubject,
  { prefix: string; module: AfHomesModuleKey; viewAction: 'view' | 'update'; table: string }
> = {
  commission_payout: {
    prefix: 'payouts',
    module: 'finance.commission_payouts',
    // Commission payout reads already need update (commission-ops); keep that.
    viewAction: 'update',
    table: 'commission_payouts',
  },
  payroll_disbursement: {
    prefix: 'payroll/disbursements',
    module: 'finance.payroll',
    viewAction: 'view',
    table: 'payroll_disbursements',
  },
};


/** Folder an upload grant issues for one external payment; SQL enforces the same prefix. */
export function externalEvidencePrefix(subject: ExternalPaymentSubject, id: string): string {
  return `external/${subject}/${id.toLowerCase()}/`;
}

function toEvidence(r: Record<string, unknown>) {
  return {
    id: r.id,
    evidenceType: r.evidence_type,
    source: r.source,
    documentAttached: typeof r.storage_path === 'string' && r.storage_path.length > 0,
    transactionReference: str(r.transaction_reference),
    orNumber: str(r.or_number),
    transferAmount: str(r.transfer_amount),
    description: str(r.description),
    recordedBy: r.recorded_by,
    recordedAt: isoOrNull(r.recorded_at) ?? '',
  };
}

/** Mirrors private.normalize_payment_key: letters and digits only, upper-cased. */
const refKey = (r: Record<string, unknown>): string | null =>
  (str(r.transaction_reference) ?? str(r.or_number) ?? '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase() || null;

/**
 * How many OTHER payments share each item's reference. Rows sharing a reference
 * always store the same canonical transfer amount (SQL enforces it), so the read is
 * narrowed by that amount.
 */
async function withSharing(db: Db, subjectId: string, rows: Record<string, unknown>[]) {
  const items = rows.map(toEvidence);
  const amounts = [
    ...new Set(rows.map((r) => str(r.transfer_amount)).filter((a): a is string => !!a)),
  ];
  if (!amounts.length) return items;
  const { data, error } = await db
    .from('external_payment_evidence')
    .select('subject_type, subject_id, transaction_reference, or_number, transfer_amount')
    .in('transfer_amount', amounts);
  if (error) throw error;
  const peers = (data ?? []) as Record<string, unknown>[];
  return items.map((item, i) => {
    const key = str(rows[i]!.transfer_amount) ? refKey(rows[i]!) : null;
    if (!key) return item;
    const others = new Set(
      peers
        .filter((p) => p.transfer_amount === rows[i]!.transfer_amount && refKey(p) === key)
        .map((p) => `${String(p.subject_type)}:${String(p.subject_id)}`)
        .filter((k) => !k.endsWith(`:${subjectId}`)),
    );
    return { ...item, sharedWith: others.size };
  });
}

/** Evidence status per subject id, for list mappers. */
export async function evidenceStatusFor(
  db: Db,
  subject: ExternalPaymentSubject,
  ids: string[],
): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data, error } = await db
    .from('external_payment_evidence')
    .select('subject_id')
    .eq('subject_type', subject)
    .in('subject_id', ids);
  if (error) throw error;
  return new Set((data ?? []).map((r: Record<string, unknown>) => String(r.subject_id)));
}

export async function handleExternalEvidence(
  req: VercelRequest,
  res: VercelResponse,
  db: Db,
  subject: ExternalPaymentSubject,
): Promise<boolean> {
  const cfg = SUBJECTS[subject];
  const base = `^${cfg.prefix}/${ID}/evidence`;
  const list = route(req, 'GET', new RegExp(`${base}$`));
  const record = route(req, 'POST', new RegExp(`${base}$`));
  const upload = route(req, 'POST', new RegExp(`${base}/upload$`));
  const review =
    subject === 'commission_payout'
      ? route(req, 'POST', new RegExp(`${base}/exception-review$`))
      : null;
  const match = list ?? record ?? upload ?? review;
  if (!match) return false;
  const id = match[1]!;

  const auth = await authorizeAfHomes(req, cfg.module, list ? cfg.viewAction : 'update');
  if ('error' in auth) return (deny(res, auth), true);
  const invalid = (message: string) => (fail(res, 'VALIDATION_ERROR', message, 400), true);

  if (list) {
    const subjectRow = await db.from(cfg.table).select('id').eq('id', id).maybeSingle();
    if (subjectRow.error) throw subjectRow.error;
    if (!subjectRow.data)
      return (fail(res, 'NOT_FOUND', 'That external payment was not found.', 404), true);
    const reads = await Promise.all([
      db
        .from('external_payment_evidence')
        .select('*')
        .eq('subject_type', subject)
        .eq('subject_id', id)
        .order('recorded_at', { ascending: true }),
      subject === 'commission_payout'
        ? db
            .from('commission_payout_evidence_reviews')
            .select('*')
            .eq('payout_id', id)
            .maybeSingle()
        : db
            .from('payroll_disbursement_reviews')
            .select('*')
            .eq('disbursement_id', id)
            .maybeSingle(),
    ]);
    for (const r of reads) if (r.error) throw r.error;
    const items = await withSharing(db, id, (reads[0].data ?? []) as Record<string, unknown>[]);
    const rev = reads[1].data as Record<string, unknown> | null;
    res.status(200).json({
      subjectType: subject,
      subjectId: id,
      status: items.length ? 'SUPPORTED' : 'EVIDENCE_EXCEPTION',
      exceptionReview: rev
        ? {
            note: String(rev.note),
            reviewedBy: String(rev.reviewed_by),
            reviewedAt: isoOrNull(rev.reviewed_at) ?? '',
          }
        : null,
      items,
    });
    return true;
  }

  if (upload) {
    const parsed = externalEvidenceUploadRequestSchema.safeParse(jsonBody(req));
    if (!parsed.success) return invalid('The document must be a JPEG, PNG or PDF up to 10 MB');
    const subjectRow = await db.from(cfg.table).select('*').eq('id', id).maybeSingle();
    if (subjectRow.error) throw subjectRow.error;
    const row = subjectRow.data as Record<string, unknown> | null;
    // Same eligibility as the SQL record step: no grant for a failed payout.
    if (
      !row ||
      (subject === 'commission_payout' && !['paid', 'reconciled'].includes(String(row.status)))
    )
      return (fail(res, 'NOT_FOUND', 'That external payment was not found.', 404), true);
    const storage = storageClient();
    if (!storage) return (fail(res, 'INTERNAL', 'Evidence storage is not configured', 500), true);
    const path = `${externalEvidencePrefix(subject, id)}${randomUUID()}.${EXTENSION[parsed.data.contentType]}`;
    const grant = await createUploadGrant(storage, PAYMENT_RECEIPT_BUCKET, path, 7200);
    res.status(201).json({ storagePath: path, ...grant });
    return true;
  }

  if (review) {
    const parsed = reviewEvidenceExceptionSchema.safeParse(jsonBody(req));
    if (!parsed.success)
      return invalid('Explain why no evidence exists, in at least 10 characters');
    const result = await db.rpc('review_commission_payout_evidence_exception', {
      p_payout_id: id,
      p_note: parsed.data.note,
      p_actor_id: auth.userId,
    });
    if (result.error) return (mapRpcError(res, result.error), true);
    res.status(200).json({ id: String(result.data) });
    return true;
  }

  const parsed = recordExternalEvidenceSchema.safeParse(jsonBody(req));
  if (!parsed.success)
    return invalid(
      'Give the source and exactly one of: an uploaded document, or a transaction reference / OR number with its transfer amount',
    );
  // The SQL re-checks the prefix and that the object exists; fail fast here.
  if (
    parsed.data.evidenceType === 'uploaded_document' &&
    (!parsed.data.storagePath.startsWith(externalEvidencePrefix(subject, id)) ||
      parsed.data.storagePath.includes('..'))
  )
    return invalid('Upload the document for this payment, then save it');
  const result = await db.rpc('record_external_payment_evidence', {
    p_subject_type: subject,
    p_subject_id: id,
    p_evidence: parsed.data,
    p_actor_id: auth.userId,
  });
  if (result.error) return (mapRpcError(res, result.error), true);
  res.status(201).json({ id: String(result.data) });
  return true;
}
