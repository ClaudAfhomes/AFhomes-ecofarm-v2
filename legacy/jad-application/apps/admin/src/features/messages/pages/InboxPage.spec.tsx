import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MOCK_ADMIN } from '@jad/mock';

import { resetMessagesMockStore } from '../../../mock/messagesMockStore';
import { installMockApi, renderWithProviders } from '../../../test/utils';
import { InboxPage } from './InboxPage';

describe('admin InboxPage', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    resetMessagesMockStore();
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
  });

  it('renders the conversation inbox with unread counts (SCR-ADM Messages)', async () => {
    renderWithProviders(<InboxPage />, { user: MOCK_ADMIN });

    expect(await screen.findByText('Juan Dela Cruz')).toBeInTheDocument();
    expect(screen.getByText('Ramon Reyes')).toBeInTheDocument();
    expect(screen.getByText(/2 unread/)).toBeInTheDocument();
    expect(screen.getByText('When will my payout be processed?')).toBeInTheDocument();
    expect(screen.getByText(/Showing 2 of 2 conversations/)).toBeInTheDocument();
  });

  it('filters conversations by member', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InboxPage />, { user: MOCK_ADMIN });

    expect(await screen.findByText('Juan Dela Cruz')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('Search by member'), 'ramon');
    expect(screen.getByText(/Showing 1 of 2 conversations/)).toBeInTheDocument();
    expect(screen.queryByText('Juan Dela Cruz')).not.toBeInTheDocument();
  });

  it('shows an empty state when no conversations exist', async () => {
    const { messagesMockStore } = await import('../../../mock/messagesMockStore');
    messagesMockStore.conversations = [];
    renderWithProviders(<InboxPage />, { user: MOCK_ADMIN });

    expect(await screen.findByText('No conversations')).toBeInTheDocument();
  });
});
