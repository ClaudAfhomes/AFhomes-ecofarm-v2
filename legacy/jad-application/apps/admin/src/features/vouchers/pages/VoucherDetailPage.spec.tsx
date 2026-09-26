import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MOCK_ADMIN } from '@jad/mock';
import type { ReactElement } from 'react';
import { Route, Routes } from 'react-router';

import { installMockApi, renderWithProviders } from '../../../test/utils';
import { VoucherDetailPage } from './VoucherDetailPage';

function renderDetail(route: string) {
  const ui: ReactElement = (
    <Routes>
      <Route path="/admin/vouchers/:id" element={<VoucherDetailPage />} />
    </Routes>
  );
  return renderWithProviders(ui, { route, user: MOCK_ADMIN });
}

describe('VoucherDetailPage', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
  });

  it('renders the voucher definition with its assignments', async () => {
    renderDetail('/admin/vouchers/vtpl-001');
    expect((await screen.findAllByText('Welcome Gift')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Juan Dela Cruz')).toBeInTheDocument();
    expect(screen.getByText('JAD-VCH-2026-101')).toBeInTheDocument();
    expect(screen.getByText('Assign to Member')).toBeInTheDocument();
  });

  it('opens the assign dialog with member and expiry fields', async () => {
    renderDetail('/admin/vouchers/vtpl-002');
    await screen.findAllByText('Referral Rewards');
    await userEvent.click(screen.getByText('Assign to Member'));
    expect(screen.getByLabelText('Member')).toBeInTheDocument();
    expect(screen.getByLabelText('Expiry Date')).toBeInTheDocument();
    expect(screen.getByLabelText('Valid for days')).toBeInTheDocument();
  });

  it('shows the empty state and assign action when no members are assigned', async () => {
    // Loyalty Reward (vtpl-005) has no assignments in the seed.
    renderDetail('/admin/vouchers/vtpl-005');
    expect(await screen.findByText('No assignments yet')).toBeInTheDocument();
  });
});
