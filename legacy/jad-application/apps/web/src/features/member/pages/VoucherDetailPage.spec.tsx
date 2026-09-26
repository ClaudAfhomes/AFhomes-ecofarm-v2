import { describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { MOCK_MEMBER } from '@jad/mock';

import { VoucherDetailPage } from './VoucherDetailPage';
import { mockFetchRoutes } from '../../../test/utils';
import { SessionProvider } from '../../../lib/session';

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <SessionProvider initialUser={MOCK_MEMBER} restoreDelayMs={0}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/member/vouchers/:voucherId" element={<VoucherDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </SessionProvider>,
  );
}

const VOUCHER = {
  id: 'vch-002',
  code: 'JAD-VCH-2026-002',
  title: 'Referral Rewards Voucher',
  originalValue: '1000.00',
  remainingValue: '350.00',
  status: 'ACTIVE',
  createdAt: '2026-08-06T10:00:00.000Z',
};

describe('member VoucherDetailPage', () => {
  it('renders the voucher and its remaining value (SCR-MEM-021, BR-VCH-002)', async () => {
    mockFetchRoutes({ '/vouchers/vch-002': VOUCHER });
    renderAt('/member/vouchers/vch-002');

    expect(
      await screen.findByRole('heading', { name: 'Referral Rewards Voucher' }),
    ).toBeInTheDocument();
    expect(screen.getByText('₱1,000.00')).toBeInTheDocument();
    expect(screen.getByText('₱350.00')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getAllByText('JAD-VCH-2026-002').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByAltText('QR code for JAD-VCH-2026-002')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download QR' })).toBeInTheDocument();
    expect(screen.getByText(/Vouchers are for your use only/)).toBeInTheDocument();
    expect(screen.queryByText(/pending approval/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All vouchers' })).toHaveAttribute(
      'href',
      '/member/vouchers',
    );
    // Trail is owned by MemberLayout
  });

  it('renders a not-found state for an unknown voucher (object-level)', async () => {
    mockFetchRoutes({
      '/vouchers/vch-999': {
        body: {
          error: { code: 'NOT_FOUND', message: 'Not found', timestamp: '2026-08-18T10:00:00Z' },
        },
        status: 404,
      },
    });
    renderAt('/member/vouchers/vch-999');

    expect(await screen.findAllByText('Voucher not found')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'All vouchers' })).toHaveAttribute(
      'href',
      '/member/vouchers',
    );
  });
});
