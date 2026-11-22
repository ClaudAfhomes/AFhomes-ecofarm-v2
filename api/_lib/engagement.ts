/**
 * Shared row mappers for the member-engagement handlers (bookings, messages,
 * notifications, announcements). One mapping per entity, so the member portal
 * and the staff screens can never describe the same row two ways.
 */
import {
  announcementFeedItemSchema,
  bookingSchema,
  conversationMessageSchema,
  conversationSchema,
  customerNotificationSchema,
  type Booking,
  type Conversation,
} from '@afhomes/contracts';

import type { Db } from './handler-kit.js';

export const BOOKING_COLUMNS =
  'id, reference, customer_id, service_id, service_name_snapshot, start_date, end_date, guests, customer_notes, status, response_note, cancelled_by, decided_by, decided_at, created_at, updated_at';
export const CONVERSATION_COLUMNS =
  'id, customer_id, subject, status, last_message_at, last_sender_kind, customer_last_read_at, staff_last_read_at, created_at';
export const MESSAGE_COLUMNS = 'id, sender_kind, sender_staff_id, body, created_at';

/** Today's date in the Philippines (YYYY-MM-DD), the day AF Homes works in. */
export const manilaToday = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

const text = (v: unknown) => (typeof v === 'string' ? v : v == null ? null : String(v));

export async function staffNames(
  db: Db,
  ids: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (!unique.length) return new Map();
  const { data, error } = await db.from('staff_users').select('id, full_name').in('id', unique);
  if (error) throw error;
  return new Map(
    ((data ?? []) as { id: string; full_name: string | null }[])
      .filter((s) => s.full_name)
      .map((s) => [s.id, s.full_name as string]),
  );
}

export type CustomerSummary = { name: string; number: string | null };

/** Display names for staff screens. Only name and customer number - no contact data. */
export async function customerSummaries(
  db: Db,
  ids: (string | null | undefined)[],
): Promise<Map<string, CustomerSummary>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (!unique.length) return new Map();
  const { data, error } = await db
    .from('customers')
    .select('id, customer_number, first_name, middle_name, last_name')
    .in('id', unique);
  if (error) throw error;
  return new Map(
    ((data ?? []) as Record<string, unknown>[]).map((c) => {
      const name = [c.first_name, c.middle_name, c.last_name]
        .filter((part): part is string => typeof part === 'string' && part.length > 0)
        .join(' ');
      const number = text(c.customer_number);
      return [String(c.id), { name: name || number || 'Member', number }];
    }),
  );
}

export type StaffContext = {
  customers: Map<string, CustomerSummary>;
  staff: Map<string, string>;
};

/** `ctx` null = member portal view (no customer or staff identities). */
export function toBooking(row: Record<string, unknown>, ctx: StaffContext | null): Booking {
  const customerId = String(row.customer_id);
  const decidedBy = text(row.decided_by);
  return bookingSchema.parse({
    id: row.id,
    reference: row.reference,
    serviceId: row.service_id,
    serviceName: row.service_name_snapshot,
    startDate: String(row.start_date).slice(0, 10),
    endDate: row.end_date ? String(row.end_date).slice(0, 10) : null,
    guests: Number(row.guests),
    customerNotes: row.customer_notes ?? '',
    status: row.status,
    responseNote: row.response_note ?? '',
    cancelledBy: row.cancelled_by ?? null,
    decidedAt: text(row.decided_at),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    customerId: ctx ? customerId : null,
    customerName: ctx ? (ctx.customers.get(customerId)?.name ?? null) : null,
    customerNumber: ctx ? (ctx.customers.get(customerId)?.number ?? null) : null,
    decidedByName: ctx && decidedBy ? (ctx.staff.get(decidedBy) ?? null) : null,
  });
}

const before = (a: unknown, b: unknown) => !a || new Date(String(a)) < new Date(String(b));

export function toConversation(
  row: Record<string, unknown>,
  viewer: 'customer' | 'staff',
  customers: Map<string, CustomerSummary> | null,
): Conversation {
  const customerId = String(row.customer_id);
  const unread =
    viewer === 'customer'
      ? row.last_sender_kind === 'staff' && before(row.customer_last_read_at, row.last_message_at)
      : row.last_sender_kind === 'customer' && before(row.staff_last_read_at, row.last_message_at);
  return conversationSchema.parse({
    id: row.id,
    subject: row.subject,
    status: row.status,
    lastMessageAt: text(row.last_message_at),
    lastSenderKind: row.last_sender_kind,
    unread,
    createdAt: text(row.created_at),
    customerId: customers ? customerId : null,
    customerName: customers ? (customers.get(customerId)?.name ?? null) : null,
    customerNumber: customers ? (customers.get(customerId)?.number ?? null) : null,
  });
}

export function toMessage(row: Record<string, unknown>, names: Map<string, string>) {
  const staffId = text(row.sender_staff_id);
  return conversationMessageSchema.parse({
    id: row.id,
    senderKind: row.sender_kind,
    senderName:
      row.sender_kind === 'staff'
        ? staffId
          ? (names.get(staffId) ?? 'AF Homes')
          : 'AF Homes'
        : null,
    body: row.body,
    createdAt: text(row.created_at),
  });
}

export const toNotification = (row: Record<string, unknown>) =>
  customerNotificationSchema.parse({
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body ?? '',
    link: text(row.link),
    readAt: text(row.read_at),
    createdAt: text(row.created_at),
  });

export const feedItem = (row: Record<string, unknown>) =>
  announcementFeedItemSchema.parse({
    id: row.id,
    title: row.title,
    body: row.body,
    pinned: row.pinned === true,
    publishedAt: text(row.published_at),
    expiresAt: text(row.expires_at),
  });

/** PostgREST `or()` filter text: keep only characters that cannot change the filter. */
export const safeSearch = (value: string) => value.replace(/[^\p{L}\p{N} @.+\-_]/gu, ' ').trim();
