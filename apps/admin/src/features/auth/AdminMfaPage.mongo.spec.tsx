import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { expect, it, vi } from 'vitest';
import { AdminMfaPage } from './AdminMfaPage';
vi.mock('../../lib/cookie-auth', () => ({ isMongoAuth: true }));
it('redirects the obsolete MongoDB MFA address without rendering setup controls', async () => {
  render(
    <MemoryRouter initialEntries={['/admin/mfa']}>
      <Routes>
        <Route path="/admin/mfa" element={<AdminMfaPage />} />
        <Route path="/admin" element={<p>Dashboard ready</p>} />
      </Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText('Dashboard ready')).toBeInTheDocument();
  expect(screen.queryByText(/Authenticator setup/i)).not.toBeInTheDocument();
});
