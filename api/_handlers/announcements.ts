import {
  ANNOUNCEMENT_STATUS_LABELS,
  announcementSchema,
  canTransitionAnnouncement,
  createAnnouncementSchema,
  updateAnnouncementSchema,
  type Announcement,
  type AnnouncementStatus,
} from '@afhomes/contracts';

import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import { feedItem, staffNames } from '../_lib/engagement.js';
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
import { serviceClient } from '../_lib/rest.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

/**
 * Announcements (migration 20270105000030).
 *
 *   GET   announcements        communication.announcements view. Every notice.
 *   POST  announcements        communication.announcements create. Draft or publish now.
 *   PATCH announcements/:id    communication.announcements update. Edit, publish, archive.
 *   GET   announcements/feed   any staff with dashboard access: published staff/everyone notices.
 *
 * Members read their feed through `portal/announcements`. Publishing emails no
 * one. Nothing is deleted: notices are archived. Every change is audited.
 */

const COLUMNS =
  'id, title, body, audience, status, pinned, published_at, expires_at, created_by, created_at, updated_at';

function toAnnouncement(row: Record<string, unknown>, names: Map<string, string>): Announcement {
  const by = (row.created_by as string | null) ?? null;
  return announcementSchema.parse({
    id: row.id,
    title: row.title,
    body: row.body,
    audience: row.audience,
    status: row.status,
    pinned: row.pinned === true,
    publishedAt: (row.published_at as string | null) ?? null,
    expiresAt: (row.expires_at as string | null) ?? null,
    createdByName: by ? (names.get(by) ?? null) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

const expiredMessage = 'The expiry must be in the future to publish.';
const isPast = (iso: string | null | undefined) => !!iso && new Date(iso).valueOf() <= Date.now();

async function list(req: VercelRequest, res: VercelResponse, db: Db) {
  const auth = await authorizeAfHomes(req, 'communication.announcements', 'view');
  if ('error' in auth) return deny(res, auth);
  const { data, error } = await db
    .from('announcements')
    .select(COLUMNS)
    .order('updated_at', { ascending: false })
    .range(0, 199);
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  const names = await staffNames(
    db,
    rows.map((r) => r.created_by as string | null),
  );
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).json({ data: rows.map((r) => toAnnouncement(r, names)) });
}

async function create(req: VercelRequest, res: VercelResponse, db: Db) {
  const auth = await authorizeAfHomes(req, 'communication.announcements', 'create');
  if ('error' in auth) return deny(res, auth);
  const parsed = createAnnouncementSchema.safeParse(jsonBody(req));
  if (!parsed.success)
    return fail(
      res,
      'VALIDATION_ERROR',
      parsed.error.issues[0]?.message ?? 'Check the announcement.',
      400,
    );
  const { publish, ...input } = parsed.data;
  if (publish && isPast(input.expiresAt)) return fail(res, 'VALIDATION_ERROR', expiredMessage, 400);
  const now = new Date().toISOString();
  const inserted = await db
    .from('announcements')
    .insert({
      title: input.title,
      body: input.body,
      audience: input.audience,
      pinned: input.pinned,
      expires_at: input.expiresAt,
      status: publish ? 'published' : 'draft',
      published_at: publish ? now : null,
      created_by: auth.userId,
      updated_by: auth.userId,
    })
    .select(COLUMNS)
    .single();
  if (inserted.error) {
    if (inserted.error.code === '23514')
      return fail(
        res,
        'VALIDATION_ERROR',
        'Some details could not be accepted. Check the dates.',
        400,
      );
    throw inserted.error;
  }
  const row = inserted.data as Record<string, unknown>;
  await audit(db, auth.userId, 'ANNOUNCEMENT_CREATED', 'announcement', String(row.id), null, {
    status: row.status,
    audience: row.audience,
    title: row.title,
  });
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(201).json(toAnnouncement(row, new Map([[auth.userId, auth.fullName]])));
}

async function update(req: VercelRequest, res: VercelResponse, db: Db, id: string) {
  const auth = await authorizeAfHomes(req, 'communication.announcements', 'update');
  if ('error' in auth) return deny(res, auth);
  const parsed = updateAnnouncementSchema.safeParse(jsonBody(req));
  if (!parsed.success)
    return fail(
      res,
      'VALIDATION_ERROR',
      parsed.error.issues[0]?.message ?? 'Check the update.',
      400,
    );
  const input = parsed.data;

  const current = await db.from('announcements').select(COLUMNS).eq('id', id).maybeSingle();
  if (current.error) throw current.error;
  if (!current.data) return fail(res, 'NOT_FOUND', 'Announcement not found.', 404);
  const row = current.data as Record<string, unknown>;
  const from = row.status as AnnouncementStatus;
  const to = input.status ?? from;
  if (to !== from && !canTransitionAnnouncement(from, to))
    return fail(
      res,
      'CONFLICT',
      `A ${ANNOUNCEMENT_STATUS_LABELS[from].toLowerCase()} announcement cannot be ${ANNOUNCEMENT_STATUS_LABELS[to].toLowerCase()}.`,
      409,
    );
  const expiresAt =
    input.expiresAt !== undefined ? input.expiresAt : (row.expires_at as string | null);
  if (to === 'published' && isPast(expiresAt))
    return fail(res, 'VALIDATION_ERROR', expiredMessage, 400);

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: now, updated_by: auth.userId };
  if (input.title !== undefined) patch.title = input.title;
  if (input.body !== undefined) patch.body = input.body;
  if (input.audience !== undefined) patch.audience = input.audience;
  if (input.pinned !== undefined) patch.pinned = input.pinned;
  if (input.expiresAt !== undefined) patch.expires_at = input.expiresAt;
  if (to !== from) {
    patch.status = to;
    // (Re)publishing dates the notice now, so it sorts as new in every feed.
    if (to === 'published') patch.published_at = now;
  }
  const updated = await db
    .from('announcements')
    .update(patch)
    .eq('id', id)
    .eq('status', from)
    .select(COLUMNS)
    .maybeSingle();
  if (updated.error) {
    if (updated.error.code === '23514')
      return fail(
        res,
        'VALIDATION_ERROR',
        'Some details could not be accepted. Check the dates.',
        400,
      );
    throw updated.error;
  }
  if (!updated.data)
    return fail(
      res,
      'CONFLICT',
      'Someone else just changed this announcement. Refresh and try again.',
      409,
    );
  const after = updated.data as Record<string, unknown>;
  await audit(
    db,
    auth.userId,
    'ANNOUNCEMENT_UPDATED',
    'announcement',
    id,
    { status: from, audience: row.audience, title: row.title },
    { status: after.status, audience: after.audience, title: after.title },
  );
  const names = await staffNames(db, [after.created_by as string | null]);
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).json(toAnnouncement(after, names));
}

async function staffFeed(req: VercelRequest, res: VercelResponse, db: Db) {
  const auth = await authorizeAfHomes(req, 'dashboard.view', 'view');
  if ('error' in auth) return deny(res, auth);
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('announcements')
    .select('id, title, body, pinned, published_at, expires_at')
    .eq('status', 'published')
    .in('audience', ['staff', 'everyone'])
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order('pinned', { ascending: false })
    .order('published_at', { ascending: false })
    .range(0, 19);
  if (error) throw error;
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).json({ data: ((data ?? []) as Record<string, unknown>[]).map(feedItem) });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Announcement storage is unavailable.', 503);
  const path = subPath(req);
  const verb = method(req);
  if (path === '' && verb === 'GET') return list(req, res, db);
  if (path === '' && verb === 'POST') return create(req, res, db);
  if (path === 'feed' && verb === 'GET') return staffFeed(req, res, db);
  const match = path.match(new RegExp(`^${UUID_GROUP}$`, 'i'));
  if (match && verb === 'PATCH') return update(req, res, db, match[1]!.toLowerCase());
  return fail(res, 'NOT_FOUND', 'Route not found.', 404);
}
