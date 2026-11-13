/**
 * Real evidence for the purchase workflow (repair 20261231000001, product-owner
 * rules of 10 Nov 2026), shared by every DB-suite section that drives it:
 *
 *   - approval needs an ACCEPTED signed Customer Application, and RA execution an
 *     ACCEPTED signed RA, each a real object in the private signed-documents
 *     bucket, registered and then reviewed (self-review allowed, 11 Nov 2026);
 *   - Finance records every payment against a real receipt object in the private
 *     payment-receipts bucket (bucket-relative name, no test-mode bypass).
 *
 * Nothing here writes a document row or flips a status directly: every step goes
 * through the same SECURITY DEFINER RPC the API calls. Every storage object
 * created is recorded in `syntheticStorageObjects` so the suite cleanup removes
 * exactly these rows.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Client } from 'pg';

export const SIGNED_DOCUMENT_BUCKET = 'afhomes-signed-documents';
export const PAYMENT_RECEIPT_BUCKET = 'afhomes-payment-receipts';

/** Every synthetic storage object, as [bucket, name], for the suite cleanup. */
export const syntheticStorageObjects: Array<[string, string]> = [];

export async function storageObject(db: Client, bucket: string, name: string): Promise<string> {
  await db.query('insert into storage.objects (bucket_id, name) values ($1, $2)', [bucket, name]);
  syntheticStorageObjects.push([bucket, name]);
  return name;
}

/** A real receipt object; returns the bucket-relative name for `receiptStoragePath`. */
export const paymentReceipt = (db: Client, label = 'receipt'): Promise<string> =>
  storageObject(db, PAYMENT_RECEIPT_BUCKET, `synthetic-receipts/${label}-${randomUUID()}.pdf`);

type SignedKind = 'signed_customer_application' | 'signed_reservation_agreement';

/** Upload (object + register) a signed document; it stays `pending_review`. */
export async function registerSignedDocument(
  db: Client,
  options: { kind: SignedKind; entityId: string; uploader: string },
): Promise<{ id: string; path: string }> {
  const prefix = options.kind === 'signed_customer_application' ? 'applications' : 'reservations';
  const path = await storageObject(
    db,
    SIGNED_DOCUMENT_BUCKET,
    `${prefix}/${options.entityId}/signed-${randomUUID()}.pdf`,
  );
  const { rows } = await db.query<{ id: string }>(
    `select public.register_purchase_signed_document_once($1::uuid,$2::text,$3::uuid,$4::text,
       $5::text,$6::text,$7::bigint,$8::text) as id`,
    [
      options.uploader,
      options.kind,
      options.entityId,
      path,
      `${options.kind}.pdf`,
      'application/pdf',
      2048,
      createHash('sha256').update(path).digest('hex'),
    ],
  );
  return { id: rows[0]!.id, path };
}

/** Upload by `uploader`, then ACCEPT by `reviewer` (self-review is allowed since 11 Nov 2026). */
export async function acceptedSignedDocument(
  db: Client,
  options: { kind: SignedKind; entityId: string; uploader: string; reviewer: string },
): Promise<string> {
  const { id } = await registerSignedDocument(db, options);
  await db.query(
    `select public.review_purchase_signed_document_once($1::uuid,$2::uuid,'accepted',null)`,
    [options.reviewer, id],
  );
  return id;
}
