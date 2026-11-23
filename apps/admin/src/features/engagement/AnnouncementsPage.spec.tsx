/**
 * Announcements: create as draft or publish, one status move per row from the
 * contract's transition table, and no write controls without permission.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Announcement } from '@afhomes/contracts';

import { renderWithProviders } from '../../test/utils';

const perms = vi.hoisted(() => ({ canCreate: true, canUpdate: true }));
vi.mock('../../lib/session', async (original) => ({
  ...(await original<typeof import('../../lib/session')>()),
  useSession: () => ({
    user: {
      afHomesPermissions: [
        {
          moduleKey: 'communication.announcements',
          canView: true,
          canCreate: perms.canCreate,
          canUpdate: perms.canUpdate,
        },
      ],
    },
  }),
}));
vi.mock('./services', () => ({
  listAnnouncements: vi.fn(),
  createAnnouncement: vi.fn(),
  updateAnnouncement: vi.fn(),
}));

import { AnnouncementsPage, statusAction } from './AnnouncementsPage';
import { createAnnouncement, listAnnouncements, updateAnnouncement } from './services';

const mockedList = vi.mocked(listAnnouncements);
const mockedCreate = vi.mocked(createAnnouncement);
const mockedUpdate = vi.mocked(updateAnnouncement);

const NOTICE: Announcement = {
  id: 'eeeeeeee-0000-4000-8000-000000000001',
  title: 'Pool maintenance',
  body: 'Closed on Sunday.',
  audience: 'customers',
  status: 'draft',
  pinned: false,
  publishedAt: null,
  expiresAt: null,
  createdByName: 'ANA REYES',
  createdAt: '2026-11-21T01:00:00.000Z',
  updatedAt: '2026-11-21T01:00:00.000Z',
};

beforeEach(() => {
  perms.canCreate = true;
  perms.canUpdate = true;
  mockedList.mockReset();
  mockedCreate.mockReset();
  mockedUpdate.mockReset();
  mockedList.mockResolvedValue([NOTICE]);
});

describe('statusAction', () => {
  it('follows draft -> published -> archived -> republish', () => {
    expect(statusAction('draft')).toEqual({ label: 'Publish', status: 'published' });
    expect(statusAction('published')).toEqual({ label: 'Archive', status: 'archived' });
    expect(statusAction('archived')).toEqual({ label: 'Republish', status: 'published' });
  });
});

describe('AnnouncementsPage', () => {
  it('publishes a draft in one click', async () => {
    mockedUpdate.mockResolvedValue({ ...NOTICE, status: 'published' });
    renderWithProviders(<AnnouncementsPage />);
    expect(await screen.findByText('Pool maintenance')).toBeInTheDocument();
    expect(screen.getByText('Members')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenCalledWith(NOTICE.id, { status: 'published' }),
    );
  });

  it('creates and publishes a notice from the dialog', async () => {
    mockedCreate.mockResolvedValue({ ...NOTICE, status: 'published' });
    renderWithProviders(<AnnouncementsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'New announcement' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish now' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/title/i);
    expect(mockedCreate).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText(/Title/), 'Holiday hours');
    await userEvent.type(within(dialog).getByLabelText(/Message/), 'Open until noon.');
    await userEvent.click(within(dialog).getByLabelText('Pin to the top'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish now' }));
    await waitFor(() =>
      expect(mockedCreate).toHaveBeenCalledWith({
        title: 'Holiday hours',
        body: 'Open until noon.',
        audience: 'customers',
        pinned: true,
        expiresAt: null,
        publish: true,
      }),
    );
  });

  it('saves a draft without publishing', async () => {
    mockedCreate.mockResolvedValue(NOTICE);
    renderWithProviders(<AnnouncementsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'New announcement' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Title/), 'Holiday hours');
    await userEvent.type(within(dialog).getByLabelText(/Message/), 'Open until noon.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(mockedCreate).toHaveBeenCalledWith(expect.objectContaining({ publish: false })),
    );
  });

  it('hides create and update controls without those permissions', async () => {
    perms.canCreate = false;
    perms.canUpdate = false;
    renderWithProviders(<AnnouncementsPage />);
    expect(await screen.findByText('Pool maintenance')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New announcement' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    mockedList.mockResolvedValue([]);
    renderWithProviders(<AnnouncementsPage />);
    expect(await screen.findByText('No announcements yet')).toBeInTheDocument();
  });
});
