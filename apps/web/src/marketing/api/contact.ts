import { inquirySchema } from '../lib/inquiryValidation';
import { storeInquiry } from './inquiries';
import { sendClientMessage } from '../lib/email';
import type { ContactFormValues, ContactSubmitResult } from '../types/contact';

/**
 * Phase 3: there is no inquiry intake backend on this project (the source
 * site's Supabase Edge Function `submit-inquiry` does not exist here), so
 * this flag stays `false`. Submissions take the source site's own offline
 * path: validated, kept in the browser outbox, and handed to the visitor's
 * email app addressed to AFhomes. A server-side intake is Phase 4 / backend
 * work — do not point this at a nonexistent endpoint.
 */
export const hasInquiryBackend = false;

export const contactApi = {
  async submitInquiry(payload: ContactFormValues): Promise<ContactSubmitResult> {
    const checked = inquirySchema.safeParse(payload);
    if (!checked.success)
      throw new Error(checked.error.issues.map((issue) => issue.message).join(' '));
    const value = checked.data;

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
      reference: value.requestId,
      message:
        'Your message was prepared in your email app and sent to AFhomes at claudmarsjimenez.afhomes@gmail.com.',
    };
  },
};
