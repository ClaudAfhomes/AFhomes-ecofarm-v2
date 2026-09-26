import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MOCK_ADMIN } from '@jad/mock';

import { installMockApi, renderWithProviders } from '../../../test/utils';
import { MOCK_MEMBERS } from '../../../mock/data';
import { MembersPage } from './MembersPage';

describe('MembersPage', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
  });

  it('renders page header', async () => {
    renderWithProviders(<MembersPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('Members')).toBeInTheDocument();
    expect(screen.getByText(/Member management edit, deactivate, archive/)).toBeInTheDocument();
  });

  it('renders members table with data', async () => {
    renderWithProviders(<MembersPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('Juan Dela Cruz')).toBeInTheDocument();
    expect(screen.getByText('juan.delacruz@example.com')).toBeInTheDocument();
    expect(screen.getAllByText('DOMESTIC').length).toBeGreaterThanOrEqual(1);
  });

  it('shows status chips', async () => {
    renderWithProviders(<MembersPage />, { user: MOCK_ADMIN });
    await screen.findByText('Juan Dela Cruz');
    // Membership column (Active for approved members) and Qualified column.
    expect(screen.getAllByText('Active').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Qualified/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows qualified status', async () => {
    renderWithProviders(<MembersPage />, { user: MOCK_ADMIN });
    await screen.findByText('Juan Dela Cruz');
    expect(screen.getAllByText('Active').length).toBeGreaterThanOrEqual(1);
  });

  it('filters members by search', async () => {
    renderWithProviders(<MembersPage />, { user: MOCK_ADMIN });
    await screen.findByText('Juan Dela Cruz');

    const searchInput = screen.getByLabelText('Search members');
    await userEvent.type(searchInput, 'Kevin');

    expect(screen.queryByText('Juan Dela Cruz')).not.toBeInTheDocument();
    expect(screen.getByText('Kevin Kintanar')).toBeInTheDocument();
  });

  it('renders modern filter dropdowns with accessible labels', async () => {
    renderWithProviders(<MembersPage />, { user: MOCK_ADMIN });
    await screen.findByText('Juan Dela Cruz');
    expect(screen.getByLabelText('Filter by program')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by country')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by membership status')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by account status')).toBeInTheDocument();
  });
});

describe('MembersPage archive pending guard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  it('locks the archive confirm while archiving so double-click sends one request', async () => {
    const member = {
      ...MOCK_MEMBERS[0]!,
      accountStatus: 'ACTIVE',
      registeredAt: '2026-08-12T10:00:00.000Z',
      registrationId: 'reg-001',
    };
    let resolveArchive!: (response: Response) => void;
    const archiveGate = new Promise<Response>((resolve) => {
      resolveArchive = resolve;
    });
    const archivePosts: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.endsWith('/admin/members') && method === 'GET') {
          return json({ data: [member], meta: { page: 1, pageSize: 10, total: 1 } });
        }
        if (url.endsWith('/admin/members/archived')) {
          return json({ data: [], meta: { page: 1, pageSize: 10, total: 0 } });
        }
        if (url.includes('/admin/members/') && url.endsWith('/archive') && method === 'POST') {
          archivePosts.push(url);
          return archiveGate;
        }
        return json({ data: [], meta: { page: 1, pageSize: 10, total: 0 } });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<MembersPage />, { user: MOCK_ADMIN });

    await screen.findByText('Juan Dela Cruz');
    await user.click(screen.getByRole('button', { name: 'Archive member Juan Dela Cruz' }));
    const confirm = await screen.findByRole('button', { name: 'Archive' });
    await user.click(confirm);
    await waitFor(() => expect(confirm).toBeDisabled());
    // Second click while pending must not fire again.
    await user.click(confirm);
    resolveArchive(json({ archivedId: 'mem-001' }));
    await waitFor(() => expect(archivePosts).toHaveLength(1));
    expect(await screen.findByText('Member archived')).toBeInTheDocument();
  });
});
