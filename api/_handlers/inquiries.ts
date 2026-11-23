import { randomInt } from 'node:crypto';

import {
  inquiryListQuerySchema,
  inquirySchema,
  submitInquirySchema,
  updateInquirySchema,
  type Inquiry,
} from '@afhomes/contracts';

import { authorizeAfHomes } from '../_lib/afhomes-access.js';
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
import { consumePublicInquiryAttempt } from '../_lib/rate-limit.js';
import { serviceClient } from '../_lib/rest.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

/**
 * Website inquiries inbox (migration 20270105000027).
 *
 *   POST  inquiries        PUBLIC. The website contact/reservation form. No session.
 *                          Honeypot, per-IP rate limit, idempotent on `requestId`.
 *   GET   inquiries        sales.inquiries view. Filter by status/kind, search.
 *   PATCH inquiries/:id    sales.inquiries update. Status, notes, assign to me. Audited.
 *
 * The table is unexposed (no browser grants, RLS with no policy); this handler
 * is the only reader and writer. A website "reservation" is a request to be
 * contacted, never a booking.
 */

const COLUMNS =
  'id, reference, kind, inquiry_type, name, email, contact_number, message, visit_date, end_date, guests, status, staff_notes, assigned_to, handled_at, created_at, updated_at';

const OPEN_STATUSES = ['new', 'contacted', 'confirmed'];

const SUBMITTED_MESSAGE = 'Thank you. AF Homes received your message and will contact you soon.';

/** PostgREST `or()` filter text: keep only characters that cannot change the filter. */
const safeSearch = (value: string) => value.replace(/[^\p{L}\p{N} @.+\-_]/gu, ' ').trim();

function toInquiry(row: Record<string, unknown>, names: Map<string, string>): Inquiry {
  const assignedTo = (row.assigned_to as string | null) ?? null;
  return inquirySchema.parse({
    id: row.id,
    reference: row.reference,
    kind: row.kind,
    inquiryType: row.inquiry_type,
    name: row.name,
    email: row.email,
    contactNumber: row.contact_number,
    message: row.message,
    visitDate: row.visit_date ?? null,
    endDate: row.end_date ?? null,
    guests: row.guests ?? null,
    status: row.status,
    staffNotes: row.staff_notes ?? '',
    assignedTo,
    assignedToName: assignedTo ? (names.get(assignedTo) ?? null) : null,
    handledAt: row.handled_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

async function staffNames(db: Db, ids: (string | null)[]): Promise<Map<string, string>> {
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

async function submit(req: VercelRequest, res: VercelResponse, db: Db) {
  const verdict = consumePublicInquiryAttempt(req);
  if (!verdict.allowed) {
    res.setHeader('Retry-After', String(verdict.retryAfterSeconds));
    return fail(res, 'RATE_LIMITED', 'Too many messages from this connection. Try again in a minute.', 429);
  }
  const parsed = submitInquirySchema.safeParse(jsonBody(req));
  if (!parsed.success)
    return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the form.', 400);
  const input = parsed.data;

  // Honeypot filled: a bot. Answer exactly like a success (same shape of
  // reference) so it learns nothing; store nothing.
  if (input.website) {
    const decoy = `INQ-${String(randomInt(1, 1_000_000)).padStart(6, '0')}`;
    return res.status(201).json({ reference: decoy, message: SUBMITTED_MESSAGE });
  }

  const row = {
    client_request_id: input.requestId,
    kind: input.kind,
    inquiry_type: input.inquiryType,
    name: input.name,
    email: input.email,
    contact_number: input.contactNumber,
    message: input.message,
    visit_date: input.visitDate ?? null,
    end_date: input.endDate ?? null,
    guests: input.guests ?? null,
  };
  const inserted = await db.from('website_inquiries').insert(row).select('reference').single();
  if (!inserted.error) {
    return res.status(201).json({ reference: inserted.data.reference, message: SUBMITTED_MESSAGE });
  }
  // A retried submission (same requestId) returns the row it already created.
  if (inserted.error.code === '23505') {
    const existing = await db
      .from('website_inquiries')
      .select('reference')
      .eq('client_request_id', input.requestId)
      .maybeSingle();
    if (!existing.error && existing.data)
      return res.status(200).json({ reference: existing.data.reference, message: SUBMITTED_MESSAGE });
  }
  if (inserted.error.code === '23514')
    return fail(res, 'VALIDATION_ERROR', 'Some details could not be accepted. Check the form.', 400);
  throw inserted.error;
}

async function listInquiries(req: VercelRequest, res: VercelResponse, db: Db) {
  const auth = await authorizeAfHomes(req, 'sales.inquiries', 'view');
  if ('error' in auth) return deny(res, auth);
  const parsed = inquiryListQuerySchema.safeParse(req.query);
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid list query.', 400);
  const { status, kind, search, limit, offset } = parsed.data;

  let query = db
    .from('website_inquiries')
    .select(COLUMNS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (status === 'open') query = query.in('status', OPEN_STATUSES);
  else if (status !== 'all') query = query.eq('status', status);
  if (kind) query = query.eq('kind', kind);
  const term = search ? safeSearch(search) : '';
  if (term)
    query = query.or(
      `reference.ilike.%${term}%,name.ilike.%${term}%,email.ilike.%${term}%,contact_number.ilike.%${term}%`,
    );

  const [{ data, error, count }, newCount] = await Promise.all([
    query,
    db.from('website_inquiries').select('id', { count: 'exact', head: true }).eq('status', 'new'),
  ]);
  if (error) throw error;
  if (newCount.error) throw newCount.error;
  const rows = (data ?? []) as Record<string, unknown>[];
  const names = await staffNames(db, rows.map((r) => r.assigned_to as string | null));
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).json({
    data: rows.map((r) => toInquiry(r, names)),
    meta: { total: count ?? rows.length, limit, offset, newCount: newCount.count ?? 0 },
  });
}

async function updateInquiry(req: VercelRequest, res: VercelResponse, db: Db, id: string) {
  const auth = await authorizeAfHomes(req, 'sales.inquiries', 'update');
  if ('error' in auth) return deny(res, auth);
  const parsed = updateInquirySchema.safeParse(jsonBody(req));
  if (!parsed.success)
    return fail(res, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the update.', 400);
  const input = parsed.data;

  const current = await db.from('website_inquiries').select(COLUMNS).eq('id', id).maybeSingle();
  if (current.error) throw current.error;
  if (!current.data) return fail(res, 'NOT_FOUND', 'Inquiry not found.', 404);
  const before = current.data as Record<string, unknown>;

  const patch: Record<string, unknown> = {};
  if (input.status !== undefined && input.status !== before.status) {
    patch.status = input.status;
    patch.handled_by = auth.userId;
    patch.handled_at = new Date().toISOString();
  }
  if (input.staffNotes !== undefined && input.staffNotes !== before.staff_notes)
    patch.staff_notes = input.staffNotes;
  if (input.assignToMe && before.assigned_to !== auth.userId) patch.assigned_to = auth.userId;
  if (input.unassign && before.assigned_to !== null) patch.assigned_to = null;

  let after = before;
  if (Object.keys(patch).length) {
    patch.updated_at = new Date().toISOString();
    const updated = await db
      .from('website_inquiries')
      .update(patch)
      .eq('id', id)
      .select(COLUMNS)
      .single();
    if (updated.error) throw updated.error;
    after = updated.data as Record<string, unknown>;
    // Notes are free text about a member of the public: the audit records THAT
    // they changed, not their content.
    await audit(
      db,
      auth.userId,
      'INQUIRY_UPDATED',
      'website_inquiry',
      id,
      { status: before.status, assignedTo: before.assigned_to },
      {
        status: after.status,
        assignedTo: after.assigned_to,
        notesChanged: 'staff_notes' in patch,
      },
    );
  }
  const names = await staffNames(db, [after.assigned_to as string | null]);
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).json(toInquiry(after, names));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Inquiry storage is unavailable.', 503);
  const path = subPath(req);
  const verb = method(req);
  if (path === '' && verb === 'POST') return submit(req, res, db);
  if (path === '' && verb === 'GET') return listInquiries(req, res, db);
  const match = path.match(new RegExp(`^${UUID_GROUP}$`, 'i'));
  if (match && verb === 'PATCH') return updateInquiry(req, res, db, match[1]!.toLowerCase());
  return fail(res, 'NOT_FOUND', 'Route not found.', 404);
}
