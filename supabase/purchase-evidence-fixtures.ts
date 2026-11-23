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

/** Explicit historical fixture ancestry; imports never infer it in production. */
export async function historicalSaleSnapshot(db: Client, saleId: string, staffIds: string[]): Promise<void> {
  await db.query(`insert into public.card_sale_hierarchy_snapshots(sale_id,ancestor_staff_id,ancestor_role,depth,captured_at)
    select $1,s.id,private.staff_role_slug(s.id),(chain.ordinality-1)::smallint,now()
    from unnest($2::uuid[]) with ordinality chain(id,ordinality)
    join public.staff_users s on s.id=chain.id`, [saleId, staffIds]);
}

export async function storageObject(db: Client, bucket: string, name: string): Promise<string> {
  await db.query('insert into storage.objects (bucket_id, name) values ($1, $2)', [bucket, name]);
  syntheticStorageObjects.push([bucket, name]);
  return name;
}

/** A real receipt object; returns the bucket-relative name for `receiptStoragePath`. */
export const paymentReceipt = (db: Client, label = 'receipt'): Promise<string> =>
  storageObject(db, PAYMENT_RECEIPT_BUCKET, `synthetic-receipts/${label}-${randomUUID()}.pdf`);

/** Fulfil the reservation prerequisite through the same ledger/RPCs as Finance. */
export async function verifiedReservationFee(db: Client, reservationId: string, finance: string): Promise<string> {
  const terms = (await db.query<{ fee: string; balance: string }>(
    'select reservation_fee_snapshot fee,private.money(total_price_snapshot::numeric-reservation_fee_snapshot::numeric) balance from public.reservation_agreements where id=$1',
    [reservationId])).rows[0]!;
  if (terms.fee !== '0.00') {
    const id = (await db.query<{ id: string }>('select public.record_reservation_payment_once($1,$2,$3,$4) id',
      [randomUUID(), reservationId, { amount: terms.fee, paymentPurpose: 'reservation_fee', method: 'cash',
        receiptStoragePath: await paymentReceipt(db) }, finance])).rows[0]!.id;
    await db.query("select public.verify_purchase_payment_once($1,$2,'verified',null,$3)", [randomUUID(), id, finance]);
  }
  return terms.balance;
}

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
