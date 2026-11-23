import {
  bookableServiceSchema,
  canTransitionBooking,
  createBookingSchema,
  markNotificationsReadSchema,
  postMessageSchema,
  startConversationSchema,
  type BookingStatus,
} from '@afhomes/contracts';

import {
  isActiveCustomer,
  resolveCustomerPrincipal,
  type CustomerPrincipal,
} from '../_lib/customer-access.js';
import { fail, jsonBody, method, subPath, UUID_GROUP, type Db } from '../_lib/handler-kit.js';
import {
  BOOKING_COLUMNS,
  CONVERSATION_COLUMNS,
  feedItem,
  manilaToday,
  MESSAGE_COLUMNS,
  toBooking,
  toConversation,
  toMessage,
  toNotification,
} from '../_lib/engagement.js';
import { consumeMemberWriteAttempt } from '../_lib/rate-limit.js';
import { serviceClient } from '../_lib/rest.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

/**
 * Member portal: notifications, service bookings, announcements, messages.
 * Ownership only (api/_lib/customer-access.ts) - nothing here consults the staff
 * permission model, and every query is scoped to the session's customer.
 *
 *   GET  portal/notifications               own notices + unreadCount
 *   POST portal/notifications/read          { ids } | { all: true }
 *   GET  portal/announcements               published member/everyone notices
 *   GET  portal/services                    bookable services
 *   GET  portal/bookings                    own bookings
 *   POST portal/bookings                    request a booking (ACTIVE member)
 *   POST portal/bookings/:id/cancel         cancel own requested/confirmed booking
 *   GET  portal/conversations               own threads
 *   POST portal/conversations               start a thread
 *   GET  portal/conversations/:id           thread + messages (marks read)
 *   POST portal/conversations/:id/messages  reply
 *
 * Bookings need an ACTIVE member (same rule as membership and points). Any
 * linked member, including a suspended one, may read notices and message staff:
 * that is how a restriction gets resolved.
 */

const SERVICE_COLUMNS =
  'id, name, description, base_price, details, is_active, published, availability';

const isBookable = (row: Record<string, unknown>) =>
  row.is_active === true && row.published === true && row.availability === 'available';

function limited(req: VercelRequest, res: VercelResponse, principal: CustomerPrincipal) {
  const verdict = consumeMemberWriteAttempt(req, principal.customerId);
  if (verdict.allowed) return false;
  res.setHeader('Retry-After', String(verdict.retryAfterSeconds));
  fail(res, 'RATE_LIMITED', 'Too many requests. Try again in a minute.', 429);
  return true;
}

const noStore = (res: VercelResponse) => res.setHeader('Cache-Control', 'private, no-store');

/** Abuse caps: open bookings / open threads per member, and how far ahead a booking may start. */
export const MAX_OPEN_PER_MEMBER = 10;
const BOOKING_HORIZON_YEARS = 2;
const addYears = (isoDate: string, years: number) =>
  `${Number(isoDate.slice(0, 4)) + years}${isoDate.slice(4)}`;

/* ---------------- notifications ---------------- */

async function listNotifications(res: VercelResponse, db: Db, p: CustomerPrincipal) {
  const [rows, unread] = await Promise.all([
    db
      .from('customer_notifications')
      .select('id, kind, title, body, link, read_at, created_at')
      .eq('customer_id', p.customerId)
      .order('created_at', { ascending: false })
      .range(0, 49),
    db
      .from('customer_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', p.customerId)
      .is('read_at', null),
  ]);
  if (rows.error) throw rows.error;
  if (unread.error) throw unread.error;
  noStore(res);
  return res.status(200).json({
    data: ((rows.data ?? []) as Record<string, unknown>[]).map(toNotification),
    meta: { unreadCount: unread.count ?? 0 },
  });
}

async function markRead(req: VercelRequest, res: VercelResponse, db: Db, p: CustomerPrincipal) {
  const parsed = markNotificationsReadSchema.safeParse(jsonBody(req));
  if (!parsed.success)
    return fail(
      res,
      'VALIDATION_ERROR',
      parsed.error.issues[0]?.message ?? 'Check the request.',
      400,
    );
  let query = db
    .from('customer_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('customer_id', p.customerId)
    .is('read_at', null);
  if (parsed.data.ids) query = query.in('id', parsed.data.ids);
  const { error } = await query;
  if (error) throw error;
  noStore(res);
  return res.status(200).json({ ok: true });
}

/* ---------------- announcements ---------------- */

async function announcementFeed(res: VercelResponse, db: Db) {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('announcements')
    .select('id, title, body, pinned, published_at, expires_at')
    .eq('status', 'published')
    .in('audience', ['customers', 'everyone'])
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order('pinned', { ascending: false })
    .order('published_at', { ascending: false })
    .range(0, 19);
  if (error) throw error;
  noStore(res);
  return res.status(200).json({ data: ((data ?? []) as Record<string, unknown>[]).map(feedItem) });
}

/* ---------------- bookings ---------------- */

async function listServices(res: VercelResponse, db: Db) {
  const { data, error } = await db
    .from('service_catalog')
    .select(SERVICE_COLUMNS)
    .eq('is_active', true)
    .eq('published', true)
    .eq('availability', 'available')
    .order('name', { ascending: true });
  if (error) throw error;
  noStore(res);
  return res.status(200).json({
    data: ((data ?? []) as Record<string, unknown>[]).map((row) =>
      bookableServiceSchema.parse({
        id: row.id,
        name: row.name,
        description: (row.description as string | null) ?? null,
        pricingUnit: ((row.details ?? {}) as { pricingUnit?: string }).pricingUnit ?? 'unit',
        basePrice: row.base_price,
      }),
    ),
  });
}

async function listBookings(res: VercelResponse, db: Db, p: CustomerPrincipal) {
  const { data, error } = await db
    .from('service_bookings')
    .select(BOOKING_COLUMNS)
    .eq('customer_id', p.customerId)
    .order('created_at', { ascending: false })
    .range(0, 99);
  if (error) throw error;
  noStore(res);
  return res
    .status(200)
    .json({ data: ((data ?? []) as Record<string, unknown>[]).map((r) => toBooking(r, null)) });
}

async function createBooking(
  req: VercelRequest,
  res: VercelResponse,
  db: Db,
  p: CustomerPrincipal,
) {
  if (!isActiveCustomer(p))
    return fail(res, 'FORBIDDEN', 'Bookings are available to active members only.', 403);
  const parsed = createBookingSchema.safeParse(jsonBody(req));
  if (!parsed.success)
    return fail(
      res,
      'VALIDATION_ERROR',
      parsed.error.issues[0]?.message ?? 'Check the booking.',
      400,
    );
  const input = parsed.data;

  // A retry of the same request returns the member's own booking, decided
  // BEFORE any date or service check so a lost response can always be recovered.
  const existing = await db
    .from('service_bookings')
    .select(BOOKING_COLUMNS)
    .eq('customer_id', p.customerId)
    .eq('client_request_id', input.requestId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    noStore(res);
    return res.status(200).json(toBooking(existing.data as Record<string, unknown>, null));
  }

  if (limited(req, res, p)) return;
  const today = manilaToday();
  if (input.startDate < today)
    return fail(res, 'VALIDATION_ERROR', 'Choose today or a later date.', 400);
  if (input.startDate > addYears(today, BOOKING_HORIZON_YEARS))
    return fail(res, 'VALIDATION_ERROR', 'Bookings can be made up to two years ahead.', 400);
  const open = await db
    .from('service_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', p.customerId)
    .in('status', ['requested', 'confirmed']);
  if (open.error) throw open.error;
  if ((open.count ?? 0) >= MAX_OPEN_PER_MEMBER)
    return fail(
      res,
      'CONFLICT',
      `You already have ${MAX_OPEN_PER_MEMBER} open bookings. Cancel one or wait for it to finish first.`,
      409,
    );
  const service = await db
    .from('service_catalog')
    .select(SERVICE_COLUMNS)
    .eq('id', input.serviceId)
    .maybeSingle();
  if (service.error) throw service.error;
  if (!service.data || !isBookable(service.data as Record<string, unknown>))
    return fail(res, 'VALIDATION_ERROR', 'This service is not open for booking right now.', 400);

  const inserted = await db
    .from('service_bookings')
    .insert({
      client_request_id: input.requestId,
      customer_id: p.customerId,
      service_id: input.serviceId,
      service_name_snapshot: String((service.data as Record<string, unknown>).name).slice(0, 200),
      start_date: input.startDate,
      end_date: input.endDate ?? null,
      guests: input.guests,
      customer_notes: input.notes,
    })
    .select(BOOKING_COLUMNS)
    .single();
  if (inserted.error) {
    // Two copies of the same request racing: return the one that won.
    if (inserted.error.code === '23505') {
      const won = await db
        .from('service_bookings')
        .select(BOOKING_COLUMNS)
        .eq('customer_id', p.customerId)
        .eq('client_request_id', input.requestId)
        .maybeSingle();
      if (!won.error && won.data) {
        noStore(res);
        return res.status(200).json(toBooking(won.data as Record<string, unknown>, null));
      }
    }
    if (inserted.error.code === '23514')
      return fail(res, 'VALIDATION_ERROR', 'Some booking details could not be accepted.', 400);
    throw inserted.error;
  }
  const booking = toBooking(inserted.data as Record<string, unknown>, null);
  noStore(res);
  return res.status(201).json(booking);
}

async function cancelBooking(
  req: VercelRequest,
  res: VercelResponse,
  db: Db,
  p: CustomerPrincipal,
  id: string,
) {
  if (limited(req, res, p)) return;
  const current = await db
    .from('service_bookings')
    .select(BOOKING_COLUMNS)
    .eq('id', id)
    .eq('customer_id', p.customerId)
    .maybeSingle();
  if (current.error) throw current.error;
  // Another member's booking is indistinguishable from a missing one.
  if (!current.data) return fail(res, 'NOT_FOUND', 'Booking not found.', 404);
  const row = current.data as Record<string, unknown>;
  if (row.status === 'cancelled') {
    noStore(res);
    return res.status(200).json(toBooking(row, null));
  }
  if (!canTransitionBooking(row.status as BookingStatus, 'cancelled'))
    return fail(res, 'CONFLICT', 'This booking can no longer be cancelled.', 409);
  if (String(row.start_date) < manilaToday())
    return fail(res, 'CONFLICT', 'This booking date has passed. Contact AF Homes for help.', 409);
  const updated = await db
    .from('service_bookings')
    .update({ status: 'cancelled', cancelled_by: 'customer', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('customer_id', p.customerId)
    .eq('status', row.status)
    .select(BOOKING_COLUMNS)
    .maybeSingle();
  if (updated.error) throw updated.error;
  if (!updated.data)
    return fail(res, 'CONFLICT', 'This booking just changed. Refresh and try again.', 409);
  const booking = toBooking(updated.data as Record<string, unknown>, null);
  noStore(res);
  return res.status(200).json(booking);
}

/* ---------------- conversations ---------------- */

async function listConversations(res: VercelResponse, db: Db, p: CustomerPrincipal) {
  const { data, error } = await db
    .from('customer_conversations')
    .select(CONVERSATION_COLUMNS)
    .eq('customer_id', p.customerId)
    .order('last_message_at', { ascending: false })
    .range(0, 99);
  if (error) throw error;
  noStore(res);
  return res.status(200).json({
    data: ((data ?? []) as Record<string, unknown>[]).map((r) =>
      toConversation(r, 'customer', null),
    ),
  });
}

async function ownConversation(db: Db, p: CustomerPrincipal, id: string) {
  const { data, error } = await db
    .from('customer_conversations')
    .select(CONVERSATION_COLUMNS)
    .eq('id', id)
    .eq('customer_id', p.customerId)
    .maybeSingle();
  if (error) throw error;
  return (data as Record<string, unknown> | null) ?? null;
}

async function conversationDetail(res: VercelResponse, db: Db, p: CustomerPrincipal, id: string) {
  const convo = await ownConversation(db, p, id);
  if (!convo) return fail(res, 'NOT_FOUND', 'Conversation not found.', 404);
  const msgs = await db
    .from('customer_conversation_messages')
    .select(MESSAGE_COLUMNS)
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })
    .range(0, 499);
  if (msgs.error) throw msgs.error;
  const rows = (msgs.data ?? []) as Record<string, unknown>[];
  // Members see staff replies as "AF Homes", never an individual staff name.
  const names = new Map<string, string>();
  const readAt = new Date().toISOString();
  const marked = await db
    .from('customer_conversations')
    .update({ customer_last_read_at: readAt })
    .eq('id', id)
    .eq('customer_id', p.customerId);
  if (marked.error) throw marked.error;
  noStore(res);
  return res.status(200).json({
    ...toConversation({ ...convo, customer_last_read_at: readAt }, 'customer', null),
    messages: rows.map((m) => toMessage(m, names)),
  });
}

async function startConversation(
  req: VercelRequest,
  res: VercelResponse,
  db: Db,
  p: CustomerPrincipal,
) {
  const parsed = startConversationSchema.safeParse(jsonBody(req));
  if (!parsed.success)
    return fail(
      res,
      'VALIDATION_ERROR',
      parsed.error.issues[0]?.message ?? 'Check the message.',
      400,
    );
  const input = parsed.data;

  // Idempotent on requestId: a retry finds the member's own thread (and adds the
  // first message if the earlier attempt stopped between the two inserts).
  let convo = await db
    .from('customer_conversations')
    .select(CONVERSATION_COLUMNS)
    .eq('customer_id', p.customerId)
    .eq('client_request_id', input.requestId)
    .maybeSingle();
  if (convo.error) throw convo.error;
  let created = false;
  if (!convo.data) {
    if (limited(req, res, p)) return;
    const open = await db
      .from('customer_conversations')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', p.customerId)
      .eq('status', 'open');
    if (open.error) throw open.error;
    if ((open.count ?? 0) >= MAX_OPEN_PER_MEMBER)
      return fail(
        res,
        'CONFLICT',
        `You already have ${MAX_OPEN_PER_MEMBER} open conversations. Reply in one of them instead.`,
        409,
      );
    convo = await db
      .from('customer_conversations')
      .insert({
        customer_id: p.customerId,
        client_request_id: input.requestId,
        subject: input.subject,
      })
      .select(CONVERSATION_COLUMNS)
      .single();
    if (convo.error?.code === '23505') {
      convo = await db
        .from('customer_conversations')
        .select(CONVERSATION_COLUMNS)
        .eq('customer_id', p.customerId)
        .eq('client_request_id', input.requestId)
        .single();
    } else created = true;
    if (convo.error) throw convo.error;
  }
  const convoId = (convo.data as Record<string, unknown>).id as string;
  const msg = await db
    .from('customer_conversation_messages')
    .insert({
      conversation_id: convoId,
      client_request_id: input.requestId,
      sender_kind: 'customer',
      body: input.body,
    })
    .select('id')
    .single();
  if (msg.error && msg.error.code !== '23505') throw msg.error;
  const fresh = await ownConversation(db, p, convoId);
  noStore(res);
  return res
    .status(created ? 201 : 200)
    .json(toConversation(fresh ?? (convo.data as Record<string, unknown>), 'customer', null));
}

async function reply(
  req: VercelRequest,
  res: VercelResponse,
  db: Db,
  p: CustomerPrincipal,
  id: string,
) {
  if (limited(req, res, p)) return;
  const parsed = postMessageSchema.safeParse(jsonBody(req));
  if (!parsed.success)
    return fail(
      res,
      'VALIDATION_ERROR',
      parsed.error.issues[0]?.message ?? 'Check the message.',
      400,
    );
  const convo = await ownConversation(db, p, id);
  if (!convo) return fail(res, 'NOT_FOUND', 'Conversation not found.', 404);
  const msg = await db
    .from('customer_conversation_messages')
    .insert({
      conversation_id: id,
      client_request_id: parsed.data.requestId,
      sender_kind: 'customer',
      body: parsed.data.body,
    })
    .select(MESSAGE_COLUMNS)
    .single();
  let row = msg.data as Record<string, unknown> | null;
  if (msg.error) {
    if (msg.error.code !== '23505') throw msg.error;
    const again = await db
      .from('customer_conversation_messages')
      .select(MESSAGE_COLUMNS)
      .eq('conversation_id', id)
      .eq('client_request_id', parsed.data.requestId)
      .single();
    if (again.error) throw again.error;
    row = again.data as Record<string, unknown>;
  }
  noStore(res);
  return res.status(201).json(toMessage(row!, new Map()));
}

/* ---------------- dispatch ---------------- */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const resolved = await resolveCustomerPrincipal(req);
  if ('error' in resolved)
    return res.status(resolved.error.status).json({ error: resolved.error.error });
  const db = serviceClient() as Db | null;
  if (!db) return fail(res, 'INTERNAL', 'Member services are unavailable right now.', 503);
  const p = resolved;
  const path = subPath(req);
  const verb = method(req);

  if (path === 'notifications' && verb === 'GET') return listNotifications(res, db, p);
  if (path === 'notifications/read' && verb === 'POST') return markRead(req, res, db, p);
  if (path === 'announcements' && verb === 'GET') return announcementFeed(res, db);
  if (path === 'services' && verb === 'GET') return listServices(res, db);
  if (path === 'bookings' && verb === 'GET') return listBookings(res, db, p);
  if (path === 'bookings' && verb === 'POST') return createBooking(req, res, db, p);
  if (path === 'conversations' && verb === 'GET') return listConversations(res, db, p);
  if (path === 'conversations' && verb === 'POST') return startConversation(req, res, db, p);

  const cancel = path.match(new RegExp(`^bookings/${UUID_GROUP}/cancel$`, 'i'));
  if (cancel && verb === 'POST') return cancelBooking(req, res, db, p, cancel[1]!.toLowerCase());
  const thread = path.match(new RegExp(`^conversations/${UUID_GROUP}$`, 'i'));
  if (thread && verb === 'GET') return conversationDetail(res, db, p, thread[1]!.toLowerCase());
  const post = path.match(new RegExp(`^conversations/${UUID_GROUP}/messages$`, 'i'));
  if (post && verb === 'POST') return reply(req, res, db, p, post[1]!.toLowerCase());

  return fail(res, 'NOT_FOUND', 'Route not found.', 404);
}
