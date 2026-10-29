import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import { CookieAuthError } from '@afhomes/shared';
import { PortalLoginPage } from './PortalLoginPage';

const signIn = vi.hoisted(() => vi.fn());
vi.mock('../../lib/session', () => ({
  useSession: () => ({ status: 'unauthenticated', signIn, logout: vi.fn() }),
}));
vi.mock('../../lib/portals', () => ({
  getAuthPortals: () => Promise.reject(new Error('Not signed in')),
}));

it.each([
  ['unavailable', 'The sign-in service is unavailable. Please try again shortly.'],
  ['rate_limited', 'Too many sign-in attempts. Please wait before trying again.'],
  ['rejected', 'We could not sign you in with that email and password.'],
] as const)('shows a safe %s error without mislabelling the failure', async (reason, message) => {
  signIn.mockRejectedValue(new CookieAuthError(reason));
  render(
    <MemoryRouter>
      <PortalLoginPage portal="admin" />
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/Email/), 'synthetic@example.invalid');
  await user.type(screen.getByLabelText(/^Password/), 'Synthetic123!');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText(message)).toBeInTheDocument();
  if (reason !== 'rejected')
    expect(
      screen.queryByText('We could not sign you in with that email and password.'),
    ).not.toBeInTheDocument();
});
