/**
 * Member engagement: notifications, bookings, announcements, member-staff
 * messages and the staff alert badge. Drives the REAL handlers, resolvers and
 * contracts on the in-memory fake. Every member route must stay scoped to the
 * session's own customer; every staff route must authorize its module.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';
import { baseTables, baseTokens, TOKEN, UUID } from '../_lib/testing/fixtures.js';
import { manilaToday } from '../_lib/engagement.js';
import { resetIdentifierRateLimit } from '../_lib/rate-limit.js';

const holder = vi.hoisted(() => ({ db: null as unknown as FakeSupabase }));
vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
  userClient: () => holder.db,
}));

const portal = (await import('./member-engagement.js')).default;
const bookings = (await import('./bookings.js')).default;
const announcements = (await import('./announcements.js')).default;
const conversations = (await import('./conversations.js')).default;
const alerts = (await import('./staff-alerts.js')).default;

const ME = 'cccccccc-0000-4000-8000-000000000001';
const OTHER = 'cccccccc-0000-4000-8000-000000000009';
const SUSPENDED = 'cccccccc-0000-4000-8000-000000000005';
const T_ME = 'tok-member';
const T_OTHER = 'tok-other-member';
const T_SUSPENDED = 'tok-suspended-member';
const SERVICE = '5e000000-0000-4000-8000-000000000001';
const HIDDEN_SERVICE = '5e000000-0000-4000-8000-000000000002';

type Row = Record<string, unknown>;
const day = (offset: number) => {
  const d = new Date(`${manilaToday()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const uuid = (n: number) => `9b2f4c1e-7a3d-4e5f-9a1b-${String(n).padStart(12, '0')}`;

const customer = (id: string, n: string, auth: string, status = 'active'): Row => ({
  id,
  customer_number: n,
  first_name: 'ANA',
  middle_name: null,
  last_name: n,
  email: `${n.toLowerCase()}@example.invalid`,
  status,
  auth_user_id: auth,
});

let seq = 0;
function setup() {
  seq = 0;
  const db = new FakeSupabase({
    tables: baseTables({
      customers: [
        customer(ME, 'CUS-1', 'auth-me'),
        customer(OTHER, 'CUS-2', 'auth-other'),
        customer(SUSPENDED, 'CUS-3', 'auth-susp', 'suspended'),
      ],
      service_catalog: [
        {
          id: SERVICE,
          name: 'Signature Suite',
          description: 'A room',
          base_price: '12000.00',
          details: { pricingUnit: 'night' },
          is_active: true,
          published: true,
          availability: 'available',
        },
        {
          id: HIDDEN_SERVICE,
          name: 'Unpublished Spa',
          description: null,
          base_price: '0.00',
          details: {},
          is_active: true,
          published: false,
          availability: 'available',
        },
      ],
      service_bookings: [],
      customer_notifications: [],
      announcements: [],
      customer_conversations: [],
      customer_conversation_messages: [],
      website_inquiries: [],
      audit_events: [],
    }),
    tokens: {
      ...baseTokens(),
      [T_ME]: { id: 'auth-me', email: 'cus-1@example.invalid' },
      [T_OTHER]: { id: 'auth-other', email: 'cus-2@example.invalid' },
      [T_SUSPENDED]: { id: 'auth-susp', email: 'cus-3@example.invalid' },
    },
    unique: {
      service_bookings: [['customer_id', 'client_request_id']],
      customer_conversations: [['customer_id', 'client_request_id']],
      customer_conversation_messages: [['conversation_id', 'client_request_id']],
    },
    defaults: {
      service_bookings: {
        status: 'requested',
        response_note: '',
        cancelled_by: null,
        decided_by: null,
        decided_at: null,
      },
      customer_notifications: { read_at: null, email_status: 'not_requested' },
      announcements: { pinned: false, expires_at: null },
      customer_conversations: {
        status: 'open',
        last_sender_kind: 'customer',
        customer_last_read_at: null,
        staff_last_read_at: null,
        closed_by: null,
      },
      customer_conversation_messages: { sender_staff_id: null },
    },
  });
  // Mirror what Postgres does for us: generated references, timestamps, and
  // the message trigger that keeps the thread summary in step.
  const from = db.from.bind(db);
  db.from = ((table: string) => {
    const q = from(table);
    const original = q.insert.bind(q);
    q.insert = (row: Row) => {
      seq += 1;
      // Strictly increasing and never in the future (a later read must follow it).
      const now = new Date(Date.now() - 60_000 + seq).toISOString();
      const extra: Row = { created_at: now, updated_at: now };
      if (table === 'service_bookings') extra.reference = `BKG-${String(seq).padStart(6, '0')}`;
      if (table === 'customer_conversations') extra.last_message_at = now;
      if (table === 'customer_conversation_messages') {
        const convo = db.tables.customer_conversations!.find((c) => c.id === row.conversation_id);
        const dup = db.tables.customer_conversation_messages!.some(
          (m) =>
            m.conversation_id === row.conversation_id &&
            m.client_request_id === row.client_request_id,
        );
        if (convo && !dup) {
          convo.last_message_at = now;
          convo.last_sender_kind = row.sender_kind;
          if (row.sender_kind === 'customer') {
            convo.status = 'open';
            convo.customer_last_read_at = now;
          } else convo.staff_last_read_at = now;
        }
      }
      return original({ ...extra, ...row });
    };
    return q;
  }) as typeof db.from;
  holder.db = db;
  return db;
}

const call = async (h: typeof portal, opts: Parameters<typeof makeReq>[0]) => {
  const res = makeRes();
  await h(makeReq({ familyPath: '', ...opts }) as never, res.res as never);
  return res.state as { status: number; body: any };
};
const asMember = (opts: Parameters<typeof makeReq>[0], token = T_ME) =>
  call(portal, { token, ...opts });

const book = (over: Row = {}, token = T_ME) =>
  asMember(
    {
      method: 'POST',
      familyPath: 'bookings',
      body: {
        requestId: uuid(1),
        serviceId: SERVICE,
        startDate: day(3),
        endDate: day(4),
        guests: 2,
        ...over,
      },
    },
    token,
  );

beforeEach(() => {
  resetIdentifierRateLimit();
  setup();
});

/* ------------------------------------------------------------------ */

describe('member portal: access', () => {
  it('requires a customer session and refuses a staff session', async () => {
    expect((await call(portal, { familyPath: 'notifications' })).status).toBe(401);
    expect((await call(portal, { familyPath: 'notifications', token: TOKEN.admin })).status).toBe(
      403,
    );
  });
});

describe('member portal: bookings', () => {
  it('lists only published, active, available services', async () => {
    const r = await asMember({ familyPath: 'services' });
    expect(r.status).toBe(200);
    expect(r.body.data.map((s: Row) => s.name)).toEqual(['Signature Suite']);
    expect(r.body.data[0]).toMatchObject({ pricingUnit: 'night', basePrice: '12000.00' });
  });

  it('creates a request with a name snapshot and alerts nobody when mail is off', async () => {
    const r = await book();
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      reference: 'BKG-000001',
      status: 'requested',
      serviceName: 'Signature Suite',
      customerId: null,
    });
    expect(holder.db.tables.service_bookings![0]).toMatchObject({
      customer_id: ME,
      service_name_snapshot: 'Signature Suite',
    });
  });

  it('returns the same booking for a retried request and stores one row', async () => {
    await book();
    const retry = await book();
    expect(retry.status).toBe(200);
    expect(retry.body.reference).toBe('BKG-000001');
    expect(holder.db.tables.service_bookings).toHaveLength(1);
  });

  it("never reveals another member's booking through a reused requestId", async () => {
    await book();
    const other = await book({}, T_OTHER);
    expect(other.status).toBe(201);
    expect(other.body.reference).not.toBe('BKG-000001');
    expect(holder.db.tables.service_bookings).toHaveLength(2);
  });

  it('refuses past dates, unpublished services, bad dates and suspended members', async () => {
    expect((await book({ startDate: day(-1), endDate: undefined })).status).toBe(400);
    expect((await book({ requestId: uuid(2), serviceId: HIDDEN_SERVICE })).status).toBe(400);
    expect((await book({ requestId: uuid(3), startDate: day(5), endDate: day(4) })).status).toBe(
      400,
    );
    expect(
      (await book({ requestId: uuid(4), startDate: '2027-02-30', endDate: undefined })).status,
    ).toBe(400);
    expect((await book({ requestId: uuid(5) }, T_SUSPENDED)).status).toBe(403);
    // More than two years ahead.
    expect((await book({ requestId: uuid(6), startDate: day(800), endDate: undefined })).status).toBe(
      400,
    );
    expect(holder.db.tables.service_bookings).toHaveLength(0);
  });

  it('caps open bookings per member, but a retry of an existing request still succeeds', async () => {
    const first = await book();
    for (let i = 0; i < 9; i += 1)
      holder.db.tables.service_bookings!.push({
        ...holder.db.tables.service_bookings![0]!,
        id: uuid(500 + i),
        reference: `BKG-9${i}`,
        client_request_id: uuid(600 + i),
      });
    const capped = await book({ requestId: uuid(7) });
    expect(capped.status).toBe(409);
    expect(capped.body.error.message).toContain('10 open bookings');
    expect((await book()).body.reference).toBe(first.body.reference);
    // Another member is unaffected.
    expect((await book({ requestId: uuid(8) }, T_OTHER)).status).toBe(201);
  });

  it("lists and cancels only the member's own bookings", async () => {
    const mine = (await book()).body;
    await book({ requestId: uuid(9) }, T_OTHER);
    const list = await asMember({ familyPath: 'bookings' });
    expect(list.body.data).toHaveLength(1);
    const theirs = holder.db.tables.service_bookings!.find((b) => b.customer_id === OTHER)!;
    expect(
      (await asMember({ method: 'POST', familyPath: `bookings/${theirs.id}/cancel` })).status,
    ).toBe(404);
    const cancelled = await asMember({ method: 'POST', familyPath: `bookings/${mine.id}/cancel` });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ status: 'cancelled', cancelledBy: 'customer' });
  });
});

describe('staff bookings', () => {
  it('requires operations.bookings', async () => {
    expect((await call(bookings, {})).status).toBe(401);
    expect((await call(bookings, { token: TOKEN.viewer })).status).toBe(403);
  });

  it('confirms a request, audits it and notifies the member', async () => {
    const b = (await book()).body;
    const list = await call(bookings, { token: TOKEN.admin });
    expect(list.body.data[0]).toMatchObject({ customerName: 'ANA CUS-1', customerNumber: 'CUS-1' });
    expect(list.body.meta.requestedCount).toBe(1);
    const r = await call(bookings, {
      method: 'PATCH',
      familyPath: b.id,
      token: TOKEN.admin,
      body: { status: 'confirmed', note: 'See you at 2pm.' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      status: 'confirmed',
      responseNote: 'See you at 2pm.',
      decidedByName: expect.any(String),
    });
    expect(
      holder.db.tables.audit_events!.find((a) => a.action === 'BOOKING_UPDATED'),
    ).toMatchObject({
      actor_id: UUID.adminStaff,
      entity_id: b.id,
    });
    const notice = holder.db.tables.customer_notifications!.find((n) => n.customer_id === ME)!;
    expect(notice).toMatchObject({
      kind: 'booking',
      link: '/customer/bookings',
      email_status: 'not_requested',
    });
    expect(String(notice.title)).toContain('confirmed');
  });

  it('refuses illegal moves and completing before the date; repeating is a no-op', async () => {
    const b = (await book()).body;
    const patch = (status: string) =>
      call(bookings, { method: 'PATCH', familyPath: b.id, token: TOKEN.admin, body: { status } });
    expect((await patch('completed')).status).toBe(409);
    expect((await patch('confirmed')).status).toBe(200);
    expect((await patch('confirmed')).status).toBe(200);
    expect(
      holder.db.tables.audit_events!.filter((a) => a.action === 'BOOKING_UPDATED'),
    ).toHaveLength(1);
    expect((await patch('completed')).status).toBe(409);
    expect((await patch('declined')).status).toBe(409);
  });
});

describe('notifications', () => {
  it("lists the member's own notices and marks only their own read", async () => {
    holder.db.tables.customer_notifications!.push(
      {
        id: uuid(101),
        customer_id: ME,
        kind: 'account',
        title: 'Mine',
        body: '',
        link: null,
        read_at: null,
        created_at: '2026-11-20T00:00:00Z',
      },
      {
        id: uuid(102),
        customer_id: OTHER,
        kind: 'account',
        title: 'Theirs',
        body: '',
        link: null,
        read_at: null,
        created_at: '2026-11-20T00:00:00Z',
      },
    );
    const list = await asMember({ familyPath: 'notifications' });
    expect(list.body.data.map((n: Row) => n.title)).toEqual(['Mine']);
    expect(list.body.meta.unreadCount).toBe(1);
    // Naming another member's id changes nothing for them.
    await asMember({
      method: 'POST',
      familyPath: 'notifications/read',
      body: { ids: [uuid(102)] },
    });
    expect(
      holder.db.tables.customer_notifications!.find((n) => n.id === uuid(102))!.read_at,
    ).toBeNull();
    await asMember({ method: 'POST', familyPath: 'notifications/read', body: { all: true } });
    expect(
      holder.db.tables.customer_notifications!.find((n) => n.id === uuid(101))!.read_at,
    ).not.toBeNull();
    expect(
      (await asMember({ method: 'POST', familyPath: 'notifications/read', body: {} })).status,
    ).toBe(400);
  });
});

describe('announcements', () => {
  const create = (body: Row, token: string = TOKEN.admin) =>
    call(announcements, { method: 'POST', token, body: { body: 'Pool closed Monday.', ...body } });

  it('requires communication.announcements to manage', async () => {
    expect((await create({ title: 'Pool', audience: 'customers' }, TOKEN.viewer)).status).toBe(403);
  });

  it('shows members only published, unexpired member notices; staff only staff notices', async () => {
    await create({ title: 'For members', audience: 'customers', publish: true });
    await create({ title: 'For staff', audience: 'staff', publish: true });
    await create({ title: 'For all', audience: 'everyone', publish: true, pinned: true });
    await create({ title: 'Draft one', audience: 'customers' });
    holder.db.tables.announcements!.push({
      id: uuid(201),
      title: 'Old',
      body: 'x',
      audience: 'customers',
      status: 'published',
      pinned: false,
      published_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-01-02T00:00:00Z',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });
    const member = await asMember({ familyPath: 'announcements' });
    expect(member.body.data.map((a: Row) => a.title)).toEqual(['For all', 'For members']);
    const staff = await call(announcements, { familyPath: 'feed', token: TOKEN.viewer });
    expect(staff.body.data.map((a: Row) => a.title).sort()).toEqual(['For all', 'For staff']);
  });

  it('publishes, archives, refuses illegal moves and past expiries, and audits', async () => {
    const draft = (await create({ title: 'Holiday hours', audience: 'everyone' })).body;
    expect(draft.status).toBe('draft');
    expect(
      (
        await create({
          title: 'Expired',
          audience: 'staff',
          publish: true,
          expiresAt: '2020-01-01T00:00:00Z',
        })
      ).status,
    ).toBe(400);
    const patch = (body: Row) =>
      call(announcements, { method: 'PATCH', familyPath: draft.id, token: TOKEN.admin, body });
    const published = await patch({ status: 'published' });
    expect(published.body).toMatchObject({ status: 'published', publishedAt: expect.any(String) });
    expect((await patch({ status: 'draft' })).status).toBe(409);
    expect((await patch({ status: 'archived' })).body.status).toBe('archived');
    expect(
      holder.db.tables.audit_events!.filter((a) => String(a.action).startsWith('ANNOUNCEMENT_')),
    ).toHaveLength(3);
  });
});

describe('messages', () => {
  const start = (token = T_ME, requestId = uuid(301)) =>
    asMember(
      {
        method: 'POST',
        familyPath: 'conversations',
        body: { requestId, subject: 'Room question', body: 'Is breakfast included?' },
      },
      token,
    );

  it('starts a thread idempotently and keeps it private to the member', async () => {
    const first = await start();
    expect(first.status).toBe(201);
    const again = await start();
    expect(again.status).toBe(200);
    expect(holder.db.tables.customer_conversations).toHaveLength(1);
    expect(holder.db.tables.customer_conversation_messages).toHaveLength(1);
    expect((await asMember({ familyPath: `conversations/${first.body.id}` }, T_OTHER)).status).toBe(
      404,
    );
    expect(
      (
        await asMember(
          {
            method: 'POST',
            familyPath: `conversations/${first.body.id}/messages`,
            body: { requestId: uuid(9), body: 'hi' },
          },
          T_OTHER,
        )
      ).status,
    ).toBe(404);
  });

  it('lets a suspended member message staff', async () => {
    expect((await start(T_SUSPENDED)).status).toBe(201);
  });

  it('staff see it awaiting, reply (member notified, audit without text) and close', async () => {
    const convo = (await start()).body;
    expect((await call(conversations, { token: TOKEN.viewer })).status).toBe(403);
    const inbox = await call(conversations, { token: TOKEN.admin });
    expect(inbox.body.data).toHaveLength(1);
    expect(inbox.body.data[0]).toMatchObject({ unread: true, customerNumber: 'CUS-1' });
    const r = await call(conversations, {
      method: 'POST',
      familyPath: `${convo.id}/messages`,
      token: TOKEN.admin,
      body: { requestId: uuid(302), body: 'Yes, breakfast for two is included.' },
    });
    expect(r.status).toBe(201);
    expect(r.body.senderKind).toBe('staff');
    // A retried send stores and notifies once.
    await call(conversations, {
      method: 'POST',
      familyPath: `${convo.id}/messages`,
      token: TOKEN.admin,
      body: { requestId: uuid(302), body: 'Yes, breakfast for two is included.' },
    });
    expect(holder.db.tables.customer_conversation_messages).toHaveLength(2);
    expect(
      holder.db.tables.customer_notifications!.filter((n) => n.kind === 'message'),
    ).toHaveLength(1);
    const auditRow = holder.db.tables.audit_events!.find(
      (a) => a.action === 'CONVERSATION_REPLIED',
    )!;
    expect(JSON.stringify(auditRow)).not.toContain('breakfast');
    expect((await call(conversations, { token: TOKEN.admin })).body.data).toHaveLength(0);

    const member = await asMember({ familyPath: 'conversations' });
    expect(member.body.data[0]).toMatchObject({ unread: true, lastSenderKind: 'staff' });
    const thread = await asMember({ familyPath: `conversations/${convo.id}` });
    expect(thread.body.messages.map((m: Row) => m.senderKind)).toEqual(['customer', 'staff']);
    // Members never see an individual staff name.
    expect(thread.body.messages[1].senderName).toBe('AF Homes');
    expect(thread.body.unread).toBe(false);

    const closed = await call(conversations, {
      method: 'PATCH',
      familyPath: convo.id,
      token: TOKEN.admin,
      body: { status: 'closed' },
    });
    expect(closed.body.status).toBe('closed');
  });

  it('caps open threads per member', async () => {
    for (let i = 0; i < 10; i += 1) expect((await start(T_ME, uuid(700 + i))).status).toBe(201);
    const capped = await start(T_ME, uuid(720));
    expect(capped.status).toBe(409);
    expect(capped.body.error.message).toContain('10 open conversations');
    expect((await start(T_ME, uuid(700))).status).toBe(200);
  });

  it('refuses to close a thread that changed after staff loaded it', async () => {
    const convo = (await start()).body;
    const db = holder.db;
    const original = db.from.bind(db);
    let convoReads = 0;
    db.from = ((table: string) => {
      // The member closes-and-reopens race, simulated: after staff load the
      // thread, another writer closes it first.
      if (table === 'customer_conversations' && ++convoReads === 2)
        db.tables.customer_conversations!.find((c) => c.id === convo.id)!.status = 'closed';
      return original(table);
    }) as typeof db.from;
    const r = await call(conversations, {
      method: 'PATCH',
      familyPath: convo.id,
      token: TOKEN.admin,
      body: { status: 'closed' },
    });
    expect(r.status).toBe(409);
    expect(db.tables.audit_events!.some((a) => a.action === 'CONVERSATION_CLOSED')).toBe(false);
  });
});

describe('staff alerts', () => {
  it('counts only modules the caller can view', async () => {
    await book();
    const admin = await call(alerts, { token: TOKEN.admin });
    expect(admin.status).toBe(200);
    expect(admin.body).toEqual({ newInquiries: 0, requestedBookings: 1, awaitingReply: 0 });
    const viewer = await call(alerts, { token: TOKEN.viewer });
    expect(viewer.body).toEqual({
      newInquiries: null,
      requestedBookings: null,
      awaitingReply: null,
    });
    expect((await call(alerts, {})).status).toBe(401);
  });
});
