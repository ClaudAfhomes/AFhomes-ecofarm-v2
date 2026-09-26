import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MOCK_MEMBER } from '@jad/mock';

import { PoliciesPage } from './PoliciesPage';
import { renderMember } from '../test/utils';
import { mockFetchRoutes } from '../../../test/utils';

const POLICIES = {
  data: [
    {
      id: 'pol-001',
      slug: 'terms',
      title: 'Terms and Conditions',
      type: 'terms',
      updatedAt: '2026-07-01T10:00:00.000Z',
      content: 'These are the terms and conditions of the JA&D program.',
    },
    {
      id: 'pol-002',
      slug: 'guidelines',
      title: 'Program Guidelines',
      type: 'guidelines',
      updatedAt: '2026-07-15T10:00:00.000Z',
      content: 'These are the program guidelines.',
    },
  ],
  meta: {},
};

describe('member PoliciesPage', () => {
  it('lists policies with type and updated date (SCR-MEM-023)', async () => {
    mockFetchRoutes({ '/policies': POLICIES });
    renderMember(<PoliciesPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('Terms and Conditions')).toBeInTheDocument();
    expect(screen.getByText('Program Guidelines')).toBeInTheDocument();
    expect(screen.getAllByText(/updated/).length).toBe(2);
    expect(screen.getByRole('link', { name: /Terms and Conditions/ })).toHaveAttribute(
      'href',
      '/member/policies/terms',
    );

    // Beautiful list - timeframe, search, count, raised cards (trail owned by MemberLayout)
    expect(screen.getAllByText('Policies').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Official · Updated/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search policies')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Showing 2 of 2 policies/)).toBeInTheDocument();
  });

  it('filters by search and shows no-matches', async () => {
    const user = userEvent.setup();
    mockFetchRoutes({ '/policies': POLICIES });
    renderMember(<PoliciesPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('Terms and Conditions')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('Search policies'), 'guidelines');
    expect(screen.getByText('Program Guidelines')).toBeInTheDocument();
    expect(screen.queryByText('Terms and Conditions')).not.toBeInTheDocument();
    expect(screen.getByText(/Showing 1 of 2 policies/)).toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText('Search policies'));
    await user.type(screen.getByPlaceholderText('Search policies'), 'zzz');
    expect(await screen.findByText('No matches')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
  });

  it('shows an empty state when no policies are published', async () => {
    mockFetchRoutes({ '/policies': { data: [], meta: {} } });
    renderMember(<PoliciesPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('No policies yet')).toBeInTheDocument();
  });
});
