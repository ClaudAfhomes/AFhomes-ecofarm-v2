import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { FAQAccordion } from './FAQAccordion';
import { renderWithProviders } from '../../../test/utils';

const ITEMS = [
  { question: 'First question?', answer: 'First answer.' },
  { question: 'Second question?', answer: 'Second answer.' },
];

describe('FAQAccordion', () => {
  it('renders collapsed questions with correct ARIA wiring', () => {
    renderWithProviders(<FAQAccordion items={ITEMS} />);

    const first = screen.getByRole('button', { name: /first question/i });
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(first).toHaveAttribute('aria-controls');
    const panel = document.getElementById(first.getAttribute('aria-controls')!);
    expect(panel).toHaveAttribute('inert');
    expect(panel).toHaveAttribute('role', 'region');
    expect(panel).toHaveAttribute('aria-labelledby', first.id);
  });

  it('expands and collapses an item on click, wiring the panel region', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FAQAccordion items={ITEMS} />);

    const first = screen.getByRole('button', { name: /first question/i });
    await user.click(first);

    expect(first).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(first.getAttribute('aria-controls')!);
    expect(panel).not.toHaveAttribute('inert');
    expect(screen.getByText('First answer.')).toBeInTheDocument();

    await user.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(panel).toHaveAttribute('inert');
  });

  it('toggles with the keyboard (Enter and Space)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FAQAccordion items={ITEMS} />);

    const first = screen.getByRole('button', { name: /first question/i });
    first.focus();
    await user.keyboard('{Enter}');
    expect(first).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Enter}');
    expect(first).toHaveAttribute('aria-expanded', 'false');

    await user.keyboard(' ');
    expect(first).toHaveAttribute('aria-expanded', 'true');
  });
});
