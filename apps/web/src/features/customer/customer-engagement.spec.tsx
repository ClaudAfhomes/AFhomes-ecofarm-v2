/**
 * Member engagement screens (notifications, bookings, messages, announcements),
 * rendered through the real routes with only the network stubbed.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';
import App from '../../app/App';
import { resetSupabaseClientForTest } from '../../lib/supabase';

const ID = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;

const CUSTOMER = {
  id: ID(1),
  customerNumber: 'CUS-000777',
  firstName: 'Ana',
  middleName: null,
  lastName: 'Buyer',
  suffix: null,
  fullName: 'Ana Buyer',
  email: 'ana.buyer@example.invalid',
  phone: '09185550000',
  dateOfBirth: '1990-05-04',
  addressLine1: '77 Katipunan',
  addressLine2: null,
  city: 'Quezon City',
  province: 'Metro Manila',
  countryCode: 'PH',
  status: 'active' as const,
  activatedAt: '2026-01-05T02:00:00.000Z',
  updatedAt: '2026-01-05T02:00:00.000Z',
};

const SERVICE = {
  id: ID(10),
  name: 'Villa Stay',
  description: null,
  pricingUnit: 'night',
  basePrice: '12000.00',
};

const booking = (over: Record<string, unknown> = {}) => ({
  id: ID(20),
  reference: 'BKG-1',
  serviceId: SERVICE.id,
  serviceName: 'Villa Stay',
  startDate: '2999-01-01',
  endDate: null,
  guests: 2,
  customerNotes: '',
  status: 'requested',
  responseNote: '',
  cancelledBy: null,
  decidedAt: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  customerId: null,
  customerName: null,
  customerNumber: null,
  decidedByName: null,
  ...over,
});

type Handler = (init?: RequestInit) => { status: number; body: unknown };
const routes = new Map<string, Handler>();
const calls: { path: string; method: string; body: unknown }[] = [];
const ok =
  (body: unknown, status = 200): Handler =>
  () => ({ status, body });
const list = (data: unknown[], meta: Record<string, unknown> = {}) => ok({ data, meta });

function install(over: Record<string, Handler> = {}) {
  routes.clear();
  routes.set('/auth/portals', ok({ staff: null, customer: { status: 'active' }, ost: null }));
  routes.set('/customer', ok(CUSTOMER));
  routes.set(
    '/profile-photo/customer',
    ok({ url: null, expiresAt: null, canUpload: true, notice: null }),
  );
  routes.set('/customer/membership', ok({}, 404));
  routes.set('/customer/points', ok({}, 404));
  routes.set('/customer/points/position', ok({}, 404));
  routes.set('/customer/points/ledger', list([]));
  routes.set('/portal/notifications', list([], { unreadCount: 0 }));
  routes.set('/portal/announcements', list([]));
  for (const [p, h] of Object.entries(over)) routes.set(p, h);
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  resetSupabaseClientForTest();
  calls.length = 0;
  install();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/^\/api\/v1/, '')
        .split('?')[0]!;
      calls.push({
        path,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const handler = routes.get(path);
      const { status, body } = handler
        ? handler(init)
        : { status: 404, body: { error: { code: 'NOT_FOUND', message: `unstubbed ${path}` } } };
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});

// The full App lazy-loads each route; under a parallel run the first paint can
// exceed Testing Library's 1s default, so the first query after a render waits longer.
const FIRST_PAINT = { timeout: 5000 };

const render = (route: string) =>
  renderWithProviders(<App />, {
    route,
    sessionUser: { authUserId: ID(99), email: CUSTOMER.email },
  });

describe('notifications bell', () => {
  it('shows the unread count and marks everything read', async () => {
    const notice = {
      id: ID(30),
      kind: 'booking',
      title: 'Booking confirmed',
      body: 'See you soon.',
      link: '/customer/bookings',
      readAt: null,
      createdAt: '2026-11-20T01:00:00.000Z',
    };
    install({
      '/portal/notifications': list([notice], { unreadCount: 3 }),
      '/portal/notifications/read': ok({ ok: true }),
    });
    render('/customer/notifications');
    expect(
      await screen.findByLabelText('Notifications, 3 unread', undefined, FIRST_PAINT),
    ).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all as read' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/portal/notifications/read')?.body).toEqual({
        all: true,
      }),
    );
  });

  it('marks a notice read when opened and follows its link', async () => {
    install({
      '/portal/notifications': list(
        [
          {
            id: ID(30),
            kind: 'booking',
            title: 'Booking confirmed',
            body: 'x',
            link: '/customer/bookings',
            readAt: null,
            createdAt: '2026-11-20T01:00:00.000Z',
          },
        ],
        { unreadCount: 1 },
      ),
      '/portal/notifications/read': ok({ ok: true }),
      '/portal/services': list([]),
      '/portal/bookings': list([]),
    });
    render('/customer/notifications');
    await userEvent.click(
      await screen.findByRole('button', { name: /Booking confirmed/ }, FIRST_PAINT),
    );
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/portal/notifications/read')?.body).toEqual({
        ids: [ID(30)],
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Book a service' })).toBeInTheDocument();
  });
});

describe('notifications page', () => {
  const notice = (over: Record<string, unknown> = {}) => ({
    id: ID(31),
    kind: 'booking',
    title: 'Booking confirmed',
    body: 'See you soon.',
    link: null,
    readAt: null,
    createdAt: '2026-11-20T01:00:00.000Z',
    ...over,
  });

  it('has exactly one h1 and tells unread from read with text', async () => {
    install({
      '/portal/notifications': list(
        [notice(), notice({ id: ID(32), title: 'Welcome', readAt: '2026-11-19T01:00:00.000Z' })],
        { unreadCount: 1 },
      ),
    });
    render('/customer/notifications');
    await screen.findByRole('button', { name: /Booking confirmed/ }, FIRST_PAINT);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Notifications');
    // Unread is a text label tied to the row's button, not colour alone.
    expect(screen.getByRole('button', { name: /Booking confirmed/ })).toHaveAccessibleDescription(
      'Unread',
    );
    expect(screen.getAllByText('Unread')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Welcome' })).not.toHaveAccessibleDescription();
  });

  it('explains the empty state and disables Mark all as read', async () => {
    render('/customer/notifications');
    expect(await screen.findByText('No notifications', undefined, FIRST_PAINT)).toBeInTheDocument();
    expect(screen.getByText(/inside the portal/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('keeps one h1 when the list cannot load', async () => {
    install({
      '/portal/notifications': ok({ error: { code: 'INTERNAL', message: 'boom' } }, 500),
    });
    render('/customer/notifications');
    expect(
      await screen.findByText('Notifications unavailable', undefined, FIRST_PAINT),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});

describe('bookings', () => {
  it('shows status as text, the date range, guests and the staff response', async () => {
    install({
      '/portal/services': list([SERVICE]),
      '/portal/bookings': list([
        booking({
          id: ID(24),
          reference: 'BKG-OK',
          status: 'confirmed',
          startDate: '2999-01-01',
          endDate: '2999-01-03',
          guests: 1,
          responseNote: 'Welcome aboard.',
        }),
        booking({ id: ID(25), reference: 'BKG-NO', status: 'declined', responseNote: '' }),
      ]),
    });
    render('/customer/bookings');
    await screen.findByText(/BKG-OK/, undefined, FIRST_PAINT);
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByText('Declined')).toBeInTheDocument();
    expect(screen.getByText(/to .*2999/)).toBeInTheDocument();
    expect(screen.getByText('1 guest')).toBeInTheDocument();
    expect(screen.getByText('Welcome aboard.')).toBeInTheDocument();
  });

  it('flags an end date before the start date on the field and blocks the request', async () => {
    install({ '/portal/services': list([SERVICE]), '/portal/bookings': list([]) });
    render('/customer/bookings');
    await screen.findByText(/per night/, undefined, FIRST_PAINT);
    await userEvent.type(screen.getByLabelText('Start date'), '2999-02-01');
    await userEvent.type(screen.getByLabelText(/End date/), '2999-01-01');
    const end = screen.getByLabelText(/End date/);
    expect(end).toBeInvalid();
    expect(end).toHaveAccessibleDescription('The end date cannot be before the start date.');
    expect(screen.getByRole('button', { name: 'Request booking' })).toBeDisabled();
  });

  it('submits the right body, prefilled for a single service', async () => {
    install({
      '/portal/services': list([SERVICE]),
      '/portal/bookings': (init) =>
        init?.method === 'POST'
          ? { status: 201, body: booking() }
          : { status: 200, body: { data: [], meta: {} } },
    });
    render('/customer/bookings');
    expect(
      await screen.findByText(/₱12,000\.00 per night/, undefined, FIRST_PAINT),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request booking' })).toBeDisabled();
    expect(screen.getByText(/AF Homes will confirm your request/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Start date'), '2999-01-01');
    await userEvent.click(screen.getByRole('button', { name: 'Request booking' }));
    await waitFor(() => {
      const post = calls.find((c) => c.path === '/portal/bookings' && c.method === 'POST');
      expect(post?.body).toMatchObject({
        serviceId: SERVICE.id,
        startDate: '2999-01-01',
        guests: 1,
        notes: '',
      });
      expect((post?.body as { requestId: string }).requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(post?.body).not.toHaveProperty('endDate');
    });
  });

  it('shows the server error', async () => {
    install({
      '/portal/services': list([SERVICE]),
      '/portal/bookings': (init) =>
        init?.method === 'POST'
          ? {
              status: 403,
              body: {
                error: {
                  code: 'FORBIDDEN',
                  message: 'Bookings are available to active members only.',
                },
              },
            }
          : { status: 200, body: { data: [], meta: {} } },
    });
    render('/customer/bookings');
    await screen.findByText(/per night/, undefined, FIRST_PAINT);
    await userEvent.type(screen.getByLabelText('Start date'), '2999-01-01');
    await userEvent.click(screen.getByRole('button', { name: 'Request booking' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Bookings are available to active members only.',
    );
  });

  it('offers Cancel only for live, upcoming bookings', async () => {
    install({
      '/portal/services': list([SERVICE]),
      '/portal/bookings': list([
        booking({ id: ID(21), reference: 'BKG-UP', status: 'confirmed' }),
        booking({ id: ID(22), reference: 'BKG-DONE', status: 'completed' }),
        booking({ id: ID(23), reference: 'BKG-PAST', startDate: '2020-01-01' }),
      ]),
    });
    render('/customer/bookings');
    await screen.findByText(/BKG-UP/, undefined, FIRST_PAINT);
    expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(1);
  });
});

describe('messages', () => {
  it('sends a reply in a thread', async () => {
    const convo = {
      id: ID(40),
      subject: 'Question',
      status: 'open',
      lastMessageAt: '2026-11-20T01:00:00.000Z',
      lastSenderKind: 'staff',
      unread: true,
      createdAt: '2026-11-19T01:00:00.000Z',
      customerId: null,
      customerName: null,
      customerNumber: null,
    };
    install({
      '/portal/conversations': list([convo]),
      [`/portal/conversations/${ID(40)}`]: ok({
        ...convo,
        messages: [
          {
            id: ID(41),
            senderKind: 'staff',
            senderName: 'Mia Staff',
            body: 'How can we help?',
            createdAt: '2026-11-20T01:00:00.000Z',
          },
        ],
      }),
      [`/portal/conversations/${ID(40)}/messages`]: ok({
        id: ID(42),
        senderKind: 'customer',
        senderName: null,
        body: 'Thanks',
        createdAt: '2026-11-20T02:00:00.000Z',
      }),
    });
    render('/customer/messages');
    expect(
      await screen.findByText('New reply from AF Homes', undefined, FIRST_PAINT),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Question' }));
    expect(await screen.findByText(/Mia Staff/)).toBeInTheDocument();
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Reply'), 'Thanks');
    await userEvent.click(send);
    await waitFor(() =>
      expect(calls.find((c) => c.path.endsWith('/messages'))?.body).toMatchObject({
        body: 'Thanks',
      }),
    );
  });

  it('names the sender of every message in text and lists them in order', async () => {
    const convo = {
      id: ID(43),
      subject: 'Stay question',
      status: 'open',
      lastMessageAt: '2026-11-20T03:00:00.000Z',
      lastSenderKind: 'customer',
      unread: false,
      createdAt: '2026-11-19T01:00:00.000Z',
      customerId: null,
      customerName: null,
      customerNumber: null,
    };
    const msg = (n: number, kind: string, name: string | null, body: string) => ({
      id: ID(n),
      senderKind: kind,
      senderName: name,
      body,
      createdAt: `2026-11-20T0${n - 44}:00:00.000Z`,
    });
    install({
      '/portal/conversations': list([convo]),
      [`/portal/conversations/${ID(43)}`]: ok({
        ...convo,
        messages: [
          msg(44, 'customer', null, 'Is the villa free?'),
          msg(45, 'staff', 'Mia Staff', 'Yes it is.'),
        ],
      }),
    });
    render('/customer/messages');
    const open = await screen.findByRole('button', { name: 'Stay question' }, FIRST_PAINT);
    // Read thread: no unread label.
    expect(screen.queryByText('New reply from AF Homes')).not.toBeInTheDocument();
    await userEvent.click(open);
    const items = within(await screen.findByRole('list', { name: 'Conversation' })).getAllByRole(
      'listitem',
    );
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText('You')).toBeInTheDocument();
    expect(within(items[0]!).getByText('Is the villa free?')).toBeInTheDocument();
    expect(within(items[1]!).getByText('Mia Staff')).toBeInTheDocument();
    expect(within(items[1]!).getByText('AF Homes staff')).toBeInTheDocument();
    expect(screen.getByLabelText('Reply')).toBeInTheDocument();
  });
});

describe('dashboard announcements', () => {
  it('hides the card when there are none', async () => {
    render('/customer');
    await screen.findByRole('heading', { name: 'Dashboard', level: 1 }, FIRST_PAINT);
    await waitFor(() => expect(calls.some((c) => c.path === '/portal/announcements')).toBe(true));
    expect(screen.queryByRole('heading', { name: 'Announcements' })).not.toBeInTheDocument();
  });

  it('lists announcements when present', async () => {
    install({
      '/portal/announcements': list([
        {
          id: ID(50),
          title: 'Holiday hours',
          body: 'Closed Dec 25.',
          pinned: true,
          publishedAt: '2026-11-01T00:00:00.000Z',
          expiresAt: null,
        },
      ]),
    });
    render('/customer');
    expect(
      await screen.findByRole('heading', { name: 'Announcements' }, FIRST_PAINT),
    ).toBeInTheDocument();
    expect(screen.getByText(/Holiday hours/)).toBeInTheDocument();
  });
});
