import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { MOCK_MEMBER, setMockSessionUser } from '@jad/mock';
import { createMemberMockServer } from '../../../mock';

import { GroupNetworkPage } from './GroupNetworkPage';
import { renderMember } from '../test/utils';

describe('member GroupNetworkPage', () => {
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

  it('renders the reporting-only network summary from real mock data (SCR-MEM-017)', async () => {
    renderMember(<GroupNetworkPage />, { user: MOCK_MEMBER });

    // Store has 6 total (4 direct + 2 grand), 4 direct, 2 qualified, 1 pending, 2 rejected
    expect(await screen.findByText('6')).toBeInTheDocument();
    expect(screen.getByText('Total members')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('Direct referrals')).toBeInTheDocument();

    // Qualified = 2 (plain number)
    const qualifiedCard = screen.getByText('Qualified').closest('div');
    expect(qualifiedCard).toHaveTextContent('2');

    // Pending = 1 (plain number)
    const pendingCard = screen.getByText('Pending').closest('div');
    expect(pendingCard).toHaveTextContent('1');

    // Rejected = 2 (plain number)
    const rejectedCard = screen.getByText('Rejected').closest('div');
    expect(rejectedCard).toHaveTextContent('2');

    // New Phase 1 UI elements
    expect(screen.getByText('All time · Reporting only')).toBeInTheDocument();
    expect(screen.getByText('View Direct Referrals')).toBeInTheDocument();
    expect(screen.getByText('View Genealogy')).toBeInTheDocument();
    // Phase 3 ring - every referrals page links to the gated Total Earned
    expect(screen.getByRole('link', { name: 'View Total Earned' })).toHaveAttribute(
      'href',
      '/member/referrals/earned',
    );
    expect(screen.getByText(/network view only/)).toBeInTheDocument();
    expect(screen.getByText(/does not represent or compute multi-level/)).toBeInTheDocument();

    // Trail is owned by MemberLayout - no in-page duplicate
    expect(screen.getAllByText('Group Network').length).toBeGreaterThanOrEqual(1);
  });
});
