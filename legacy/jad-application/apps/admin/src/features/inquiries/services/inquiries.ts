import {
  contactInquirySchema,
  type ContactInquiry,
  type ContactInquiryStatus,
} from '@jad/contracts';

import { request, requestList } from '../../../lib/api/client';

/** GET /admin/inquiries - Contact page submissions, newest first. */
export function getInquiries(): Promise<ContactInquiry[]> {
  return requestList('/admin/inquiries', contactInquirySchema);
}

/** PATCH /admin/inquiries/:id - triage a contact submission. */
export function updateInquiry(id: string, status: ContactInquiryStatus): Promise<ContactInquiry> {
  return request(`/admin/inquiries/${id}`, contactInquirySchema, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}
