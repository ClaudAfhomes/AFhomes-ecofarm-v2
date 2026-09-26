import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';

import { RegistrationStatusPage } from './RegistrationStatusPage';
import { renderWithProviders } from '../../../test/utils';

const EMAIL = 'ana.nueva@example.com';

function renderStatus() {
  return renderWithProviders(
    <Routes>
      <Route path="/register/status" element={<RegistrationStatusPage />} />
    </Routes>,
    { route: `/register/status?email=${encodeURIComponent(EMAIL)}` },
  );
}

describe('RegistrationStatusPage (SCR-AUTH-004)', () => {
  it('renders the pending status summary with the verified email', () => {
    renderStatus();

    expect(screen.getByRole('heading', { name: 'Application received' })).toBeInTheDocument();
    expect(screen.getByText('Your application is being reviewed.')).toBeInTheDocument();
    expect(screen.getByText(`Application for ${EMAIL}`)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('stays healthy when /cms/register resolves (CMS has only screen-copy fields)', async () => {
    const { CMS_GLOBAL_SEED, CMS_REGISTER_SEED } = await import('@jad/contracts');
    const { mockFetchRoutes } = await import('../../../test/utils');
    mockFetchRoutes({
      '/cms/global': CMS_GLOBAL_SEED,
      '/cms/register': CMS_REGISTER_SEED,
    });
    renderStatus();

    expect(
      await screen.findByRole('heading', { name: 'Application received' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Application under review')).toBeInTheDocument();
    expect(screen.getByText('Apply', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('omits the email line when the query param is absent', () => {
    renderWithProviders(
      <Routes>
        <Route path="/register/status" element={<RegistrationStatusPage />} />
      </Routes>,
      { route: '/register/status' },
    );

    expect(screen.queryByText(/Application for/)).not.toBeInTheDocument();
  });
});
