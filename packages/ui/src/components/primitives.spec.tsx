import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import {
  Breadcrumbs,
  Button,
  EmptyState,
  ErrorState,
  Forbidden,
  NotFound,
  PageHeader,
  Skeleton,
  StatusChip,
} from '../index';

describe('StatusChip', () => {
  it('renders the label with a tone and dot', () => {
    render(<StatusChip label="Pending" tone="warning" />);
    const chip = screen.getByText('Pending');
    expect(chip.className).toContain('chip');
    expect(chip.className).toContain('warning');
    expect(chip.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('defaults to the neutral tone', () => {
    render(<StatusChip label="Draft" />);
    expect(screen.getByText('Draft').className).toContain('neutral');
  });
});

describe('Skeleton', () => {
  it('is presentational and hidden from the a11y tree', () => {
    render(<Skeleton />);
    const skeleton = document.querySelector('[aria-hidden="true"]');
    expect(skeleton).not.toBeNull();
  });
});

describe('EmptyState', () => {
  it('renders title, description, and action', () => {
    render(
      <EmptyState
        title="No registrations"
        description="Queue is clear."
        action={<button>Export</button>}
      />,
    );
    expect(screen.getByText('No registrations')).toBeInTheDocument();
    expect(screen.getByText('Queue is clear.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('renders a readable message and retry', () => {
    const onRetry = vi.fn();
    render(<ErrorState error={new Error('boom')} onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Please try again');
    expect(screen.getByRole('alert')).not.toHaveTextContent('boom');
    screen.getByRole('button', { name: 'Retry' }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not leak stack traces', () => {
    render(<ErrorState error={new Error('boom')} />);
    expect(screen.getByRole('alert').textContent).not.toContain('at ');
  });

  it('shows the correlation requestId without PII', () => {
    render(<ErrorState requestId="req-123" />);
    expect(screen.getByText('Reference: req-123')).toBeInTheDocument();
  });
});

describe('Forbidden', () => {
  it('renders a generic access-denied state', () => {
    render(<Forbidden />);
    expect(screen.getByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
  });
});

describe('NotFound', () => {
  it('renders a generic not-found state', () => {
    render(<NotFound />);
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});

describe('PageHeader', () => {
  it('renders title, description, and actions', () => {
    render(
      <PageHeader
        title="Registrations"
        description="Pending approvals"
        actions={<button>New</button>}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Registrations' })).toBeInTheDocument();
    expect(screen.getByText('Pending approvals')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
  });
});

describe('Button', () => {
  it('supports the danger variant and loading state', () => {
    render(
      <Button variant="danger" loading>
        Delete
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Loading…' });
    expect(button).toBeDisabled();
  });
});

describe('Breadcrumbs', () => {
  it('renders the trail with aria-current on the last item', () => {
    render(
      <MemoryRouter>
        <Breadcrumbs items={[{ to: '/sales', label: 'Sales' }, { label: 'Sale #123' }]} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Sales' })).toBeInTheDocument();
    const current = screen.getByText('Sale #123');
    expect(current).toHaveAttribute('aria-current', 'page');
  });
});
