import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { PoliciesPage } from './PoliciesPage';
import { mockFetchNetworkError, mockFetchRoutes, renderWithProviders } from '../../../test/utils';

const POLICIES = {
  data: [
    {
      id: 'pol-001',
      slug: 'terms',
      title: 'Terms and Conditions (API)',
      type: 'terms',
      content: 'These are the terms and conditions of the JA&D program.',
      updatedAt: '2026-07-01T10:00:00.000Z',
    },
    {
      id: 'pol-003',
      slug: 'privacy',
      title: 'Privacy Policy (API)',
      type: 'privacy',
      content: 'This is the privacy policy.',
      documentUrl: 'https://cdn.test/privacy.pdf',
      updatedAt: '2026-07-15T10:00:00.000Z',
    },
  ],
  meta: {},
};

describe('public PoliciesPage', () => {
  it('lists API policies with links to their detail pages', async () => {
    mockFetchRoutes({ '/policies': POLICIES });
    renderWithProviders(<PoliciesPage />);

    expect(await screen.findByRole('heading', { name: 'Policies' })).toBeInTheDocument();
    expect(await screen.findByText('Terms and Conditions (API)')).toBeInTheDocument();
    expect(screen.getByText('Privacy Policy (API)')).toBeInTheDocument();
    expect(screen.queryByText('Program Guidelines')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Terms and Conditions \(API\)/ })).toHaveAttribute(
      'href',
      '/policies/terms',
    );
    expect(screen.getByRole('link', { name: /Privacy Policy \(API\)/ })).toHaveAttribute(
      'href',
      '/policies/privacy',
    );
  });

  it('falls back to static content when the API is unreachable (Q6)', async () => {
    mockFetchNetworkError();
    renderWithProviders(<PoliciesPage />);

    expect(await screen.findByText('Terms and Conditions')).toBeInTheDocument();
    expect(screen.getByText('Program Guidelines')).toBeInTheDocument();
    expect(screen.getByText('Privacy Policy')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Program Guidelines/ })).toHaveAttribute(
      'href',
      '/policies/guidelines',
    );
  });
});
