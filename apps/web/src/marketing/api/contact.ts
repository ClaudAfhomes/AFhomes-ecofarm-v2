import { submitInquiryResultSchema } from '@afhomes/contracts';

import { request } from '../../lib/api/client';
import { ApiError } from '../../lib/api/errors';
import { inquirySchema } from '../lib/inquiryValidation';
import { storeInquiry } from './inquiries';
import { sendClientMessage } from '../lib/email';
import type { ContactFormValues, ContactSubmitResult } from '../types/contact';

/**
 * Submissions go to the AF Homes inquiry inbox (`POST /inquiries`, migration
 * 20270105000027), where staff see them under Sales → Website Inquiries.
 *
 * If the server cannot be reached (offline, outage), the old path still runs so
 * the message is not lost: kept in the browser outbox and handed to the
 * visitor's email app addressed to AF Homes. A validation refusal (4xx) is shown
 * to the visitor instead, because emailing it would only hide the problem.
 */
export const hasInquiryBackend = true;

export const contactApi = {
  async submitInquiry(payload: ContactFormValues): Promise<ContactSubmitResult> {
    const checked = inquirySchema.safeParse(payload);
    if (!checked.success)
      throw new Error(checked.error.issues.map((issue) => issue.message).join(' '));
    const value = checked.data;

    try {
      const saved = await request('/inquiries', submitInquiryResultSchema, {
        method: 'POST',
        body: JSON.stringify(value),
      });
      return {
        ok: true,
        reference: saved.reference,
        message: 'AF Homes received your message and will contact you soon.',
      };
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) throw error;
      // Server unreachable: fall through to the offline path below.
    }

    storeInquiry({
      id: value.requestId,
      created_at: new Date().toISOString(),
      name: value.name,
      email: value.email,
      contact_number: value.contactNumber,
      inquiry_type: value.inquiryType,
      message: value.message,
      kind: value.kind,
      visit_date: value.visitDate ?? null,
      end_date: value.endDate ?? null,
      guests: value.guests ?? null,
      status: 'new',
      notes: '',
    });

    sendClientMessage(value);

    return {
      ok: true,
      offline: true,
      reference: value.requestId,
      message:
        'We could not reach AF Homes just now, so your message was prepared in your email app, addressed to info@afhomes.com.ph. Please press Send there.',
    };
  },
};
