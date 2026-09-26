import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { Skeleton } from './Skeleton';
import { ApiError } from '../lib/api/errors';
import { renderWithProviders } from '../test/utils';

describe('EmptyState', () => {
  it('renders title, description, and optional action', () => {
    renderWithProviders(
      <EmptyState
        title="No items"
        description="Nothing here yet."
        action={<button type="button">Start</button>}
      />,
    );
    expect(screen.getByRole('heading', { name: 'No items' })).toBeInTheDocument();
    expect(screen.getByText('Nothing here yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('maps an ApiError message and shows the requestId', () => {
    const error = new ApiError({
      code: 'NOT_FOUND',
      message: 'Resource not found',
      status: 404,
      requestId: 'req-1',
    });
    renderWithProviders(<ErrorState error={error} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Resource not found');
    expect(screen.getByText('Reference: req-1')).toBeInTheDocument();
  });

  it('renders a generic message for unknown errors and calls onRetry', async () => {
    const onRetry = vi.fn();
    renderWithProviders(<ErrorState error={new Error('boom')} onRetry={onRetry} />);
    expect(screen.getByText('An unexpected error occurred. Please try again.')).toBeInTheDocument();
    screen.getByRole('button', { name: 'Retry' }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('Skeleton', () => {
  it('is presentational and hidden from assistive tech', () => {
    const { container } = renderWithProviders(<Skeleton />);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
