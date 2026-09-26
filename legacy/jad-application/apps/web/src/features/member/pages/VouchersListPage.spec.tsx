import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { MOCK_MEMBER } from '@jad/mock';

import { VouchersListPage } from './VouchersListPage';
import { renderMember } from '../test/utils';
import { mockFetchRoutes } from '../../../test/utils';

const VOUCHERS = {
  data: [
    {
      id: 'vch-002',
      code: 'JAD-VCH-2026-002',
      title: 'Referral Rewards Voucher',
      originalValue: '1000.00',
      remainingValue: '350.00',
      status: 'ACTIVE',
      createdAt: '2026-08-06T10:00:00.000Z',
    },
    {
      id: 'vch-003',
      code: 'JAD-VCH-2026-003',
      title: 'Season Promo Voucher',
      originalValue: '250.00',
      remainingValue: '0.00',
      status: 'FULLY_REDEEMED',
      createdAt: '2026-07-06T10:00:00.000Z',
    },
  ],
  meta: {},
};

describe('member VouchersListPage', () => {
  it('lists own vouchers with original, remaining, and status (SCR-MEM-020)', async () => {
    mockFetchRoutes({ '/me/vouchers': VOUCHERS });
    renderMember(<VouchersListPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('Referral Rewards Voucher')).toBeInTheDocument();
    expect(screen.getByText('Season Promo Voucher')).toBeInTheDocument();
    expect(screen.getByText(/₱350\.00/)).toBeInTheDocument();
    expect(screen.getByText(/₱1,000\.00/)).toBeInTheDocument();
    expect(screen.getAllByText('Active').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Fully redeemed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('JAD-VCH-2026-002')).toBeInTheDocument();
    expect(screen.getByAltText('QR code for JAD-VCH-2026-002')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Referral Rewards Voucher/ })).toHaveAttribute(
      'href',
      '/member/vouchers/vch-002',
    );
  });

  it('shows an empty state when there are no vouchers', async () => {
    mockFetchRoutes({ '/me/vouchers': { data: [], meta: {} } });
    renderMember(<VouchersListPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('No vouchers yet')).toBeInTheDocument();
  });
});
