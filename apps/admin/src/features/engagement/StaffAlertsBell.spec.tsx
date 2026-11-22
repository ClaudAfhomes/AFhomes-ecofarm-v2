/**
 * Header bell and dashboard notice card: null counts are hidden, an all-null
 * answer hides the bell, and an empty feed renders nothing.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionUser } from '../../lib/session';
import { renderWithProviders } from '../../test/utils';

vi.mock('./services', () => ({ getStaffAlerts: vi.fn(), getAnnouncementFeed: vi.fn() }));

import { AnnouncementsFeedCard } from './AnnouncementsFeedCard';
import { StaffAlertsBell } from './StaffAlertsBell';
import { getAnnouncementFeed, getStaffAlerts } from './services';

const mockedAlerts = vi.mocked(getStaffAlerts);
const mockedFeed = vi.mocked(getAnnouncementFeed);

const USER: SessionUser = {
  id: 'u-1',
  name: 'Ana Reyes',
  email: 'ana@afhomes.test',
  roleId: 'r-admin',
  roleSlug: 'admin',
  roleName: 'Admin',
  status: 'active',
  afHomesPermissions: [],
};

beforeEach(() => {
  mockedAlerts.mockReset();
  mockedFeed.mockReset();
});

describe('StaffAlertsBell', () => {
  it('totals the visible counts and links only to areas the caller can view', async () => {
    mockedAlerts.mockResolvedValue({ newInquiries: 2, requestedBookings: null, awaitingReply: 3 });
    renderWithProviders(<StaffAlertsBell />, { user: USER });
    const bell = await screen.findByRole('button', { name: 'Alerts, 5 waiting' });
    await userEvent.click(bell);
    const menu = screen.getByRole('list', { name: 'Waiting for you' });
    expect(within(menu).getByRole('link', { name: /Website Inquiries/ })).toHaveAttribute(
      'href',
      '/admin/sales/inquiries',
    );
    expect(within(menu).getByRole('link', { name: /Messages/ })).toHaveAttribute(
      'href',
      '/admin/messages',
    );
    expect(within(menu).queryByRole('link', { name: /Bookings/ })).not.toBeInTheDocument();
  });

  it('renders no bell when every count is null', async () => {
    mockedAlerts.mockResolvedValue({
      newInquiries: null,
      requestedBookings: null,
      awaitingReply: null,
    });
    renderWithProviders(<StaffAlertsBell />, { user: USER });
    await waitFor(() => expect(mockedAlerts).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Alerts/ })).not.toBeInTheDocument();
  });
});

describe('AnnouncementsFeedCard', () => {
  it('lists pinned notices first', async () => {
    mockedFeed.mockResolvedValue([
      {
        id: '11111111-0000-4000-8000-000000000001',
        title: 'Newer notice',
        body: 'b',
        pinned: false,
        publishedAt: '2026-11-21T01:00:00.000Z',
        expiresAt: null,
      },
      {
        id: '11111111-0000-4000-8000-000000000002',
        title: 'Older pinned notice',
        body: 'b',
        pinned: true,
        publishedAt: '2026-11-01T01:00:00.000Z',
        expiresAt: null,
      },
    ]);
    renderWithProviders(<AnnouncementsFeedCard />, { user: USER });
    const headings = await screen.findAllByRole('heading', { level: 3 });
    expect(headings[0]).toHaveTextContent('Older pinned notice');
    expect(headings[1]).toHaveTextContent('Newer notice');
  });

  it('renders nothing when there are no notices', async () => {
    mockedFeed.mockResolvedValue([]);
    renderWithProviders(<AnnouncementsFeedCard />, { user: USER });
    await waitFor(() => expect(mockedFeed).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: 'Announcements' })).not.toBeInTheDocument();
  });
});
