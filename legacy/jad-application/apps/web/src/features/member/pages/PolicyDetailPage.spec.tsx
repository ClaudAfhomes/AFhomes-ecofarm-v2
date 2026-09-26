import { describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { MOCK_MEMBER } from '@jad/mock';

import { PolicyDetailPage } from './PolicyDetailPage';
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
            <Route path="/member/policies/:policyId" element={<PolicyDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </SessionProvider>,
  );
}

const POLICIES = {
  data: [
    {
      id: 'pol-001',
      slug: 'terms',
      title: 'Terms and Conditions',
      type: 'terms',
      updatedAt: '2026-07-01T10:00:00.000Z',
      content: 'These are the terms and conditions.\nSecond paragraph, plain text.',
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

describe('member PolicyDetailPage', () => {
  it('renders policy content as plain text (no raw HTML, SCR-MEM-023)', async () => {
    mockFetchRoutes({ '/policies': POLICIES });
    renderAt('/member/policies/terms');

    expect(
      await screen.findByRole('heading', { name: 'Terms and Conditions' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/These are the terms and conditions\.\s+Second paragraph, plain text\./),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All policies' })).toHaveAttribute(
      'href',
      '/member/policies',
    );
    expect(document.querySelector('[data-testid]')).toBeNull();
    expect(screen.getAllByText('Terms and Conditions').length).toBeGreaterThanOrEqual(1);
  });

  it('renders a not-found state for an unknown policy id', async () => {
    mockFetchRoutes({ '/policies': POLICIES });
    renderAt('/member/policies/does-not-exist');

    expect(await screen.findAllByText('Policy not found')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'All policies' })).toHaveAttribute(
      'href',
      '/member/policies',
    );
  });

  it('renders a PDF link when the policy has one attached', async () => {
    mockFetchRoutes({
      '/policies': {
        data: [
          {
            ...POLICIES.data[0],
            documentUrl: 'https://cdn.test/terms.pdf',
          },
          POLICIES.data[1],
        ],
        meta: {},
      },
    });
    renderAt('/member/policies/terms');

    expect(
      await screen.findByRole('heading', { name: 'Terms and Conditions' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View PDF' })).toHaveAttribute(
      'href',
      'https://cdn.test/terms.pdf',
    );
  });
});
