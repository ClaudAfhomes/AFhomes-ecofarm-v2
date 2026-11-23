/**
 * Service Bookings: one next-step button per status, impossible moves are
 * blocked with a reason, the member message travels with the decision, and
 * there are no write controls without update permission.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Booking } from '@afhomes/contracts';

import { renderWithProviders } from '../../test/utils';

const perms = vi.hoisted(() => ({ canUpdate: true }));
vi.mock('../../lib/session', async (original) => ({
  ...(await original<typeof import('../../lib/session')>()),
  useSession: () => ({
    user: {
      afHomesPermissions: [
        { moduleKey: 'operations.bookings', canView: true, canUpdate: perms.canUpdate },
      ],
    },
  }),
}));
vi.mock('./services', () => ({ listBookings: vi.fn(), updateBooking: vi.fn() }));

import { BookingsPage, nextStep } from './BookingsPage';
import { listBookings, updateBooking } from './services';

const mockedList = vi.mocked(listBookings);
const mockedUpdate = vi.mocked(updateBooking);

const BOOKING: Booking = {
  id: 'bbbbbbbb-0000-4000-8000-000000000001',
  reference: 'BKG-000001',
  serviceId: 'cccccccc-0000-4000-8000-000000000001',
  serviceName: 'Smart Wellness Hotel',
  startDate: '2099-01-10',
  endDate: '2099-01-11',
  guests: 2,
  customerNotes: 'Ground floor please.',
  status: 'requested',
  responseNote: '',
  cancelledBy: null,
  decidedAt: null,
  createdAt: '2026-11-21T01:00:00.000Z',
  updatedAt: '2026-11-21T01:00:00.000Z',
  customerId: 'dddddddd-0000-4000-8000-000000000001',
  customerName: 'MARIA SANTOS',
  customerNumber: 'AFH-000123',
  decidedByName: null,
};

const reply = (rows: Booking[]) =>
  mockedList.mockResolvedValue({ data: rows, total: rows.length, requestedCount: 1 });

beforeEach(() => {
  perms.canUpdate = true;
  mockedList.mockReset();
  mockedUpdate.mockReset();
  reply([BOOKING]);
});

describe('nextStep', () => {
  it('confirms a request, blocks a past one, completes only once the date has come', () => {
    expect(nextStep({ status: 'requested', startDate: '2099-01-10' }, '2026-11-21')).toEqual({
      label: 'Confirm',
      status: 'confirmed',
    });
    expect(
      nextStep({ status: 'requested', startDate: '2026-11-20' }, '2026-11-21')?.blockedReason,
    ).toMatch(/can only be declined/);
    expect(nextStep({ status: 'confirmed', startDate: '2099-01-10' }, '2026-11-21')).toBeNull();
    expect(nextStep({ status: 'confirmed', startDate: '2026-11-21' }, '2026-11-21')?.status).toBe(
      'completed',
    );
    expect(nextStep({ status: 'declined', startDate: '2020-01-01' }, '2026-11-21')).toBeNull();
  });
});

describe('BookingsPage', () => {
  it('defaults to open and confirms a request in one click', async () => {
    mockedUpdate.mockResolvedValue({ ...BOOKING, status: 'confirmed' });
    renderWithProviders(<BookingsPage />);
    expect(await screen.findByText('MARIA SANTOS')).toBeInTheDocument();
    expect(screen.getByText(/1 waiting for a decision/)).toBeInTheDocument();
    expect(mockedList).toHaveBeenCalledWith(expect.objectContaining({ status: 'open' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenCalledWith(BOOKING.id, { status: 'confirmed' }),
    );
  });

  it('declines from details and sends the message to the member', async () => {
    mockedUpdate.mockResolvedValue({ ...BOOKING, status: 'declined' });
    renderWithProviders(<BookingsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Details' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Ground floor please.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Message to member/), 'Fully booked');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Decline' }));
    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenCalledWith(BOOKING.id, {
        status: 'declined',
        note: 'Fully booked',
      }),
    );
  });

  it('disables Confirm with a reason when the start date has passed', async () => {
    reply([{ ...BOOKING, startDate: '2020-01-01', endDate: null }]);
    renderWithProviders(<BookingsPage />);
    const confirm = await screen.findByRole('button', { name: 'Confirm' });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('title', expect.stringMatching(/can only be declined/));
  });

  it('offers completion only once the date has come, never before', async () => {
    reply([{ ...BOOKING, status: 'confirmed', startDate: '2099-01-10' }]);
    const first = renderWithProviders(<BookingsPage />);
    expect(await screen.findByText('MARIA SANTOS')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark completed' })).not.toBeInTheDocument();
    first.unmount();

    reply([{ ...BOOKING, status: 'confirmed', startDate: '2020-01-01', endDate: null }]);
    mockedUpdate.mockResolvedValue({ ...BOOKING, status: 'completed' });
    renderWithProviders(<BookingsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Mark completed' }));
    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenCalledWith(BOOKING.id, { status: 'completed' }),
    );
  });

  it('offers no write controls without update permission', async () => {
    perms.canUpdate = false;
    renderWithProviders(<BookingsPage />);
    expect(await screen.findByText('MARIA SANTOS')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Details' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Message to member/)).not.toBeInTheDocument();
  });

  it('says the open list is empty in plain words', async () => {
    mockedList.mockResolvedValue({ data: [], total: 0, requestedCount: 0 });
    renderWithProviders(<BookingsPage />);
    expect(await screen.findByText('No open bookings')).toBeInTheDocument();
  });
});
