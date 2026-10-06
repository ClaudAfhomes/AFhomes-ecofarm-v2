import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { PasswordChecklist } from './PasswordChecklist.js';

const items = [
  { id: 'length', label: 'At least 10 characters', met: true },
  { id: 'lowercase', label: 'One lowercase letter', met: true },
  { id: 'uppercase', label: 'One uppercase letter', met: false },
  { id: 'digit', label: 'One digit', met: false },
];

describe('PasswordChecklist', () => {
  it('renders one row per rule with its label', () => {
    render(<PasswordChecklist items={items} />);
    const list = screen.getByRole('list', { name: 'Password requirements' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    for (const item of items) expect(within(list).getByText(item.label)).toBeInTheDocument();
  });

  it('marks met rules green and missing rules red, announced to screen readers', () => {
    render(<PasswordChecklist items={items} />);
    const list = screen.getByRole('list', { name: 'Password requirements' });
    const rows = within(list).getAllByRole('listitem');
    const first = rows[0]!;
    const third = rows[2]!;
    expect(first).toHaveAttribute('data-met', 'true');
    expect(first.className).toMatch(/met/);
    expect(third).toHaveAttribute('data-met', 'false');
    expect(third.className).toMatch(/unmet/);
    expect(within(first).getByText('(met)')).toBeInTheDocument();
    expect(within(third).getByText('(missing)')).toBeInTheDocument();
  });

  it('keeps icons decorative (no labelled image noise)', () => {
    render(<PasswordChecklist items={items} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
