import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MOCK_MEMBER } from '@jad/mock';

import { NotificationBell } from './NotificationBell';
import { renderMember } from '../test/utils';
import { mockFetchRoutes } from '../../../test/utils';

const BROADCASTS = {
  data: [
    {
      id: 'ntf-001',
      title: 'Commission cleared',
      body: 'Your commission is now available.',
      createdAt: '2026-08-16T10:00:00.000Z',
      readAt: '2026-08-17T10:00:00.000Z',
    },
    {
      id: 'ntf-002',
      title: 'New policy update',
      body: 'Please review the updated structure.',
      createdAt: '2026-08-18T10:00:00.000Z',
    },
  ],
  meta: {},
};

describe('NotificationBell', () => {
  it('renders the bell button with correct aria-label', async () => {
    mockFetchRoutes({ '/me/broadcasts': BROADCASTS });
    renderMember(<NotificationBell />, { user: MOCK_MEMBER });

    const button = await screen.findByRole('button', { name: /Notifications/ });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
  });

  it('shows unread count in aria-label', async () => {
    mockFetchRoutes({ '/me/broadcasts': BROADCASTS });
    renderMember(<NotificationBell />, { user: MOCK_MEMBER });

    const button = await screen.findByRole('button', { name: /1 unread/ });
    expect(button).toBeInTheDocument();
  });

  it('counts unread across the full feed, not just the 5 rendered', async () => {
    const user = userEvent.setup();
    const feed = {
      data: [
        ...BROADCASTS.data,
        ...Array.from({ length: 6 }, (_, i) => ({
          id: `ntf-extra-${i}`,
          title: `Extra ${i}`,
          createdAt: '2026-08-19T10:00:00.000Z',
        })),
      ],
      meta: {},
    };
    mockFetchRoutes({ '/me/broadcasts': feed });
    renderMember(<NotificationBell />, { user: MOCK_MEMBER });

    // 1 + 6 unread across the full list (only 5 render in the panel).
    const button = await screen.findByRole('button', { name: /7 unread/ });
    expect(button).toBeInTheDocument();
    await user.click(button);
    expect(screen.getByText('Extra 0')).toBeInTheDocument();
  });

  it('marks all read from the panel', async () => {
    const user = userEvent.setup();
    const fetchSpy = mockFetchRoutes({
      '/me/broadcasts': BROADCASTS,
      '/me/broadcasts/read-all': { updated: 1 },
    });
    renderMember(<NotificationBell />, { user: MOCK_MEMBER });

    await user.click(await screen.findByRole('button', { name: /Notifications/ }));
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(
      fetchSpy.mock.calls.some(([input]) => String(input).endsWith('/me/broadcasts/read-all')),
    ).toBe(true);
  });

  it('opens the notification panel on click and shows notifications', async () => {
    const user = userEvent.setup();
    mockFetchRoutes({ '/me/broadcasts': BROADCASTS });
    renderMember(<NotificationBell />, { user: MOCK_MEMBER });

    await user.click(screen.getByRole('button', { name: /Notifications/ }));
    const dialog = screen.getByRole('dialog', { name: 'Notifications' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Commission cleared')).toBeInTheDocument();
    expect(screen.getByText('New policy update')).toBeInTheDocument();
  });

  it('links each panel item to the notifications page', async () => {
    const user = userEvent.setup();
    mockFetchRoutes({ '/me/broadcasts': BROADCASTS });
    renderMember(<NotificationBell />, { user: MOCK_MEMBER });

    await user.click(screen.getByRole('button', { name: /Notifications/ }));
    const itemLink = screen.getByRole('link', { name: /New policy update \(unread\)/ });
    expect(itemLink).toHaveAttribute('href', '/member/notifications');
    await user.click(itemLink);
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).not.toBeInTheDocument();
  });

  it('shows an error with retry when the feed fails to load', async () => {
    const user = userEvent.setup();
    const fetchSpy = mockFetchRoutes({
      '/me/broadcasts': {
        body: {
          error: { code: 'INTERNAL', message: 'boom', timestamp: '2026-09-14T00:00:00Z' },
        },
        status: 500,
      },
    });
    renderMember(<NotificationBell />, { user: MOCK_MEMBER });

    await user.click(screen.getByRole('button', { name: /Notifications/ }));
    expect(await screen.findByText('Could not load notifications.')).toBeInTheDocument();
    expect(screen.queryByText('No notifications yet.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(
      fetchSpy.mock.calls.filter(([input]) => String(input).endsWith('/me/broadcasts')).length,
    ).toBeGreaterThan(1);
  });

  it('closes the panel on Escape key', async () => {
    const user = userEvent.setup();
    mockFetchRoutes({ '/me/broadcasts': BROADCASTS });
    renderMember(<NotificationBell />, { user: MOCK_MEMBER });

    await user.click(screen.getByRole('button', { name: /Notifications/ }));
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).not.toBeInTheDocument();
  });

  it('shows View all link to notifications page', async () => {
    const user = userEvent.setup();
    mockFetchRoutes({ '/me/broadcasts': BROADCASTS });
    renderMember(<NotificationBell />, { user: MOCK_MEMBER });

    await user.click(screen.getByRole('button', { name: /Notifications/ }));
    const viewAll = screen.getByText('View all');
    expect(viewAll).toHaveAttribute('href', '/member/notifications');
  });

  it('shows empty state when no notifications', async () => {
    const user = userEvent.setup();
    mockFetchRoutes({ '/me/broadcasts': { data: [], meta: {} } });
    renderMember(<NotificationBell />, { user: MOCK_MEMBER });

    await user.click(screen.getByRole('button', { name: /Notifications/ }));
    expect(screen.getByText('No notifications yet.')).toBeInTheDocument();
  });
});
