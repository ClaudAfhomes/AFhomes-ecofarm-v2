import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TurnstileChallenge } from './TurnstileChallenge';

afterEach(() => {
  delete window.turnstile;
});

it('retries a failed widget, ignores its stale callbacks and clears the error on success', async () => {
  type Options = Parameters<NonNullable<Window['turnstile']>['render']>[1];
  const callbacks: Options[] = [];
  const remove = vi.fn();
  window.turnstile = {
    render: vi.fn((_element, options) => {
      callbacks.push(options);
      return String(callbacks.length);
    }),
    remove,
  };
  const onToken = vi.fn();
  render(<TurnstileChallenge siteKey="synthetic-key" onToken={onToken} />);
  await waitFor(() => expect(callbacks).toHaveLength(1));
  act(() => callbacks[0]!['error-callback']());
  expect(screen.getByRole('alert')).toHaveTextContent('Security check failed');
  fireEvent.click(screen.getByRole('button', { name: 'Retry security check' }));
  await waitFor(() => expect(callbacks).toHaveLength(2));
  expect(remove).toHaveBeenCalledWith('1');
  onToken.mockClear();
  act(() => callbacks[0]!.callback('stale-token'));
  expect(onToken).not.toHaveBeenCalled();
  act(() => callbacks[1]!.callback('fresh-token'));
  expect(onToken).toHaveBeenCalledWith('fresh-token');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
