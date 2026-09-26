import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary';

function Bomb(): never {
  throw new Error('render boom');
}

describe('ErrorBoundary', () => {
  it('renders children when no error is thrown', () => {
    render(<ErrorBoundary>content</ErrorBoundary>);
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('shows a recoverable fallback when a render error is thrown', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    errorSpy.mockRestore();
  });
});
