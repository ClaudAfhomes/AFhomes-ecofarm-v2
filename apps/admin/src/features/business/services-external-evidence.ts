/**
 * Evidence for payments made OUTSIDE AF Homes (commission payouts, live payroll
 * disbursements). Upload grant -> PUT bytes -> record; or record a structured
 * reference. Nothing here verifies a transaction.
 */
import {
  externalEvidenceListSchema,
  externalEvidenceUploadGrantSchema,
  type ExternalEvidenceList,
  type ExternalPaymentSubject,
  type RecordExternalEvidenceRequest,
} from '@afhomes/contracts';
import { z } from 'zod';

import { protectedRequest as request } from '../../lib/api/client';
import { putUploadBytes } from '../documents/services';

const idResult = z.object({ id: z.string() });

const base = (subject: ExternalPaymentSubject, id: string) =>
  subject === 'commission_payout'
    ? `/commissions/payouts/${encodeURIComponent(id)}/evidence`
    : `/queues/payroll/disbursements/${encodeURIComponent(id)}/evidence`;

export const getExternalEvidence = (
  subject: ExternalPaymentSubject,
  id: string,
): Promise<ExternalEvidenceList> => request(base(subject, id), externalEvidenceListSchema);

export const recordExternalEvidence = (
  subject: ExternalPaymentSubject,
  id: string,
  input: RecordExternalEvidenceRequest,
) => request(base(subject, id), idResult, { method: 'POST', body: JSON.stringify(input) });

/** Uploads the file to the server-chosen path and returns that path for recording. */
export async function uploadExternalEvidence(
  subject: ExternalPaymentSubject,
  id: string,
  file: File,
): Promise<string> {
  const grant = await request(`${base(subject, id)}/upload`, externalEvidenceUploadGrantSchema, {
    method: 'POST',
    body: JSON.stringify({ contentType: file.type, size: file.size }),
  });
  await putUploadBytes(grant.uploadUrl, file);
  return grant.storagePath;
}

/** Commission payouts only: an authorized note that no evidence exists. */
export const reviewCommissionEvidenceException = (payoutId: string, note: string) =>
  request(`${base('commission_payout', payoutId)}/exception-review`, idResult, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
