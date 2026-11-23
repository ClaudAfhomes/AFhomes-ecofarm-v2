import {
  BOOKING_STATUS_LABELS,
  bookingListQuerySchema,
  canTransitionBooking,
  updateBookingSchema,
  type Booking,
  type BookingStatus,
} from '@afhomes/contracts';

import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import {
  BOOKING_COLUMNS,
  customerSummaries,
  manilaToday,
  safeSearch,
  staffNames,
  toBooking,
} from '../_lib/engagement.js';
import {
  audit,
  deny,
  fail,
  jsonBody,
  method,
  subPath,
  UUID_GROUP,
  type Db,
} from '../_lib/handler-kit.js';
import { notifyCustomer } from '../_lib/notify.js';
import { serviceClient } from '../_lib/rest.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

/**
 * Staff side of member service bookings (migration 20270105000029).
 *
 *   GET   bookings       operations.bookings view. Open (requested + confirmed) by default.
 *   PATCH bookings/:id   operations.bookings update. Confirm, decline, complete, cancel.
 *
 * Every decision is audited and notifies the member in-app (no email). A booking holds no money and
 * moves no points.
 */

const OPEN: BookingStatus[] = ['requested', 'confirmed'];

async function withContext(db: Db, rows: Record<string, unknown>[]): Promise<Booking[]> {
  const [customers, staff] = await Promise.all([
    customerSummaries(
      db,
      rows.map((r) => r.customer_id as string),
    ),
    staffNames(
      db,
      rows.map((r) => r.decided_by as string | null),
    ),
  ]);
  return rows.map((r) => toBooking(r, { customers, staff }));
}

async function list(req: VercelRequest, res: VercelResponse, db: Db) {
  const auth = await authorizeAfHomes(req, 'operations.bookings', 'view');
  if ('error' in auth) return deny(res, auth);
  const parsed = bookingListQuerySchema.safeParse(req.query);
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid list query.', 400);
  const { status, search, limit, offset } = parsed.data;

  let query = db
    .from('service_bookings')
    .select(BOOKING_COLUMNS, { count: 'exact' })
    .order('start_date', {
      ascending: status === 'open' || status === 'requested' || status === 'confirmed',
    })
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1);
  if (status === 'open') query = query.in('status', OPEN);
  else if (status !== 'all') query = query.eq('status', status);
  const term = search ? safeSearch(search) : '';
  if (term) query = query.or(`reference.ilike.%${term}%,service_name_snapshot.ilike.%${term}%`);

  const [{ data, error, count }, requested] = await Promise.all([
    query,
    db
      .from('service_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'requested'),
  ]);
  if (error) throw error;
  if (requested.error) throw requested.error;
  const rows = (data ?? []) as Record<string, unknown>[];
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).json({
    data: await withContext(db, rows),
    meta: { total: count ?? rows.length, limit, offset, requestedCount: requested.count ?? 0 },
  });
}

const DATE_RULE: Partial<Record<BookingStatus, (start: string, today: string) => string | null>> = {
  confirmed: (start, today) =>
    start < today ? 'This booking date has passed; decline it instead.' : null,
  completed: (start, today) =>
    start > today ? 'A booking can be completed on or after its date.' : null,
};

function memberNotice(b: Booking) {
  const when =
    b.endDate && b.endDate !== b.startDate ? `${b.startDate} to ${b.endDate}` : b.startDate;
  const label = BOOKING_STATUS_LABELS[b.status].toLowerCase();
  const note = b.responseNote ? ` Note from AF Homes: ${b.responseNote}` : '';
  return {
    kind: 'booking' as const,
    title: `Booking ${b.reference} ${label}`,
    body: `${b.serviceName}, ${when}, ${b.guests} guest(s).${note}`,
    link: '/customer/bookings',
  };
}

async function update(req: VercelRequest, res: VercelResponse, db: Db, id: string) {
  const auth = await authorizeAfHomes(req, 'operations.bookings', 'update');
  if ('error' in auth) return deny(res, auth);
  const parsed = updateBookingSchema.safeParse(jsonBody(req));
  if (!parsed.success)
    return fail(
      res,
      'VALIDATION_ERROR',
      parsed.error.issues[0]?.message ?? 'Check the update.',
      400,
    );
  const { status: target, note } = parsed.data;

  const current = await db
    .from('service_bookings')
    .select(BOOKING_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (current.error) throw current.error;
  if (!current.data) return fail(res, 'NOT_FOUND', 'Booking not found.', 404);
  const row = current.data as Record<string, unknown>;
  const from = row.status as BookingStatus;

  // Repeating the decision already recorded is a no-op (a double click).
  if (from === target) {
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json((await withContext(db, [row]))[0]);
  }
  if (!canTransitionBooking(from, target))
    return fail(
      res,
      'CONFLICT',
      `A ${BOOKING_STATUS_LABELS[from].toLowerCase()} booking cannot be marked ${BOOKING_STATUS_LABELS[target].toLowerCase()}.`,
      409,
    );
  const dateProblem = DATE_RULE[target]?.(String(row.start_date).slice(0, 10), manilaToday());
  if (dateProblem) return fail(res, 'CONFLICT', dateProblem, 409);

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: target,
    decided_by: auth.userId,
    decided_at: now,
    updated_at: now,
    ...(target === 'cancelled' ? { cancelled_by: 'staff' } : {}),
    ...(note !== undefined ? { response_note: note } : {}),
  };
  // Conditional on the status we read, so two staff deciding at once cannot
  // both win.
  const updated = await db
    .from('service_bookings')
    .update(patch)
    .eq('id', id)
    .eq('status', from)
    .select(BOOKING_COLUMNS)
    .maybeSingle();
  if (updated.error) throw updated.error;
  if (!updated.data)
    return fail(
      res,
      'CONFLICT',
      'Someone else just updated this booking. Refresh and try again.',
      409,
    );
  const after = updated.data as Record<string, unknown>;

  await audit(
    db,
    auth.userId,
    'BOOKING_UPDATED',
    'service_booking',
    id,
    { status: from },
    { status: target, noteChanged: note !== undefined && note !== row.response_note },
  );
  const [booking] = await withContext(db, [after]);
  await notifyCustomer(db, String(after.customer_id), memberNotice(booking!));
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).json(booking);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Booking storage is unavailable.', 503);
  const path = subPath(req);
  const verb = method(req);
  if (path === '' && verb === 'GET') return list(req, res, db);
  const match = path.match(new RegExp(`^${UUID_GROUP}$`, 'i'));
  if (match && verb === 'PATCH') return update(req, res, db, match[1]!.toLowerCase());
  return fail(res, 'NOT_FOUND', 'Route not found.', 404);
}
