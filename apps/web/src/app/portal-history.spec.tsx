import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authPortalsSchema } from '@afhomes/contracts';
import { CustomerSessionProvider } from '../lib/customer-session';
import { getAuthPortals } from '../lib/portals';
import { portalDashboard } from '../lib/portal-destination';
import { CustomerGuard } from './CustomerGuard';

vi.mock('../lib/portals', () => ({ getAuthPortals: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const ost = authPortalsSchema.parse({
  staff: null,
  customer: null,
  ost: { ostNumber: 'OST-QA', status: 'active' },
});
function Dashboard() {
  const navigate = useNavigate();
  return (
    <>
      <p>Authorized OST dashboard</p>
      <button onClick={() => navigate(-1)}>Back</button>
    </>
  );
}
function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CustomerSessionProvider initialUser={{ authUserId: 'qa-user', email: 'qa@example.invalid' }}>
        <MemoryRouter initialEntries={['/safe', '/customer']} initialIndex={1}>
          <Routes>
            <Route path="/safe" element={<p>Previous safe screen</p>} />
            <Route
              path="/customer"
              element={
                <CustomerGuard>
                  <p>Customer private content</p>
                </CustomerGuard>
              }
            />
            <Route path="/ost/dashboard" element={<Dashboard />} />
          </Routes>
        </MemoryRouter>
      </CustomerSessionProvider>
    </QueryClientProvider>,
  );
}
describe('protected portal history', () => {
  it('replaces the wrong customer entry so Back returns to the previous safe screen', async () => {
    vi.mocked(getAuthPortals).mockResolvedValue(ost);
    mount();
    expect(screen.queryByText('Customer private content')).not.toBeInTheDocument();
    await screen.findByText('Authorized OST dashboard');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByText('Previous safe screen');
    expect(screen.queryByText('Customer private content')).not.toBeInTheDocument();
  });
  it('resolves identity again on a fresh protected-route load and never paints customer content', async () => {
    vi.mocked(getAuthPortals).mockResolvedValue(ost);
    const first = mount();
    await screen.findByText('Authorized OST dashboard');
    first.unmount();
    mount();
    await screen.findByText('Authorized OST dashboard');
    expect(getAuthPortals).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Customer private content')).not.toBeInTheDocument();
  });
  it.each(['employee', 'admin', 'super_admin'])(
    'routes the server-resolved %s identity to the operations dashboard',
    (roleSlug) => {
      const identity = authPortalsSchema.parse({
        staff: { roleSlug, roleName: 'QA', status: 'active', mustChangePassword: false },
        customer: null,
        ost: null,
      });
      expect(portalDashboard(identity, 'customer')).toBe('/admin');
    },
  );
});
