import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { MOCK_MEMBER, setMockSessionUser } from '@jad/mock';
import { createMemberMockServer } from '../../../mock';

import { TotalEarnedPage } from './TotalEarnedPage';
import { renderMember } from '../test/utils';

describe('member TotalEarnedPage', () => {
  let server: ReturnType<typeof createMemberMockServer>;

  beforeEach(() => {
    server = createMemberMockServer();
    server.install();
    setMockSessionUser(MOCK_MEMBER);
  });

  afterEach(() => {
    server.restore();
    setMockSessionUser(null);
  });

  it('shows final static total-earned content (SCR-MEM-019)', async () => {
    renderMember(<TotalEarnedPage />, { user: MOCK_MEMBER });

    // Final static figure - no dev preview markers
    expect(await screen.findByRole('status', { name: 'Total earned' })).toBeInTheDocument();
    expect(screen.getByText('₱876,000.00')).toBeInTheDocument();
    expect(screen.getByText('Lifetime earnings')).toBeInTheDocument();
    expect(
      screen.getByText(/Ledger-defined total based on credited commissions/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Pending estimates are excluded/)).toBeInTheDocument();
    expect(screen.queryByText(/Illustrative/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Requires approval/)).not.toBeInTheDocument();
    expect(screen.queryByText(/BR-RPT-003/)).not.toBeInTheDocument();
    expect(screen.queryByText(/OD-025/)).not.toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'ledger' })).toHaveAttribute(
      'href',
      '/member/ewallet/ledger',
    );
    expect(screen.getByRole('link', { name: 'commissions' })).toHaveAttribute(
      'href',
      '/member/commissions',
    );

    // Timeframe + header actions - referrals family ring (trail owned by MemberLayout)
    expect(screen.getAllByText('Total Earned').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('All time · Reporting only')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View Commissions' })).toHaveAttribute(
      'href',
      '/member/commissions',
    );
    expect(screen.getByRole('link', { name: 'View Ledger' })).toHaveAttribute(
      'href',
      '/member/ewallet/ledger',
    );
    expect(screen.getByText(/Review your/)).toBeInTheDocument();
    expect(screen.getByText(/for a detailed breakdown/)).toBeInTheDocument();
  });
});
