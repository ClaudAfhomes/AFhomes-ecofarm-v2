import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { MOCK_MEMBER } from '@jad/mock';

import { DirectReferralsPage } from './DirectReferralsPage';
import { renderMember } from '../test/utils';
import { mockFetchRoutes } from '../../../test/utils';

const REFERRALS = {
  data: [
    {
      id: 'mem-002',
      name: 'Maria Santos',
      status: 'APPROVED_ACTIVE',
      isQualified: false,
      joinedAt: '2026-06-20T10:00:00.000Z',
    },
    {
      id: 'mem-005',
      name: 'Ramon Reyes',
      status: 'APPROVED_ACTIVE',
      isQualified: true,
      joinedAt: '2026-07-01T10:00:00.000Z',
    },
    {
      id: 'mem-006',
      name: 'Liza Lopez',
      status: 'PENDING',
      isQualified: false,
      joinedAt: '2026-08-01T10:00:00.000Z',
    },
  ],
  meta: {},
};

describe('member DirectReferralsPage', () => {
  it('renders direct referrals with status and qualification (SCR-MEM-016)', async () => {
    mockFetchRoutes({ '/me/direct-referrals': REFERRALS });
    renderMember(<DirectReferralsPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('Maria Santos')).toBeInTheDocument();
    expect(screen.getByText('Ramon Reyes')).toBeInTheDocument();
    expect(screen.getByText('Liza Lopez')).toBeInTheDocument();
    expect(screen.getAllByText('Active').length).toBe(2);
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText(/Qualified · joined/)).toBeInTheDocument();
    expect(screen.getAllByText(/Not qualified · joined/)).toHaveLength(2);
    expect(screen.getByText(/single-level only/)).toBeInTheDocument();
  });

  it('shows an empty state with a referral-code link when there are no referrals', async () => {
    mockFetchRoutes({ '/me/direct-referrals': { data: [], meta: {} } });
    renderMember(<DirectReferralsPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('No direct referrals yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View your referral code' })).toHaveAttribute(
      'href',
      '/member/referrals',
    );
  });
});
