import { z } from 'zod';
import {
  customerImportContinuationSchema,
  importSourceIntakeSchema,
  importPaymentClaimSchema,
  type ImportClaimDecision,
} from '@afhomes/contracts';
import { protectedRequest as request } from '../../lib/api/client';
import { putUploadBytes } from '../documents/services';

export const getImportContinuations = (customerId?: string, offset = 0) =>
  request(
    `/customer-imports/continuations?limit=25&offset=${offset}${customerId ? `&customerId=${encodeURIComponent(customerId)}` : ''}`,
    z.array(customerImportContinuationSchema),
  );
export const getImportRowIntake = (rowId: string) =>
  request(`/customer-imports/rows/${rowId}/intake`, importSourceIntakeSchema);
export const getImportClaims = (reservationId: string, offset = 0) =>
  request(
    `/customer-imports/reservations/${reservationId}/claims?limit=100&offset=${offset}`,
    z.array(importPaymentClaimSchema),
  );
export const reconcileImportClaim = (
  claim: z.infer<typeof importPaymentClaimSchema>,
  decision: ImportClaimDecision,
  requestId: string,
) =>
  request(`/customer-imports/payment-claims/${claim.id}/reconcile`, z.unknown(), {
    method: 'POST',
    body: JSON.stringify({
      requestId,
      expectedClaimVersion: claim.expectedClaimVersion,
      expectedTargetVersion: claim.expectedTargetVersion,
      decision,
    }),
  });
export async function uploadImportReceipt(claimId: string, file: File) {
  const path = `/customer-imports/payment-claims/${claimId}/proof`;
  const grant = await request(
    `${path}/upload`,
    z.object({ proofDocumentId: z.uuid(), uploadUrl: z.url(), expiresAt: z.string() }),
    { method: 'POST', body: JSON.stringify({ mime: file.type, sizeBytes: file.size }) },
  );
  await putUploadBytes(grant.uploadUrl, file);
  await request(`${path}/complete`, z.object({ ok: z.literal(true) }), {
    method: 'POST',
    body: JSON.stringify({ proofDocumentId: grant.proofDocumentId }),
  });
}
export const getImportReceipt = (claimId: string) =>
  request(
    `/customer-imports/payment-claims/${claimId}/proof`,
    z.object({ url: z.url(), expiresAt: z.string() }),
  );
