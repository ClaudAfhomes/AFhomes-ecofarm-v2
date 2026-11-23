/**
 * Website Inquiries inbox: one next-step button per record, details with
 * contact links and staff notes, and no write controls without update.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Inquiry } from '@afhomes/contracts';

import { renderWithProviders } from '../../test/utils';

const perms = vi.hoisted(() => ({ canUpdate: true }));
vi.mock('../../lib/session', async (original) => ({
  ...(await original<typeof import('../../lib/session')>()),
  useSession: () => ({
    user: {
      afHomesPermissions: [
        { moduleKey: 'sales.inquiries', canView: true, canUpdate: perms.canUpdate },
      ],
    },
  }),
}));
vi.mock('./services', () => ({ listInquiries: vi.fn(), updateInquiry: vi.fn() }));

import { InquiriesPage, nextStep } from './InquiriesPage';
import { listInquiries, updateInquiry } from './services';

const mockedList = vi.mocked(listInquiries);
const mockedUpdate = vi.mocked(updateInquiry);

const INQUIRY: Inquiry = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  reference: 'INQ-000001',
  kind: 'reservation',
  inquiryType: 'Smart Wellness Hotel',
  name: 'JUAN DELA CRUZ',
  email: 'juan@example.com',
  contactNumber: '+639171234567',
  message: 'Two adults, one night.',
  visitDate: '2099-01-10',
  endDate: '2099-01-11',
  guests: 2,
  status: 'new',
  staffNotes: '',
  assignedTo: null,
  assignedToName: null,
  handledAt: null,
  createdAt: '2026-11-21T01:00:00.000Z',
  updatedAt: '2026-11-21T01:00:00.000Z',
};

beforeEach(() => {
  perms.canUpdate = true;
  mockedList.mockReset();
  mockedUpdate.mockReset();
  mockedList.mockResolvedValue({ data: [INQUIRY], total: 1, newCount: 1 });
});

describe('nextStep', () => {
  it('walks a reservation new → contacted → confirmed → closed and reopens', () => {
    expect(nextStep({ status: 'new', kind: 'reservation' }).status).toBe('contacted');
    expect(nextStep({ status: 'contacted', kind: 'reservation' }).status).toBe('confirmed');
    expect(nextStep({ status: 'contacted', kind: 'inquiry' }).status).toBe('closed');
    expect(nextStep({ status: 'confirmed', kind: 'reservation' }).status).toBe('closed');
    expect(nextStep({ status: 'spam', kind: 'inquiry' }).label).toBe('Reopen');
  });
});

describe('InquiriesPage', () => {
  it('lists open inquiries and moves one to its next step in one click', async () => {
    mockedUpdate.mockResolvedValue({ ...INQUIRY, status: 'contacted' });
    renderWithProviders(<InquiriesPage />);
    expect(await screen.findByText('JUAN DELA CRUZ')).toBeInTheDocument();
    expect(screen.getByText(/1 new waiting for a reply/)).toBeInTheDocument();
    expect(mockedList).toHaveBeenCalledWith(expect.objectContaining({ status: 'open' }));
    await userEvent.click(screen.getByRole('button', { name: 'Mark contacted' }));
    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenCalledWith(INQUIRY.id, { status: 'contacted' }),
    );
  });

  it('shows the message with contact links and saves staff notes', async () => {
    mockedUpdate.mockResolvedValue({ ...INQUIRY, staffNotes: 'Call after 5pm' });
    renderWithProviders(<InquiriesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Details' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Two adults, one night.')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'juan@example.com' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^mailto:juan@example\.com/),
    );
    expect(within(dialog).getByRole('link', { name: '+639171234567' })).toHaveAttribute(
      'href',
      'tel:+639171234567',
    );
    const save = within(dialog).getByRole('button', { name: 'Save notes' });
    expect(save).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Staff notes/), 'Call after 5pm');
    await userEvent.click(save);
    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenCalledWith(INQUIRY.id, { staffNotes: 'Call after 5pm' }),
    );
  });

  it('offers no write controls without update permission', async () => {
    perms.canUpdate = false;
    renderWithProviders(<InquiriesPage />);
    expect(await screen.findByText('JUAN DELA CRUZ')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark contacted' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Details' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: 'Save notes' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Mark as spam' })).not.toBeInTheDocument();
  });

  it('says the open list is empty in plain words', async () => {
    mockedList.mockResolvedValue({ data: [], total: 0, newCount: 0 });
    renderWithProviders(<InquiriesPage />);
    expect(await screen.findByText('No open inquiries')).toBeInTheDocument();
  });
});
