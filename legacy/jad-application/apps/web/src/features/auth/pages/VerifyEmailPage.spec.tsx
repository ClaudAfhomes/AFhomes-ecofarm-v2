import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes, useLocation, useSearchParams } from 'react-router';

import { VerifyEmailPage } from './VerifyEmailPage';
import { mockFetchRoutes, renderWithProviders } from '../../../test/utils';

const EMAIL = 'ana.nueva@example.com';

function StatusProbe() {
  const location = useLocation();
  const [params] = useSearchParams();
  const stateEmail = (location.state as { email?: string } | null)?.email;
  const queryEmail = params.get('email');
  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem('jad:register:email');
  } catch {
    stored = null;
  }
  const email = stateEmail ?? queryEmail ?? stored;
  return <div>Application status: {email}</div>;
}

function renderVerify() {
  return renderWithProviders(
    <Routes>
      <Route path="/register/verify-email" element={<VerifyEmailPage />} />
      <Route path="/register/status" element={<StatusProbe />} />
    </Routes>,
    { route: `/register/verify-email?email=${encodeURIComponent(EMAIL)}` },
  );
}

describe('VerifyEmailPage (SCR-AUTH-003)', () => {
  it('renders the verification screen with the applicant email prefilled', () => {
    renderVerify();

    expect(screen.getByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toHaveValue(EMAIL);
    expect(screen.getByLabelText('Verification code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify Email' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend code' })).toBeInTheDocument();
  });

  it('resends a code and shows a success confirmation', async () => {
    mockFetchRoutes({
      '/auth/verify-email/resend': { email: EMAIL },
    });
    const user = userEvent.setup();
    renderVerify();

    await user.click(screen.getByRole('button', { name: 'Resend code' }));

    expect(
      await screen.findByText('A new code was sent to your email address.'),
    ).toBeInTheDocument();
  });

  it('verifies the one-time code and routes to the application status screen', async () => {
    mockFetchRoutes({
      '/auth/verify-email': { email: EMAIL, verifiedAt: '2026-08-20T10:00:00.000Z' },
    });
    const user = userEvent.setup();
    renderVerify();

    await user.type(screen.getByLabelText('Verification code'), '482913');
    await user.click(screen.getByRole('button', { name: 'Verify Email' }));

    expect(await screen.findByText(`Application status: ${EMAIL}`)).toBeInTheDocument();
  });

  it('surfaces the API error envelope when the code is wrong', async () => {
    mockFetchRoutes({
      '/auth/verify-email': {
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'The verification code is incorrect or has expired.',
            timestamp: '2026-08-20T10:00:00Z',
          },
        },
        status: 400,
      },
    });
    const user = userEvent.setup();
    renderVerify();

    await user.type(screen.getByLabelText('Verification code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify Email' }));

    expect(
      await screen.findByText('The verification code is incorrect or has expired.'),
    ).toBeInTheDocument();
    expect(screen.getByText('We could not verify your email')).toBeInTheDocument();
  });

  it('validates the 6-digit code format before submitting', async () => {
    const user = userEvent.setup();
    renderVerify();

    await user.type(screen.getByLabelText('Verification code'), '123');
    await user.click(screen.getByRole('button', { name: 'Verify Email' }));

    expect(screen.getByText('Enter the 6-digit code from the email.')).toBeInTheDocument();
  });

  it('warns and starts a resend cooldown when the registration email failed to send', async () => {
    mockFetchRoutes({
      '/auth/verify-email/resend': { email: EMAIL, devOnlyCode: '482913' },
    });
    renderWithProviders(
      <Routes>
        <Route path="/register/verify-email" element={<VerifyEmailPage />} />
      </Routes>,
      { route: '/register/verify-email', routeState: { email: EMAIL, emailSent: false } },
    );

    expect(screen.getByText('We could not send the email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend code' })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Resend code' }));
    expect(await screen.findByRole('button', { name: /Resend in \d:\d\d/ })).toBeInTheDocument();
  });
});
