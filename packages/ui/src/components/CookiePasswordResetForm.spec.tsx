import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { CookiePasswordResetForm } from './CookiePasswordResetForm';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});
function form(reset = vi.fn().mockResolvedValue(undefined)) {
  render(
    <MemoryRouter>
      <CookiePasswordResetForm
        reset={reset}
        validate={(value) => (value.length < 10 ? 'Too short' : null)}
        loginHref="/login"
      />
    </MemoryRouter>,
  );
  return reset;
}
function enter(confirmation = 'SyntheticOnly123') {
  fireEvent.change(screen.getByLabelText('New password'), {
    target: { value: 'SyntheticOnly123' },
  });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: confirmation } });
  fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
}
it('refuses missing or provider-rejected links before submitting credentials', () => {
  window.history.replaceState(null, '', '/reset?error=expired&token=synthetic');
  const reset = form();
  expect(screen.getByText('Invalid or expired link')).toBeInTheDocument();
  expect(reset).not.toHaveBeenCalled();
});
it('rejects mismatched confirmation without sending a request', () => {
  window.history.replaceState(null, '', '/reset?token=synthetic');
  const reset = form();
  enter('Different123');
  expect(screen.getByText('The passwords do not match')).toBeInTheDocument();
  expect(reset).not.toHaveBeenCalled();
});
it('uses the token once and removes credentials and query parameters after success', async () => {
  window.history.replaceState(null, '', '/reset?token=synthetic');
  const reset = form();
  enter();
  expect(await screen.findByText('Password updated')).toBeInTheDocument();
  expect(reset).toHaveBeenCalledExactlyOnceWith('synthetic', 'SyntheticOnly123');
  expect(window.location.search).toBe('');
  expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
});
it('keeps failed recovery actionable without exposing provider errors', async () => {
  window.history.replaceState(null, '', '/reset?token=synthetic');
  form(vi.fn().mockRejectedValue(new Error('internal provider detail')));
  enter();
  expect(await screen.findByText('Password reset failed')).toBeInTheDocument();
  expect(screen.queryByText('internal provider detail')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Update password' })).toBeEnabled();
});
