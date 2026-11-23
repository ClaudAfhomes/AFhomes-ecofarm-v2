import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChoiceChips } from './ChoiceChips';
import { PageSkeleton } from './PageSkeleton';

const OPTIONS = [
  { value: '', label: 'All tiers' },
  { value: 'GOLD', label: 'Gold' },
  { value: 'SILVER', label: 'Silver', disabled: true },
  { value: 'BRONZE', label: 'Bronze' },
];

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <ChoiceChips label="VIP Tier" value={value} options={OPTIONS} onChange={setValue} />
      <output>{value || 'none'}</output>
    </>
  );
}

describe('PageSkeleton', () => {
  it('announces one loading status and hides the placeholder shapes', () => {
    render(<PageSkeleton rows={3} />);
    const status = screen.getByRole('status', { name: 'Loading page' });
    expect(status).toBeInTheDocument();
    expect(status.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(3);
  });
});

describe('ChoiceChips', () => {
  it('shows every option as a radio and selects with one click', () => {
    render(<Harness />);
    const group = screen.getByRole('radiogroup', { name: 'VIP Tier' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'All tiers' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Gold' }));
    expect(screen.getByRole('radio', { name: 'Gold' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('GOLD')).toBeInTheDocument();
  });

  it('has one tab stop and moves with arrow keys, skipping disabled options', () => {
    render(<Harness initial="GOLD" />);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1, -1]);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Gold' }), { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Bronze' })).toHaveFocus();
    expect(screen.getByText('BRONZE')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Bronze' }), { key: 'Home' });
    expect(screen.getByText('none')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Silver' })).toBeDisabled();
  });
});
