import {
  conversationListQuerySchema,
  postMessageSchema,
  updateConversationSchema,
} from '@afhomes/contracts';

import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import {
  CONVERSATION_COLUMNS,
  customerSummaries,
  MESSAGE_COLUMNS,
  safeSearch,
  staffNames,
  toConversation,
  toMessage,
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
 * Staff side of member messages (migration 20270105000031).
 *
 *   GET   conversations                 communication.messages view. Default: awaiting a reply.
 *   GET   conversations/:id             communication.messages view. Thread; marks it read for staff.
 *   POST  conversations/:id/messages    communication.messages update. Reply (notifies the member).
 *   PATCH conversations/:id             communication.messages update. Close / reopen.
 *
 * Members start threads in the portal. The audit trail records THAT staff
 * replied or closed a thread, never the message text.
 */

async function list(req: VercelRequest, res: VercelResponse, db: Db) {
  const auth = await authorizeAfHomes(req, 'communication.messages', 'view');
  if ('error' in auth) return deny(res, auth);
  const parsed = conversationListQuerySchema.safeParse(req.query);
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid list query.', 400);
  const { status, search, limit, offset } = parsed.data;

  let query = db
    .from('customer_conversations')
    .select(CONVERSATION_COLUMNS, { count: 'exact' })
    .order('last_message_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (status === 'awaiting') query = query.eq('status', 'open').eq('last_sender_kind', 'customer');
  else if (status !== 'all') query = query.eq('status', status);
  const term = search ? safeSearch(search) : '';
  if (term) query = query.ilike('subject', `%${term}%`);

  const [{ data, error, count }, awaiting] = await Promise.all([
    query,
    db
      .from('customer_conversations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .eq('last_sender_kind', 'customer'),
  ]);
  if (error) throw error;
  if (awaiting.error) throw awaiting.error;
  const rows = (data ?? []) as Record<string, unknown>[];
  const customers = await customerSummaries(
    db,
    rows.map((r) => r.customer_id as string),
  );
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).json({
    data: rows.map((r) => toConversation(r, 'staff', customers)),
    meta: { total: count ?? rows.length, limit, offset, awaitingCount: awaiting.count ?? 0 },
  });
}

async function load(db: Db, id: string) {
  const { data, error } = await db
    .from('customer_conversations')
    .select(CONVERSATION_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as Record<string, unknown> | null) ?? null;
}

async function detail(req: VercelRequest, res: VercelResponse, db: Db, id: string) {
  const auth = await authorizeAfHomes(req, 'communication.messages', 'view');
  if ('error' in auth) return deny(res, auth);
  const convo = await load(db, id);
  if (!convo) return fail(res, 'NOT_FOUND', 'Conversation not found.', 404);
  const msgs = await db
    .from('customer_conversation_messages')
    .select(MESSAGE_COLUMNS)
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })
    .range(0, 499);
  if (msgs.error) throw msgs.error;
  const rows = (msgs.data ?? []) as Record<string, unknown>[];
  const [names, customers] = await Promise.all([
    staffNames(
      db,
      rows.map((m) => m.sender_staff_id as string | null),
    ),
    customerSummaries(db, [convo.customer_id as string]),
  ]);
  const readAt = new Date().toISOString();
  const marked = await db
    .from('customer_conversations')
    .update({ staff_last_read_at: readAt })
    .eq('id', id);
  if (marked.error) throw marked.error;
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).json({
    ...toConversation({ ...convo, staff_last_read_at: readAt }, 'staff', customers),
    messages: rows.map((m) => toMessage(m, names)),
  });
}

async function reply(req: VercelRequest, res: VercelResponse, db: Db, id: string) {
  const auth = await authorizeAfHomes(req, 'communication.messages', 'update');
  if ('error' in auth) return deny(res, auth);
  const parsed = postMessageSchema.safeParse(jsonBody(req));
  if (!parsed.success)
    return fail(
      res,
      'VALIDATION_ERROR',
      parsed.error.issues[0]?.message ?? 'Check the message.',
      400,
    );
  const convo = await load(db, id);
  if (!convo) return fail(res, 'NOT_FOUND', 'Conversation not found.', 404);

  const inserted = await db
    .from('customer_conversation_messages')
    .insert({
      conversation_id: id,
      client_request_id: parsed.data.requestId,
      sender_kind: 'staff',
      sender_staff_id: auth.userId,
      body: parsed.data.body,
    })
    .select(MESSAGE_COLUMNS)
    .single();
  let row = inserted.data as Record<string, unknown> | null;
  if (inserted.error) {
    // A retried send returns the reply already stored; no second notice.
    if (inserted.error.code !== '23505') throw inserted.error;
    const again = await db
      .from('customer_conversation_messages')
      .select(MESSAGE_COLUMNS)
      .eq('conversation_id', id)
      .eq('client_request_id', parsed.data.requestId)
      .single();
    if (again.error) throw again.error;
    row = again.data as Record<string, unknown>;
  } else {
    await audit(db, auth.userId, 'CONVERSATION_REPLIED', 'customer_conversation', id, null, {
      messageId: row!.id,
    });
    await notifyCustomer(db, String(convo.customer_id), {
      kind: 'message',
      title: 'AF Homes replied to your message',
      body: `New reply in "${String(convo.subject)}".`,
      link: '/customer/messages',
    });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(201).json(toMessage(row!, new Map([[auth.userId, auth.fullName]])));
}

async function setStatus(req: VercelRequest, res: VercelResponse, db: Db, id: string) {
  const auth = await authorizeAfHomes(req, 'communication.messages', 'update');
  if ('error' in auth) return deny(res, auth);
  const parsed = updateConversationSchema.safeParse(jsonBody(req));
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Send status open or closed.', 400);
  const convo = await load(db, id);
  if (!convo) return fail(res, 'NOT_FOUND', 'Conversation not found.', 404);
  let after = convo;
  if (convo.status !== parsed.data.status) {
    const closing = parsed.data.status === 'closed';
    const updated = await db
      .from('customer_conversations')
      .update({
        status: parsed.data.status,
        closed_by: closing ? auth.userId : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      // A member reply reopens a thread; never close over a change we did not see.
      .eq('status', convo.status as string)
      .select(CONVERSATION_COLUMNS)
      .maybeSingle();
    if (updated.error) throw updated.error;
    if (!updated.data)
      return fail(
        res,
        'CONFLICT',
        'This conversation changed while you were viewing it. Reload and try again.',
        409,
      );
    after = updated.data as Record<string, unknown>;
    await audit(
      db,
      auth.userId,
      closing ? 'CONVERSATION_CLOSED' : 'CONVERSATION_REOPENED',
      'customer_conversation',
      id,
      { status: convo.status },
      { status: after.status },
    );
  }
  const customers = await customerSummaries(db, [after.customer_id as string]);
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).json(toConversation(after, 'staff', customers));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Message storage is unavailable.', 503);
  const path = subPath(req);
  const verb = method(req);
  if (path === '' && verb === 'GET') return list(req, res, db);
  const thread = path.match(new RegExp(`^${UUID_GROUP}$`, 'i'));
  if (thread && verb === 'GET') return detail(req, res, db, thread[1]!.toLowerCase());
  if (thread && verb === 'PATCH') return setStatus(req, res, db, thread[1]!.toLowerCase());
  const post = path.match(new RegExp(`^${UUID_GROUP}/messages$`, 'i'));
  if (post && verb === 'POST') return reply(req, res, db, post[1]!.toLowerCase());
  return fail(res, 'NOT_FOUND', 'Route not found.', 404);
}
