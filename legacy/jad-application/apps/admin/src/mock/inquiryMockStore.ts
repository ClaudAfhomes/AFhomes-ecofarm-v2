import type { ContactInquiry, ContactInquiryStatus } from '@jad/contracts';

/**
 * In-memory mock store for admin Inquiries (public Contact page form).
 * Seeds mirror the `ContactInquiry` shape; staff triage writes through here
 * (NEW → READ → ARCHIVED) so the mock list stays consistent within a
 * dev/test session. Production reads/writes the real endpoint - this is a
 * test double only.
 */
export const MOCK_INQUIRIES: ContactInquiry[] = [
  {
    id: 'inq-seed-1',
    name: 'Maria Santos',
    email: 'maria@example.com',
    message: 'I would like to know more about membership, thank you.',
    status: 'NEW',
    createdAt: '2026-09-16T10:00:00.000Z',
  },
  {
    id: 'inq-seed-2',
    name: 'Jose Cruz',
    email: 'jose@example.com',
    message: 'Do you have properties near Alaminos?',
    status: 'READ',
    createdAt: '2026-09-15T09:00:00.000Z',
  },
];

export const inquiryStore: { items: ContactInquiry[] } = {
  items: MOCK_INQUIRIES.map((item) => ({ ...item })),
};

/** Restore seed state (specs call this to isolate mutation tests). */
export function resetInquiryStore(): void {
  inquiryStore.items = MOCK_INQUIRIES.map((item) => ({ ...item }));
}

export function updateStoreInquiry(
  id: string,
  status: ContactInquiryStatus,
): ContactInquiry | undefined {
  const item = inquiryStore.items.find((inquiry) => inquiry.id === id);
  if (!item) return undefined;
  item.status = status;
  return item;
}
