import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MOCK_ADMIN } from '@jad/mock';

import { resetBroadcastStore } from '../../../mock/broadcastMockStore';
import { installMockApi, renderWithProviders } from '../../../test/utils';
import { BroadcastsPage } from './BroadcastsPage';

async function sendViaDialog(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(screen.getByRole('button', { name: 'New Broadcast' }));
  await screen.findByRole('dialog');
  await user.type(screen.getByLabelText('Title'), title);
  await user.type(screen.getByLabelText(/Message/), 'Scheduled maintenance Sunday 02:00-04:00.');
  await user.click(screen.getByRole('button', { name: 'Send broadcast' }));
}

describe('BroadcastsPage', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    resetBroadcastStore();
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
  });

  it('renders the broadcast list with search and count (SCR-ADM-016)', async () => {
    renderWithProviders(<BroadcastsPage />, { user: MOCK_ADMIN });

    expect(await screen.findByText('Broadcasts')).toBeInTheDocument();
    expect(screen.getByText(/every member's notification feed/)).toBeInTheDocument();
    expect(await screen.findByText(/Showing 2 of 2 broadcasts/)).toBeInTheDocument();
    expect(screen.getByText('New properties in the catalog')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Search broadcasts'), 'community');
    expect(screen.getByText(/Showing 1 of 2 broadcasts/)).toBeInTheDocument();
    expect(screen.queryByText('New properties in the catalog')).not.toBeInTheDocument();
  });

  it('sends a broadcast through the composer dialog', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BroadcastsPage />, { user: MOCK_ADMIN });

    expect(await screen.findByText(/Showing 2 of 2 broadcasts/)).toBeInTheDocument();
    await sendViaDialog(user, 'Sunday maintenance');
    expect(await screen.findByText(/Showing 3 of 3 broadcasts/)).toBeInTheDocument();
    expect(screen.getByText('Sunday maintenance')).toBeInTheDocument();
    expect(await screen.findByText(/now in every member's feed/)).toBeInTheDocument();
  });

  it('blocks sending without a title', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BroadcastsPage />, { user: MOCK_ADMIN });

    expect(await screen.findByText(/Showing 2 of 2 broadcasts/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New Broadcast' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Send broadcast' })).toBeDisabled();
  });

  it('opens a read-only detail dialog from the row title', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BroadcastsPage />, { user: MOCK_ADMIN });

    expect(await screen.findByText(/Showing 2 of 2 broadcasts/)).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'View broadcast: New properties in the catalog' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/new fixed-value units to the catalog/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Sent /)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows an empty state when no broadcasts exist', async () => {
    const { broadcastStore } = await import('../../../mock/broadcastMockStore');
    broadcastStore.items = [];
    renderWithProviders(<BroadcastsPage />, { user: MOCK_ADMIN });

    expect(await screen.findByText('No broadcasts')).toBeInTheDocument();
  });
});
