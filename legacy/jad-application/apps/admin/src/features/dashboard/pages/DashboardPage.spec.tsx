import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { MOCK_MEMBER, MOCK_SUPER_ADMIN } from '@jad/mock';

import { installMockApi, renderWithProviders } from '../../../test/utils';
import { DashboardPage } from './DashboardPage';

describe('DashboardPage', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
  });

  it('shows queue counts for SUPER_ADMIN (single admin type)', async () => {
    renderWithProviders(<DashboardPage />, { user: MOCK_SUPER_ADMIN });

    expect(await screen.findByText('Registrations')).toBeInTheDocument();
    expect(screen.getByText('Sales Request')).toBeInTheDocument();
    expect(screen.getByText('Members')).toBeInTheDocument();
    expect(screen.getByText('Withdrawals')).toBeInTheDocument();
    expect(await screen.findByText(/Welcome back, Admin - \d+ pending/)).toBeInTheDocument();
    expect(screen.getByText('As of today')).toBeInTheDocument();
    // Sales Overview chart section (sales module: mock admin session passes).
    expect(screen.getByText('Sales Overview')).toBeInTheDocument();
  });

  it('shows no admin queues for MEMBER', async () => {
    renderWithProviders(<DashboardPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText(/Welcome back, User - 0 pending/)).toBeInTheDocument();
    expect(screen.queryByText('Registrations')).not.toBeInTheDocument();
    expect(screen.queryByText('All clear')).not.toBeInTheDocument();
  });
});
