/**
 * Member engagement contracts: notifications, service bookings, announcements
 * and member-staff messages (migrations 20270105000028-31).
 *
 * None of these touch money or points. A booking is a request to use a
 * published service on a date; price and points stay in the existing sale,
 * payment and earning flows.
 */
import { z } from 'zod';

import {
  announcementStatusSchema,
  bookingStatusSchema,
  conversationStatusSchema,
} from './lifecycle.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar date (rejects 2026-02-30). */
const calendarDate = z
  .string()
  .regex(ISO_DATE, 'Use a YYYY-MM-DD date.')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === v;
  }, 'Use a real calendar date.');

const listPaging = {
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
};

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

export const notificationKindSchema = z.enum(['booking', 'message', 'announcement', 'account']);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

export const customerNotificationSchema = z.object({
  id: z.string().uuid(),
  kind: notificationKindSchema,
  title: z.string(),
  body: z.string(),
  /** A portal path (`/customer/...`), never an external URL. */
  /** Portal-relative only (same CHECK as the column), so a notice can never link off-site. */
  link: z
    .string()
    .max(200)
    .regex(/^\/customer(\/[A-Za-z0-9/_-]*)?$/)
    .nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type CustomerNotification = z.infer<typeof customerNotificationSchema>;

export const markNotificationsReadSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(100).optional(),
    all: z.literal(true).optional(),
  })
  .strict()
  .refine((v) => (v.ids ? 1 : 0) + (v.all ? 1 : 0) === 1, {
    message: 'Send either ids or all, not both.',
  });
export type MarkNotificationsRead = z.infer<typeof markNotificationsReadSchema>;

/** Staff header badge. `null` = the caller cannot view that module. */
export const staffAlertsSchema = z.object({
  newInquiries: z.number().int().nonnegative().nullable(),
  requestedBookings: z.number().int().nonnegative().nullable(),
  awaitingReply: z.number().int().nonnegative().nullable(),
});
export type StaffAlerts = z.infer<typeof staffAlertsSchema>;

/* ------------------------------------------------------------------ */
/* Service bookings                                                    */
/* ------------------------------------------------------------------ */

export const bookableServiceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  pricingUnit: z.string(),
  basePrice: z.string(),
});
export type BookableService = z.infer<typeof bookableServiceSchema>;

export const createBookingSchema = z
  .object({
    requestId: z.string().uuid(),
    serviceId: z.string().uuid(),
    startDate: calendarDate,
    endDate: calendarDate.optional(),
    guests: z.number().int().min(1, 'At least 1 guest.').max(100, 'At most 100 guests.'),
    notes: z.string().trim().max(1000, 'Keep notes under 1000 characters.').default(''),
  })
  .strict()
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    message: 'The end date cannot be before the start date.',
    path: ['endDate'],
  });
export type CreateBooking = z.infer<typeof createBookingSchema>;

export const bookingSchema = z.object({
  id: z.string().uuid(),
  reference: z.string(),
  serviceId: z.string().uuid(),
  serviceName: z.string(),
  startDate: z.string(),
  endDate: z.string().nullable(),
  guests: z.number().int(),
  customerNotes: z.string(),
  status: bookingStatusSchema,
  /** Staff message to the member (e.g. why a request was declined). */
  responseNote: z.string(),
  cancelledBy: z.enum(['customer', 'staff']).nullable(),
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Staff views only; null in the member portal. */
  customerId: z.string().uuid().nullable(),
  customerName: z.string().nullable(),
  customerNumber: z.string().nullable(),
  decidedByName: z.string().nullable(),
});
export type Booking = z.infer<typeof bookingSchema>;

export const bookingListQuerySchema = z.object({
  status: z.union([z.enum(['open', 'all']), bookingStatusSchema]).default('open'),
  search: z.string().trim().max(100).optional(),
  ...listPaging,
});
export type BookingListQuery = z.infer<typeof bookingListQuerySchema>;

/** Staff decision. Legal moves come from `canTransitionBooking`. */
export const updateBookingSchema = z
  .object({
    status: z.enum(['confirmed', 'declined', 'completed', 'cancelled']),
    note: z.string().trim().max(1000, 'Keep the note under 1000 characters.').optional(),
  })
  .strict();
export type UpdateBooking = z.infer<typeof updateBookingSchema>;

/* ------------------------------------------------------------------ */
/* Announcements                                                       */
/* ------------------------------------------------------------------ */

export const announcementAudienceSchema = z.enum(['customers', 'staff', 'everyone']);
export type AnnouncementAudience = z.infer<typeof announcementAudienceSchema>;

export const ANNOUNCEMENT_AUDIENCE_LABELS: Record<AnnouncementAudience, string> = {
  customers: 'Members',
  staff: 'Staff',
  everyone: 'Members and staff',
};

export const announcementSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  audience: announcementAudienceSchema,
  status: announcementStatusSchema,
  pinned: z.boolean(),
  publishedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Announcement = z.infer<typeof announcementSchema>;

/** What a reader (member or staff) sees: no workflow fields. */
export const announcementFeedItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  pinned: z.boolean(),
  publishedAt: z.string(),
  expiresAt: z.string().nullable(),
});
export type AnnouncementFeedItem = z.infer<typeof announcementFeedItemSchema>;

const announcementFields = {
  title: z.string().trim().min(3, 'Give it a title of at least 3 characters.').max(150),
  body: z.string().trim().min(1, 'Write the announcement.').max(5000),
  audience: announcementAudienceSchema,
  pinned: z.boolean(),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
};

export const createAnnouncementSchema = z
  .object({
    ...announcementFields,
    pinned: announcementFields.pinned.default(false),
    expiresAt: announcementFields.expiresAt.default(null),
    publish: z.boolean().default(false),
  })
  .strict();
export type CreateAnnouncement = z.infer<typeof createAnnouncementSchema>;

export const updateAnnouncementSchema = z
  .object({
    title: announcementFields.title.optional(),
    body: announcementFields.body.optional(),
    audience: announcementFields.audience.optional(),
    pinned: announcementFields.pinned.optional(),
    expiresAt: announcementFields.expiresAt.optional(),
    status: announcementStatusSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' });
export type UpdateAnnouncement = z.infer<typeof updateAnnouncementSchema>;

/* ------------------------------------------------------------------ */
/* Member-staff messages                                               */
/* ------------------------------------------------------------------ */

export const messageSenderSchema = z.enum(['customer', 'staff']);

export const conversationSchema = z.object({
  id: z.string().uuid(),
  subject: z.string(),
  status: conversationStatusSchema,
  lastMessageAt: z.string(),
  lastSenderKind: messageSenderSchema,
  /** From the viewer's side: a reply they have not opened yet. */
  unread: z.boolean(),
  createdAt: z.string(),
  /** Staff views only; null in the member portal. */
  customerId: z.string().uuid().nullable(),
  customerName: z.string().nullable(),
  customerNumber: z.string().nullable(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const conversationMessageSchema = z.object({
  id: z.string().uuid(),
  senderKind: messageSenderSchema,
  /** Staff sender's name; null for the member's own messages. */
  senderName: z.string().nullable(),
  body: z.string(),
  createdAt: z.string(),
});
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;

export const conversationDetailSchema = conversationSchema.extend({
  messages: z.array(conversationMessageSchema),
});
export type ConversationDetail = z.infer<typeof conversationDetailSchema>;

const messageBody = z
  .string()
  .trim()
  .min(1, 'Write a message.')
  .max(5000, 'Keep the message under 5000 characters.');

export const startConversationSchema = z
  .object({
    requestId: z.string().uuid(),
    subject: z.string().trim().min(3, 'Add a subject of at least 3 characters.').max(150),
    body: messageBody,
  })
  .strict();
export type StartConversation = z.infer<typeof startConversationSchema>;

export const postMessageSchema = z
  .object({ requestId: z.string().uuid(), body: messageBody })
  .strict();
export type PostMessage = z.infer<typeof postMessageSchema>;

export const conversationListQuerySchema = z.object({
  status: z.enum(['awaiting', 'open', 'closed', 'all']).default('awaiting'),
  search: z.string().trim().max(100).optional(),
  ...listPaging,
});
export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;

export const updateConversationSchema = z.object({ status: conversationStatusSchema }).strict();
export type UpdateConversation = z.infer<typeof updateConversationSchema>;
