import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { roleRoutes } from './role-routes';
describe('shared role portal routes', () => {
  it.each([
    '/admin/customers',
    '/employee/customers',
    '/finance/customers',
    '/hr/customers',
    '/sales/customers',
  ])('renders the shared protected route at %s inside fragments and layout routes', (path) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          {roleRoutes(
            <>
              <Route>
                <Route path="/admin/customers" element={<p>Shared customer screen</p>} />
              </Route>
            </>,
          )}
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('Shared customer screen')).toBeInTheDocument();
  });
  it('renders finance payment routes without an extra finance segment', () => {
    render(
      <MemoryRouter initialEntries={['/finance/payments']}>
        <Routes>
          {roleRoutes(
            <>
              <Route path="/admin/finance/payments" element={<p>Finance payments</p>} />
            </>,
          )}
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('Finance payments')).toBeInTheDocument();
  });
  it('does not introduce public role login aliases through protected route copying', () => {
    render(
      <MemoryRouter initialEntries={['/employee/login']}>
        <Routes>
          {roleRoutes(
            <>
              <Route path="/admin/login" element={<p>Admin login</p>} />
              <Route path="*" element={<p>Unavailable</p>} />
            </>,
          )}
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Admin login')).not.toBeInTheDocument();
  });
  it('lets the canonical page win over a redirect twin that maps to the same Finance path', () => {
    // For Finance, /admin/finance/commissions/settings (old-bookmark twin) and
    // /admin/commissions/settings both become /finance/commissions/settings, and
    // the first declaration wins. The twin declared first made Finance loop forever.
    render(
      <MemoryRouter initialEntries={['/finance/commissions/settings']}>
        <Routes>
          {roleRoutes(
            <>
              <Route path="/admin/commissions/settings" element={<p>Commission settings page</p>} />
              <Route path="/admin/finance/commissions/settings" element={<p>Redirect twin</p>} />
            </>,
          )}
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('Commission settings page')).toBeInTheDocument();
  });
});
