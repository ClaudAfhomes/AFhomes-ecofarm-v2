import {
  announcementFeedItemSchema,
  announcementSchema,
  bookingSchema,
  conversationDetailSchema,
  conversationMessageSchema,
  conversationSchema,
  staffAlertsSchema,
  type Announcement,
  type AnnouncementFeedItem,
  type Booking,
  type BookingListQuery,
  type ConversationDetail,
  type ConversationListQuery,
  type ConversationMessage,
  type CreateAnnouncement,
  type PostMessage,
  type StaffAlerts,
  type UpdateAnnouncement,
  type UpdateBooking,
  type UpdateConversation,
} from '@afhomes/contracts';

import {
  protectedRequest,
  protectedRequestList,
  protectedRequestListEnvelope,
} from '../../lib/api/client';

const json = (body: unknown) => ({ body: JSON.stringify(body) });

function toParams(query: object) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined && value !== '') params.set(key, String(value));
  return params;
}

export const getStaffAlerts = (): Promise<StaffAlerts> =>
  protectedRequest('/staff-alerts', staffAlertsSchema);

/* Bookings */

export async function listBookings(query: Partial<BookingListQuery>) {
  const { data, meta } = await protectedRequestListEnvelope(
    `/bookings?${toParams(query)}`,
    bookingSchema,
  );
  return {
    data,
    total: Number(meta.total ?? data.length),
    requestedCount: Number(meta.requestedCount ?? 0),
  };
}

export const updateBooking = (id: string, input: UpdateBooking): Promise<Booking> =>
  protectedRequest(`/bookings/${id}`, bookingSchema, { method: 'PATCH', ...json(input) });

/* Announcements */

export const listAnnouncements = (): Promise<Announcement[]> =>
  protectedRequestList('/announcements', announcementSchema);

export const createAnnouncement = (input: CreateAnnouncement): Promise<Announcement> =>
  protectedRequest('/announcements', announcementSchema, { method: 'POST', ...json(input) });

export const updateAnnouncement = (id: string, input: UpdateAnnouncement): Promise<Announcement> =>
  protectedRequest(`/announcements/${id}`, announcementSchema, {
    method: 'PATCH',
    ...json(input),
  });

export const getAnnouncementFeed = (): Promise<AnnouncementFeedItem[]> =>
  protectedRequestList('/announcements/feed', announcementFeedItemSchema);

/* Member messages */

export async function listConversations(query: Partial<ConversationListQuery>) {
  const { data, meta } = await protectedRequestListEnvelope(
    `/conversations?${toParams(query)}`,
    conversationSchema,
  );
  return {
    data,
    total: Number(meta.total ?? data.length),
    awaitingCount: Number(meta.awaitingCount ?? 0),
  };
}

export const getConversation = (id: string): Promise<ConversationDetail> =>
  protectedRequest(`/conversations/${id}`, conversationDetailSchema);

export const postStaffMessage = (id: string, input: PostMessage): Promise<ConversationMessage> =>
  protectedRequest(`/conversations/${id}/messages`, conversationMessageSchema, {
    method: 'POST',
    ...json(input),
  });

export const updateConversation = (id: string, input: UpdateConversation) =>
  protectedRequest(`/conversations/${id}`, conversationSchema, { method: 'PATCH', ...json(input) });
