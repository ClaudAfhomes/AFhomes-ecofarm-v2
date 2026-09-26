import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MOCK_ADMIN } from '@jad/mock';

import { resetInquiryStore } from '../../../mock/inquiryMockStore';
import { installMockApi, renderWithProviders } from '../../../test/utils';
import { InquiriesPage } from './InquiriesPage';

vi.mock('../../../lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/supabase')>();
  return {
    ...actual,
    getSupabaseClient: () => ({
      auth: {
        getSession: async () => ({ data: { session: { access_token: 'test-token' } } }),
      },
    }),
  };
});

describe('InquiriesPage', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    resetInquiryStore();
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
  });

  it('lists inquiries with status chips and a new-message count', async () => {
    renderWithProviders(<InquiriesPage />, { user: MOCK_ADMIN });

    expect(await screen.findByText('Maria Santos')).toBeInTheDocument();
    expect(screen.getByText('maria@example.com')).toBeInTheDocument();
    expect(screen.getByText('NEW')).toBeInTheDocument();
    expect(screen.getByText('READ')).toBeInTheDocument();
    expect(await screen.findByText(/1 new message/)).toBeInTheDocument();
  });

  it('filters by status and search', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InquiriesPage />, { user: MOCK_ADMIN });
    await screen.findByText('Maria Santos');

    await user.click(screen.getByRole('button', { name: 'Read' }));
    expect(screen.queryByText('Maria Santos')).not.toBeInTheDocument();
    expect(screen.getByText('Jose Cruz')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'All' }));
    await user.type(screen.getByPlaceholderText('Search name, email, or message'), 'alaminos');
    expect(screen.queryByText('Maria Santos')).not.toBeInTheDocument();
    expect(screen.getByText('Jose Cruz')).toBeInTheDocument();
  });

  it('opens the message dialog and marks an inquiry read', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InquiriesPage />, { user: MOCK_ADMIN });
    await screen.findByText('Maria Santos');

    const rows = screen.getAllByRole('row');
    const mariaRow = rows.find((row) => within(row).queryByText('Maria Santos'))!;
    await user.click(within(mariaRow).getByRole('button', { name: 'View' }));

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('I would like to know more about membership, thank you.'),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Mark read' }));
    expect(await screen.findByText('Inquiry marked as read')).toBeInTheDocument();
  });

  it('archives an inquiry from the list', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InquiriesPage />, { user: MOCK_ADMIN });
    await screen.findByText('Maria Santos');

    const rows = screen.getAllByRole('row');
    const mariaRow = rows.find((row) => within(row).queryByText('Maria Santos'))!;
    await user.click(within(mariaRow).getByRole('button', { name: 'Archive' }));

    expect(await screen.findByText('Inquiry archived')).toBeInTheDocument();
  });

  it('shows an empty state when there are no inquiries', async () => {
    const { inquiryStore } = await import('../../../mock/inquiryMockStore');
    inquiryStore.items = [];
    renderWithProviders(<InquiriesPage />, { user: MOCK_ADMIN });

    expect(await screen.findByText('No inquiries')).toBeInTheDocument();
  });
});
