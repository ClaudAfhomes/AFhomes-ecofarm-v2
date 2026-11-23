/**
 * Member Messages: inbox defaults to awaiting reply, a thread shows member and
 * staff bubbles, Send needs text, and without update permission it is read-only.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Conversation, ConversationDetail } from '@afhomes/contracts';

import { renderWithProviders } from '../../test/utils';

const perms = vi.hoisted(() => ({ canUpdate: true }));
vi.mock('../../lib/session', async (original) => ({
  ...(await original<typeof import('../../lib/session')>()),
  useSession: () => ({
    user: {
      afHomesPermissions: [
        { moduleKey: 'communication.messages', canView: true, canUpdate: perms.canUpdate },
      ],
    },
  }),
}));
vi.mock('./services', () => ({
  listConversations: vi.fn(),
  getConversation: vi.fn(),
  postStaffMessage: vi.fn(),
  updateConversation: vi.fn(),
}));

import { MessagesPage } from './MessagesPage';
import { getConversation, listConversations, postStaffMessage, updateConversation } from './services';

const mockedList = vi.mocked(listConversations);
const mockedGet = vi.mocked(getConversation);
const mockedPost = vi.mocked(postStaffMessage);
const mockedUpdate = vi.mocked(updateConversation);

const CONVERSATION: Conversation = {
  id: 'ffffffff-0000-4000-8000-000000000001',
  subject: 'Card renewal',
  status: 'open',
  lastMessageAt: '2026-11-21T02:00:00.000Z',
  lastSenderKind: 'customer',
  unread: true,
  createdAt: '2026-11-21T01:00:00.000Z',
  customerId: 'dddddddd-0000-4000-8000-000000000001',
  customerName: 'MARIA SANTOS',
  customerNumber: 'AFH-000123',
};

const DETAIL: ConversationDetail = {
  ...CONVERSATION,
  messages: [
    {
      id: '11111111-0000-4000-8000-000000000001',
      senderKind: 'customer',
      senderName: null,
      body: 'How do I renew my card?',
      createdAt: '2026-11-21T01:00:00.000Z',
    },
    {
      id: '11111111-0000-4000-8000-000000000002',
      senderKind: 'staff',
      senderName: 'ANA REYES',
      body: 'Visit any branch.',
      createdAt: '2026-11-21T01:30:00.000Z',
    },
  ],
};

beforeEach(() => {
  perms.canUpdate = true;
  mockedList.mockReset();
  mockedGet.mockReset();
  mockedPost.mockReset();
  mockedUpdate.mockReset();
  mockedList.mockResolvedValue({ data: [CONVERSATION], total: 1, awaitingCount: 1 });
  mockedGet.mockResolvedValue(DETAIL);
});

describe('MessagesPage', () => {
  it('lists awaiting conversations with a count and shows the thread', async () => {
    renderWithProviders(<MessagesPage />);
    expect(await screen.findByText('Card renewal')).toBeInTheDocument();
    expect(screen.getByText(/1 conversation/)).toBeInTheDocument();
    expect(mockedList).toHaveBeenCalledWith(expect.objectContaining({ status: 'awaiting' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reply' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('How do I renew my card?')).toBeInTheDocument();
    expect(within(dialog).getByText('Visit any branch.')).toBeInTheDocument();
    expect(within(dialog).getByText(/ANA REYES/)).toBeInTheDocument();
  });

  it('keeps Send disabled until there is text, then sends one reply with a request id', async () => {
    mockedPost.mockResolvedValue(DETAIL.messages[1]!);
    renderWithProviders(<MessagesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Reply' }));
    const dialog = await screen.findByRole('dialog');
    const send = await within(dialog).findByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Your reply/), 'Thanks for asking');
    expect(send).toBeEnabled();
    await userEvent.click(send);
    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith(CONVERSATION.id, {
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        body: 'Thanks for asking',
      }),
    );
  });

  it('closes a conversation', async () => {
    mockedUpdate.mockResolvedValue({ ...CONVERSATION, status: 'closed' });
    renderWithProviders(<MessagesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Reply' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Close conversation' }));
    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenCalledWith(CONVERSATION.id, { status: 'closed' }),
    );
  });

  it('is read-only without update permission', async () => {
    perms.canUpdate = false;
    renderWithProviders(<MessagesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'View' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('How do I renew my card?')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Your reply/)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'Close conversation' }),
    ).not.toBeInTheDocument();
  });

  it('says nothing is waiting in plain words', async () => {
    mockedList.mockResolvedValue({ data: [], total: 0, awaitingCount: 0 });
    renderWithProviders(<MessagesPage />);
    expect(await screen.findByText('No messages awaiting a reply')).toBeInTheDocument();
  });
});
