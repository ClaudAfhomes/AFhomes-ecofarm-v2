import {
  inquirySchema,
  type Inquiry,
  type InquiryListQuery,
  type UpdateInquiryInput,
} from '@afhomes/contracts';

import { protectedRequest, protectedRequestListEnvelope } from '../../lib/api/client';

export async function listInquiries(query: InquiryListQuery) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined && value !== '') params.set(key, String(value));
  const { data, meta } = await protectedRequestListEnvelope(`/inquiries?${params}`, inquirySchema);
  return {
    data,
    total: Number(meta.total ?? data.length),
    newCount: Number(meta.newCount ?? 0),
  };
}

export const updateInquiry = (id: string, input: UpdateInquiryInput): Promise<Inquiry> =>
  protectedRequest(`/inquiries/${id}`, inquirySchema, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
