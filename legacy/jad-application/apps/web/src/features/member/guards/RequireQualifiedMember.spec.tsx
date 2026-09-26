import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { MOCK_MEMBER, MOCK_MEMBER_NOT_QUALIFIED } from '@jad/mock';

import type { SessionUser } from '../../../lib/session';
import { renderWithProviders, mockFetchJson } from '../../../test/utils';
import { RequireQualifiedMember } from './RequireQualifiedMember';

function qualifiedSummary(isQualified: boolean) {
  return {
    status: 'APPROVED_ACTIVE',
    isQualified,
    requirements: [],
  };
}

function renderAt(path: string, user: SessionUser | undefined) {
  return renderWithProviders(
    <Routes>
      <Route
        path="/member/sales/new"
        element={
          <RequireQualifiedMember>
            <div>sale form</div>
          </RequireQualifiedMember>
        }
      />
      <Route path="/member/qualification" element={<div>qualification page</div>} />
    </Routes>,
    { route: path, initialUser: user },
  );
}

describe('RequireQualifiedMember', () => {
  it('renders the page for qualified members (server-authoritative)', async () => {
    mockFetchJson(qualifiedSummary(true));
    renderAt('/member/sales/new', MOCK_MEMBER);
    expect(await screen.findByText('sale form')).toBeInTheDocument();
  });

  it('uses the server summary even when the session snapshot is stale', async () => {
    // Session still carries the pre-approval flag (false); the API reports the
    // fresh qualified state - the guard must trust the server, not the login.
    mockFetchJson(qualifiedSummary(true));
    const stale = { ...MOCK_MEMBER_NOT_QUALIFIED } as SessionUser;
    renderAt('/member/sales/new', stale);
    expect(await screen.findByText('sale form')).toBeInTheDocument();
  });

  it('shows the qualification notice for a non-qualified member', async () => {
    mockFetchJson(qualifiedSummary(false));
    renderAt('/member/sales/new', MOCK_MEMBER_NOT_QUALIFIED);
    expect(
      await screen.findByText('Sales require an Active + Qualified membership'),
    ).toBeInTheDocument();
    expect(screen.queryByText('sale form')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View qualification status' })).toHaveAttribute(
      'href',
      '/member/qualification?highlight=unmet',
    );
  });

  it('falls back to the session flag when the qualification API errors', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('boom'));
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/member/sales/new', MOCK_MEMBER);
    expect(await screen.findByText('sale form')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('renders the loading skeleton while the session is restoring', () => {
    renderAt('/member/sales/new', undefined);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('sale form')).not.toBeInTheDocument();
  });
});
