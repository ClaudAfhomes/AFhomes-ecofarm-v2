import { beforeEach, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CookieAuthError } from '@afhomes/shared';
import { renderWithProviders } from '../../test/utils';
import { CustomerLoginForm } from './CustomerLoginForm';
import { OstLoginPage } from '../ost/OstLoginPage';

const mocks = vi.hoisted(() => ({ signIn: vi.fn() }));
vi.mock('../../lib/env', () => ({ env: { VITE_TURNSTILE_SITE_KEY: 'synthetic-public-key' } }));
vi.mock('../../lib/customer-session', async (original) => ({
  ...(await original<typeof import('../../lib/customer-session')>()),
  useCustomerSession: () => ({ signIn: mocks.signIn }),
}));
vi.mock('@afhomes/ui', async (original) => ({
  ...(await original<typeof import('@afhomes/ui')>()),
  TurnstileChallenge: ({ onToken }: { onToken: (token: string) => void }) =>
    <button type="button" onClick={() => onToken('synthetic-login-token')}>Complete test challenge</button>,
}));
beforeEach(() => vi.clearAllMocks());

for (const [name, Component] of [['VIP', CustomerLoginForm], ['OST', OstLoginPage]] as const) {
  it(`${name} requires the challenge before attempting sign-in`, async () => {
    renderWithProviders(<Component />);
    await userEvent.type(screen.getByLabelText('Email'), 'synthetic@example.invalid');
    await userEvent.type(screen.getByLabelText('Password'), 'SyntheticLogin123!');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Complete security verification before signing in.')).toBeVisible();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
  it(`${name} forwards its challenge and explains a rejected verification safely`, async () => {
    mocks.signIn.mockRejectedValueOnce(new CookieAuthError('security'));
    renderWithProviders(<Component />);
    await userEvent.type(screen.getByLabelText('Email'), 'synthetic@example.invalid');
    await userEvent.type(screen.getByLabelText('Password'), 'SyntheticLogin123!');
    await userEvent.click(screen.getByRole('button', { name: 'Complete test challenge' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Security verification failed or expired. Please complete it again.')).toBeVisible();
    expect(mocks.signIn).toHaveBeenCalledWith('synthetic@example.invalid', 'SyntheticLogin123!', 'synthetic-login-token');
  });
}
