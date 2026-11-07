import { beforeEach, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/utils';
import { CustomerActivatePage } from './CustomerActivatePage';

const mocks = vi.hoisted(() => ({ activate: vi.fn(), signIn: vi.fn() }));
vi.mock('../../lib/env', () => ({ env: { VITE_TURNSTILE_SITE_KEY: 'synthetic-public-key' } }));
vi.mock('./queries', () => ({ useActivateMutation: () => ({ mutateAsync: mocks.activate, isPending: false }) }));
vi.mock('../../lib/customer-session', async (original) => ({
  ...(await original<typeof import('../../lib/customer-session')>()),
  useCustomerSession: () => ({ signIn: mocks.signIn }),
}));
vi.mock('@afhomes/ui', async (original) => ({
  ...(await original<typeof import('@afhomes/ui')>()),
  TurnstileChallenge: ({ onToken }: { onToken: (token: string) => void }) =>
    <button type="button" onClick={() => onToken('synthetic-activation-challenge')}>Complete test challenge</button>,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.activate.mockResolvedValue({ email: 'synthetic-vip@example.invalid', linkedExistingAuth: false });
  mocks.signIn.mockResolvedValue(undefined);
});
async function fill() {
  renderWithProviders(<CustomerActivatePage />, { route: '/customer/activate' });
  await userEvent.type(screen.getByLabelText('Activation code'), 'synthetic-activation-code');
  await userEvent.type(screen.getByLabelText('Password'), 'SyntheticActivation123!');
  await userEvent.type(screen.getByLabelText('Confirm password'), 'SyntheticActivation123!');
}
it('requires security verification before consuming an activation code', async () => {
  await fill();
  await userEvent.click(screen.getByRole('button', { name: 'Activate my account' }));
  expect(await screen.findByText('Complete security verification before activating your account.')).toBeVisible();
  expect(mocks.activate).not.toHaveBeenCalled();
});
it('passes the challenge to the ordinary sign-in after successful activation', async () => {
  await fill();
  await userEvent.click(screen.getByRole('button', { name: 'Complete test challenge' }));
  await userEvent.click(screen.getByRole('button', { name: 'Activate my account' }));
  expect(mocks.signIn).toHaveBeenCalledWith('synthetic-vip@example.invalid', 'SyntheticActivation123!', 'synthetic-activation-challenge');
});
it('keeps a completed activation clear when the subsequent sign-in fails', async () => {
  mocks.signIn.mockRejectedValueOnce(new Error('Synthetic challenge expired'));
  await fill();
  await userEvent.click(screen.getByRole('button', { name: 'Complete test challenge' }));
  await userEvent.click(screen.getByRole('button', { name: 'Activate my account' }));
  expect(await screen.findByRole('heading', { name: 'Account activated' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/customer/login');
  expect(mocks.activate).toHaveBeenCalledTimes(1);
});
