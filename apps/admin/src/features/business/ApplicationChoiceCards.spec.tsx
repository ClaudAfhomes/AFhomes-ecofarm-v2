import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { ApplicationChoiceCards } from './ApplicationChoiceCards';
import { readFileSync } from 'node:fs';
const cardCss = readFileSync('src/features/business/ApplicationChoiceCards.module.css', 'utf8');
const editorCss = readFileSync('src/features/business/OfficialFormsPages.module.css', 'utf8');
import editorStyles from './OfficialFormsPages.module.css';
import cardStyles from './ApplicationChoiceCards.module.css';
const scopedCss = (source: string, classes: Record<string, string>) =>
  source.replace(/\.([a-z][a-z0-9_-]*)/gi, (selector, name) =>
    classes[name] ? `.${classes[name]}` : selector,
  );

let stylesheet: HTMLStyleElement | undefined;
afterEach(() => stylesheet?.remove());

it('keeps native radio inputs compact inside the real application editor styles', () => {
  renderWithProviders(
    <div className={editorStyles.editorGrid}>
      <input aria-label="Ordinary text field" />
      <ApplicationChoiceCards
        label="Payment scheme"
        value="cash"
        onChange={vi.fn()}
        options={[
          { value: 'cash', label: 'Spot Cash', icon: 'wallet' },
          { value: 'move', label: 'Move B2: 25% DP + 12 Months', icon: 'wallet' },
        ]}
      />
    </div>,
  );
  // Load the host styles last, reproducing the cascade that stretched the radios.
  stylesheet = document.createElement('style');
  stylesheet.textContent = `${scopedCss(cardCss, cardStyles)}\n${scopedCss(editorCss, editorStyles)}`;
  document.head.append(stylesheet);
  expect(getComputedStyle(screen.getByRole('radio', { name: 'Spot Cash' })).width).toBe('1px');
  expect(getComputedStyle(screen.getByLabelText('Ordinary text field')).width).toBe('100%');
});

it('keeps the whole card selectable and preserves the selected state', () => {
  const change = vi.fn();
  renderWithProviders(
    <ApplicationChoiceCards
      label="VIP plan"
      value="gold"
      onChange={change}
      options={[
        { value: 'gold', label: 'Gold VIP' },
        { value: 'silver', label: 'Silver VIP' },
      ]}
    />,
  );
  expect(screen.getByRole('radio', { name: 'Gold VIP' })).toBeChecked();
  fireEvent.click(screen.getByText('Silver VIP'));
  expect(change).toHaveBeenCalledWith('silver');
});

function KeyboardCards() {
  const [value, setValue] = useState('gold');
  return (
    <ApplicationChoiceCards
      label="VIP plan"
      value={value}
      onChange={setValue}
      options={[
        { value: 'gold', label: 'Gold VIP' },
        { value: 'silver', label: 'Silver VIP' },
      ]}
    />
  );
}

it('keeps native keyboard selection when the radio indicator is visually hidden', async () => {
  const user = userEvent.setup();
  renderWithProviders(<KeyboardCards />);
  await user.tab();
  expect(screen.getByRole('radio', { name: 'Gold VIP' })).toHaveFocus();
  await user.keyboard('{ArrowRight}');
  expect(screen.getByRole('radio', { name: 'Silver VIP' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Silver VIP' })).toHaveFocus();
  expect(screen.getByRole('radio', { name: 'Gold VIP' })).not.toBeChecked();
});
