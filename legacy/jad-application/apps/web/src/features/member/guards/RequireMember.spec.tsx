import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { MOCK_ADMIN, MOCK_MEMBER } from '@jad/mock';

import type { SessionUser } from '../../../lib/session';
import { SessionProvider } from '../../../lib/session';
import { RequireMember } from './RequireMember';

function renderAt(path: string, user: SessionUser | undefined) {
  return render(
    <SessionProvider initialUser={user} restoreDelayMs={0}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/member"
            element={
              <RequireMember>
                <div>member dashboard</div>
              </RequireMember>
            }
          />
          <Route path="/login" element={<div>login page</div>} />
          <Route path="/admin" element={<div>admin dashboard</div>} />
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  );
}

describe('RequireMember', () => {
  it('renders the page for authenticated members', async () => {
    renderAt('/member', MOCK_MEMBER);
    expect(await screen.findByText('member dashboard')).toBeInTheDocument();
  });

  it('redirects unauthenticated visitors to login preserving the destination', async () => {
    renderAt('/member', undefined);
    expect(await screen.findByText('login page')).toBeInTheDocument();
    expect(screen.queryByText('member dashboard')).not.toBeInTheDocument();
  });

  it('redirects authenticated non-members (staff) to admin', async () => {
    renderAt('/member', MOCK_ADMIN);
    expect(await screen.findByText('admin dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Access denied')).not.toBeInTheDocument();
  });
});
