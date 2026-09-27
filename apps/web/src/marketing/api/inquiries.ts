/**
 * Inquiry outbox (Phase 3: browser-local only).
 *
 * The source site reads and writes the Supabase `inquiries` table when its
 * backend is configured. That backend was deleted with the old Supabase
 * project and this project has no equivalent inquiry intake, so only the
 * browser-local outbox is kept: `storeInquiry` (used by the contact form)
 * and `readInquiries` (used to dedupe). The remote inbox and status workflow
 * belong to Phase 4 / backend work.
 */
export type InquiryStatus = 'new' | 'contacted' | 'confirmed' | 'closed';
export interface InquiryRecord {
  id: string;
  created_at: string;
  name: string;
  email: string;
  contact_number: string;
  inquiry_type: string;
  message: string;
  kind: 'inquiry' | 'reservation';
  visit_date: string | null;
  end_date: string | null;
  guests: number | null;
  status: InquiryStatus;
  notes: string;
  archived_at?: string | null;
}
const KEY = 'afhomes.inquiries.v1';
export function readInquiries(): InquiryRecord[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as InquiryRecord[];
  } catch {
    return [];
  }
}
export function storeInquiry(record: InquiryRecord) {
  const records = readInquiries();
  if (records.some((item) => item.id === record.id)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify([record, ...records]));
  } catch {
    throw new Error('Browser storage is full or unavailable. Your request was not saved.');
  }
}
