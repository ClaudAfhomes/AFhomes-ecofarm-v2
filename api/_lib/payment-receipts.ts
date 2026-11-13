import { randomUUID } from 'node:crypto';

import { paymentReceiptUploadRequestSchema } from '@afhomes/contracts';

import { fail } from './handler-kit.js';
import type { VercelResponse } from './http.js';
import { createUploadGrant, storageClient } from './storage.js';

/** Private bucket; SQL `require_payment_receipt_object` checks the object exists here. */
export const PAYMENT_RECEIPT_BUCKET = 'afhomes-payment-receipts';

const EXTENSION = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' } as const;

/**
 * Issue a signed upload grant for one payment receipt. The caller has already
 * authorized Finance and confirmed the sale/reservation exists. The object path
 * is server-generated (bucket-relative, as the SQL check expects), so a client
 * can never choose or overwrite another object.
 */
export async function issuePaymentReceiptUploadGrant(
  res: VercelResponse,
  scope: 'sale' | 'reservation',
  ownerId: string,
  body: unknown,
): Promise<void> {
  const parsed = paymentReceiptUploadRequestSchema.safeParse(body);
  if (!parsed.success) {
    fail(res, 'VALIDATION_ERROR', 'Receipt must be a JPEG, PNG or PDF up to 10 MB', 400);
    return;
  }
  const storage = storageClient();
  if (!storage) {
    fail(res, 'INTERNAL', 'Receipt storage is not configured', 500);
    return;
  }
  const path = `${receiptPrefix(scope, ownerId)}${randomUUID()}.${EXTENSION[parsed.data.contentType]}`;
  // Supabase signed upload URLs live ~2 hours; report that, not a shorter window
  // we do not enforce. Type and size are enforced by the bucket (jpeg/png/pdf,
  // 10 MB); the declared values above only pick the extension and fail fast.
  const grant = await createUploadGrant(storage, PAYMENT_RECEIPT_BUCKET, path, 7200);
  res.status(201).json({ receiptStoragePath: path, ...grant });
}

/** Folder the grant issues for one sale/reservation. */
export function receiptPrefix(scope: 'sale' | 'reservation', ownerId: string): string {
  return `${scope}/${ownerId.toLowerCase()}/`;
}

/**
 * A payment may only cite a receipt uploaded for THAT sale/reservation, so one
 * receipt (or a refund/import proof in the same bucket) can never back another
 * payment. The SQL still checks the object exists.
 */
export function receiptBelongsTo(
  path: string,
  scope: 'sale' | 'reservation',
  ownerId: string,
): boolean {
  const value = path.trim();
  return value.startsWith(receiptPrefix(scope, ownerId)) && !value.includes('..');
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
