import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { MOCK_ADMIN } from '@jad/mock';
import { createMockServer } from '@jad/mock';

import { installMockApi, renderWithProviders } from '../../../test/utils';
import { RegistrationsPage } from './RegistrationsPage';

describe('RegistrationsPage', () => {
  let server: { install: () => void; restore: () => void };

  beforeEach(() => {
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
  });

  it('renders the registration queue from the API and paginates', async () => {
    renderWithProviders(<RegistrationsPage />, { user: MOCK_ADMIN });

    await screen.findByText(/Juan/);

    const caption = await screen.findByText(/registrations page 1 of 1/);
    expect(caption).toBeInTheDocument();
    // Pagination is rendered below table (max 10 rows per page) - visible even for single page
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
  });

  it('shows the documented status chips for each row', async () => {
    renderWithProviders(<RegistrationsPage />, { user: MOCK_ADMIN });

    await screen.findByText(/Juan/);
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
  });

  it('renders modern filter dropdowns with accessible labels', async () => {
    renderWithProviders(<RegistrationsPage />, { user: MOCK_ADMIN });
    await screen.findByText(/Juan/);
    expect(screen.getByLabelText('Filter by status')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by program')).toBeInTheDocument();
  });

  it('offers only PENDING and REJECTED status filters (no Active)', async () => {
    renderWithProviders(<RegistrationsPage />, { user: MOCK_ADMIN });
    await screen.findByText(/Juan/);
    const select = screen.getByLabelText('Filter by status') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain('PENDING');
    expect(values).toContain('REJECTED');
    expect(values).not.toContain('APPROVED_ACTIVE');
  });

  it('renders the error state when the queue cannot be fetched', async () => {
    server.restore();
    renderWithProviders(<RegistrationsPage />, { user: MOCK_ADMIN });

    // Repository goes through fetch (Phase B3 cutover); with the mock
    // server restored the request fails and the error state renders.
    expect(
      await screen.findByText(/something went wrong|failed to load|error/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Juan/)).not.toBeInTheDocument();
  });

  it('banners hidden applications when the server reports meta.invalid', async () => {
    // Dashboard counts raw PENDING rows while the list drops invalid ones:
    // the page must explain the gap instead of claiming "Queue is clear".
    server.restore();
    const hidden = createMockServer(
      [
        {
          path: '/admin/registrations',
          response: { data: [], meta: { page: 1, pageSize: 0, total: 0, invalid: 2 } },
        },
      ],
      0,
    );
    hidden.install();
    try {
      renderWithProviders(<RegistrationsPage />, { user: MOCK_ADMIN });
      expect(await screen.findByText(/could not be displayed/)).toBeInTheDocument();
      expect(screen.getByText('Queue is clear')).toBeInTheDocument();
    } finally {
      hidden.restore();
    }
  });
});
