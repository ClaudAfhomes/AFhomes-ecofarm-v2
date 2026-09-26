import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MOCK_MEMBER, MOCK_MEMBER_NOT_QUALIFIED, setMockSessionUser } from '@jad/mock';
import { createMemberMockServer } from '../../../mock';

import { MyGenealogyPage } from './MyGenealogyPage';
import { renderMember } from '../test/utils';

describe('member MyGenealogyPage', () => {
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

  it('renders the tree with direct referrals collapsed by default and never implies MLM (SCR-MEM-018)', async () => {
    renderMember(<MyGenealogyPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('Juan Dela Cruz')).toBeInTheDocument();
    // 4 direct referrals sorted by ID: Maria, Ana, Ramon, Liza
    expect(screen.getByText('Maria Santos')).toBeInTheDocument();
    expect(screen.getByText('Ana Anay')).toBeInTheDocument();
    expect(screen.getByText('Ramon Reyes')).toBeInTheDocument();
    expect(screen.getByText('Liza Lopez')).toBeInTheDocument();
    // Decorative avatar circles show up to two leading initials
    expect(screen.getByText('JD')).toBeInTheDocument();
    expect(screen.getByText(/reporting only/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View Direct Referrals' })).toHaveAttribute(
      'href',
      '/member/referrals/direct',
    );
    expect(screen.getByRole('link', { name: 'View Total Earned' })).toHaveAttribute(
      'href',
      '/member/referrals/earned',
    );
    // Direct referrals are collapsed by default - grandchildren hidden
    expect(screen.queryByText('Nina Navarro')).not.toBeInTheDocument();
    expect(screen.queryByText('Kevin Kintanar')).not.toBeInTheDocument();
    // Juan (the network root) has no sponsor
    expect(screen.getByText('No sponsor linked to your account yet.')).toBeInTheDocument();
  });

  it('shows the sponsor and upline chain for a member who joined with a referral code', async () => {
    setMockSessionUser(MOCK_MEMBER_NOT_QUALIFIED);
    renderMember(<MyGenealogyPage />, { user: MOCK_MEMBER_NOT_QUALIFIED });

    expect(await screen.findByText('Sponsored by')).toBeInTheDocument();
    // Direct sponsor Juan appears in the intro and in the chain (mem-002 Maria was sponsored by mem-001)
    expect(screen.getAllByText('Juan Dela Cruz').length).toBeGreaterThanOrEqual(2);
    // The member is the current end of the chain (tree root + chain step)
    expect(screen.getAllByText(/Maria Santos/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('(you)')).toBeInTheDocument();
    expect(screen.queryByText('No sponsor linked to your account yet.')).not.toBeInTheDocument();
  });

  it('collapses a branch and filters by status', async () => {
    const user = userEvent.setup();
    renderMember(<MyGenealogyPage />, { user: MOCK_MEMBER });

    // Wait for tree to load and direct-collapsed effect to apply
    expect(await screen.findByText('Ramon Reyes')).toBeInTheDocument();
    expect(screen.queryByText('Nina Navarro')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Expand Ramon Reyes' }));
    expect(await screen.findByText('Nina Navarro')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Collapse Ramon Reyes' }));
    expect(screen.queryByText('Nina Navarro')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Rejected' }));
    // Both direct REJECTED (Ana) and nested REJECTED (Nina, after expanding) are visible
    expect(screen.getByText('Ana Anay')).toBeInTheDocument();
    // Ramon is shown because it has a matching descendant (Nina)
    expect(screen.getByText('Ramon Reyes')).toBeInTheDocument();
    expect(screen.queryByText('Liza Lopez')).not.toBeInTheDocument();
    expect(screen.queryByText('Maria Santos')).not.toBeInTheDocument();
  });
});
