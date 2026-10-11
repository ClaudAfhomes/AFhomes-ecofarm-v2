import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Pagination } from '../index';

function setup({ page, pageCount }: { page: number; pageCount: number }) {
  const onChange = vi.fn();
  render(<Pagination page={page} pageCount={pageCount} onChange={onChange} />);
  return { onChange };
}

describe('Pagination', () => {
  it('disables previous on the first page and next on the last page', () => {
    setup({ page: 1, pageCount: 3 });
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
  });

  it('marks the current page with aria-current', () => {
    setup({ page: 2, pageCount: 3 });
    expect(screen.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page');
  });

  it('calls onChange with the target page', async () => {
    const user = userEvent.setup();
    const { onChange } = setup({ page: 2, pageCount: 5 });
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onChange).toHaveBeenCalledWith(3);
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('renders a windowed page list with ellipsis for large ranges', () => {
    setup({ page: 5, pageCount: 20 });
    expect(screen.getAllByText('…').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Page 20' })).toBeInTheDocument();
  });

  it('wraps both step controls in the same bordered container', () => {
    setup({ page: 2, pageCount: 5 });
    const next = screen.getByRole('button', { name: 'Next page' });
    const previous = screen.getByRole('button', { name: 'Previous page' });
    expect(next.parentElement?.className).toMatch(/stepWrap/);
    expect(previous.parentElement?.className).toMatch(/stepWrap/);
  });
});
