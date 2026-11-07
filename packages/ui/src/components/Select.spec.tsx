import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Select } from './Select';

const OPTIONS = [
  { value: '', label: 'New Register' },
  { value: 'c1', label: 'QA Customer' },
];

describe('Select loading state', () => {
  it('renders every option unchanged when idle', () => {
    render(<Select aria-label="Customer" options={OPTIONS} value="" onChange={() => {}} />);
    const select = screen.getByLabelText('Customer') as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'New Register',
      'QA Customer',
    ]);
    expect(select).not.toHaveAttribute('aria-busy');
    expect(select.parentElement).not.toHaveAttribute('data-loading');
    expect(select.parentElement?.querySelector('[class*="ring"]')).toBeNull();
  });

  it('reports the wait on the control itself, not beside it', () => {
    // The spinner lives INSIDE the control, so a loading list never changes the
    // control's size or shifts the surrounding form - which is exactly what a
    // skeleton standing in for the dropdown did.
    render(
      <Select aria-label="Customer" options={OPTIONS} value="" onChange={() => {}} loading />,
    );
    const select = screen.getByLabelText('Customer');
    expect(select).toHaveAttribute('aria-busy', 'true');
    expect(select.parentElement).toHaveAttribute('data-loading', 'true');
    expect(select.parentElement?.querySelector('[class*="ring"]')).not.toBeNull();
  });

  it('keeps the control usable and the options reachable while loading', () => {
    render(
      <Select aria-label="Customer" options={OPTIONS} value="" onChange={() => {}} loading />,
    );
    const select = screen.getByLabelText('Customer') as HTMLSelectElement;
    expect(select).not.toBeDisabled();
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'New Register',
      'QA Customer',
    ]);
  });
});