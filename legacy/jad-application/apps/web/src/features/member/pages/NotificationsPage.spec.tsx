import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MOCK_MEMBER, setMockSessionUser } from '@jad/mock';
import { createMemberMockServer } from '../../../mock';

import { NotificationsPage } from './NotificationsPage';
import { renderMember } from '../test/utils';
import { mockFetchRoutes } from '../../../test/utils';

describe('member NotificationsPage', () => {
  let server: ReturnType<typeof createMemberMockServer>;

  beforeEach(() => {
    server = createMemberMockServer();
    server.install();
    setMockSessionUser(MOCK_MEMBER);
  });

  afterEach(() => {
    server.restore();
    setMockSessionUser(null);
  });

  it('renders the notification feed with filters and read state (SCR-MEM-024)', async () => {
    renderMember(<NotificationsPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('Welcome to JA&D')).toBeInTheDocument();
    expect(screen.getByText('Commission cleared')).toBeInTheDocument();
    expect(screen.getByText('New: Join the JA&D Community')).toBeInTheDocument();

    // Timeframe + header ring (trail is owned by MemberLayout)
    expect(screen.getAllByText('Notifications').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Latest first/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View Marketing Tools' })).toHaveAttribute(
      'href',
      '/member/marketing-tools',
    );

    // Filters + count (5 member rows + 2 broadcasts); mark-all lives in the header
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Showing 7 of 7 notifications/)).toBeInTheDocument();
    expect(screen.getAllByText('Read').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Unread').length).toBeGreaterThanOrEqual(2);
    // Unread cards carry the accent class; read cards do not
    const unreadCard = screen.getByText('Commission cleared').closest('li')!;
    expect(unreadCard.className).toMatch(/cardUnread/);
    const readCard = screen.getByText('Welcome to JA&D').closest('li')!;
    expect(readCard.className).not.toMatch(/cardUnread/);
  });

  it('filters by read/unread and resets', async () => {
    const user = userEvent.setup();
    renderMember(<NotificationsPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('Welcome to JA&D')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Unread' }));
    expect(screen.getByRole('button', { name: 'Unread' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Showing 6 of 7 notifications · Unread/)).toBeInTheDocument();
    expect(screen.queryByText('Welcome to JA&D')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Read' }));
    expect(screen.getByText(/Showing 1 of 7 notifications · Read/)).toBeInTheDocument();
    expect(screen.getByText('Welcome to JA&D')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText(/Showing 7 of 7 notifications/)).toBeInTheDocument();
  });

  it('opens the viewer dialog from the card title button', async () => {
    const user = userEvent.setup();
    renderMember(<NotificationsPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('Welcome to JA&D')).toBeInTheDocument();
    // No separate View buttons - the card title itself opens the viewer
    expect(screen.queryByRole('button', { name: 'View' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Welcome to JA&D/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Your membership is now Active \+ Qualified/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('marks a notification read when its Viewer opens', async () => {
    const user = userEvent.setup();
    renderMember(<NotificationsPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('Commission cleared')).toBeInTheDocument();
    expect(screen.getByText(/Showing 7 of 7 notifications/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View notification: Commission cleared' }));
    await screen.findByRole('dialog');
    // Auto mark-read drops the unread total by one (6 → 5).
    await user.click(screen.getByRole('button', { name: 'Unread' }));
    expect(await screen.findByText(/Showing 5 of 7 notifications · Unread/)).toBeInTheDocument();
  });

  it('marks all notifications read', async () => {
    const user = userEvent.setup();
    renderMember(<NotificationsPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('Welcome to JA&D')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark all as read' }));
    // Refetch converges: every item read, the action disables itself.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
    });
    expect(screen.getByText(/Showing 7 of 7 notifications/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Unread' }));
    expect(screen.getByText(/No unread notifications match this filter/)).toBeInTheDocument();
  });

  it('rolls back the optimistic read and surfaces an error when mark-read fails', async () => {
    server.restore();
    mockFetchRoutes({
      '/me/broadcasts': {
        data: [
          {
            id: 'ntf-001',
            title: 'Commission cleared',
            createdAt: '2026-08-16T10:00:00.000Z',
          },
        ],
        meta: {},
      },
      '/me/broadcasts/ntf-001/read': {
        body: { error: { code: 'INTERNAL', message: 'boom', timestamp: '2026-09-14T00:00:00Z' } },
        status: 500,
      },
    });
    const user = userEvent.setup();
    renderMember(<NotificationsPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('Commission cleared')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View notification: Commission cleared' }));
    // Optimistic flip first, then the rollback restores Unread + shows the Alert.
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Unread' }));
    expect(await screen.findByText(/Showing 1 of 1 notification · Unread/)).toBeInTheDocument();
  });

  it('shows an empty state when there are no notifications', async () => {
    server.restore();
    mockFetchRoutes({ '/me/broadcasts': { data: [], meta: {} } });
    renderMember(<NotificationsPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('No notifications')).toBeInTheDocument();
  });
});
