import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { MOCK_STAFF_ADMIN } from '@jad/mock';

import { resetMessagesMockStore } from '../../../mock/messagesMockStore';
import { installMockApi, renderWithProviders } from '../../../test/utils';
import { ConversationPage } from './ConversationPage';

describe('admin ConversationPage', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    resetMessagesMockStore();
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
  });

  function renderConversation() {
    return renderWithProviders(
      <Routes>
        <Route path="/admin/messages/:memberId" element={<ConversationPage />} />
      </Routes>,
      { route: '/admin/messages/mem-001', user: MOCK_STAFF_ADMIN },
    );
  }

  it('renders the member thread oldest-first with the staff composer (SCR-ADM Messages)', async () => {
    renderConversation();

    expect(
      await screen.findByText('Hello, I have a question about my commission.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Hi Juan! Happy to help - what would you like to know?'),
    ).toBeInTheDocument();
    // Sender name appears in the breadcrumb and the member bubble.
    expect(screen.getAllByText('Juan Dela Cruz').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeDisabled();
    expect(screen.getByText(/Reply as Ada Admin/)).toBeInTheDocument();
  });

  it('sends a staff reply and clears the composer', async () => {
    const user = userEvent.setup();
    renderConversation();

    await screen.findByText('Hello, I have a question about my commission.');

    const input = screen.getByLabelText(/Reply as Ada Admin/);
    await user.type(input, 'Your commission clears after 7 days.');
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    await waitFor(() => {
      expect(screen.getByText('Your commission clears after 7 days.')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(input).toHaveValue('');
    });
  });

  it('shows the empty state for a thread with no messages', async () => {
    const { messagesMockStore } = await import('../../../mock/messagesMockStore');
    messagesMockStore.messages = [];
    renderWithProviders(
      <Routes>
        <Route path="/admin/messages/:memberId" element={<ConversationPage />} />
      </Routes>,
      { route: '/admin/messages/mem-001', user: MOCK_STAFF_ADMIN },
    );

    expect(await screen.findByText('No messages yet')).toBeInTheDocument();
  });

  it('scrolls to the newest message when the thread opens', async () => {
    renderConversation();

    // Geometry before the thread data lands (jsdom has no layout).
    const thread = screen.getByTestId('message-thread') as HTMLElement;
    Object.defineProperty(thread, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(thread, 'clientHeight', { value: 200, configurable: true });

    await screen.findByText('Hello, I have a question about my commission.');
    // The jump lands on the next animation frame, after the items paint.
    await waitFor(() => expect(thread.scrollTop).toBe(1000));
  });

  it('scrolls to the newest message after the staff reply sends', async () => {
    const user = userEvent.setup();
    renderConversation();

    const thread = screen.getByTestId('message-thread') as HTMLElement;
    Object.defineProperty(thread, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(thread, 'clientHeight', { value: 200, configurable: true });
    await screen.findByText('Hello, I have a question about my commission.');
    await waitFor(() => expect(thread.scrollTop).toBe(1000));

    // The reader scrolls up; their own send still jumps to the latest.
    thread.scrollTop = 100;
    Object.defineProperty(thread, 'scrollHeight', { value: 1400, configurable: true });
    const input = screen.getByLabelText(/Reply as Ada Admin/);
    await user.type(input, 'Your commission clears after 7 days.');
    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    await waitFor(() => {
      expect(screen.getByText('Your commission clears after 7 days.')).toBeInTheDocument();
    });
    await waitFor(() => expect(thread.scrollTop).toBe(1400));
  });
});
