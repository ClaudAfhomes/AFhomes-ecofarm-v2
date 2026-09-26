import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SearchableSelect, type SearchableOption } from './SearchableSelect';

const OPTIONS: SearchableOption[] = [
  { value: '0128', label: 'Ilocos Norte' },
  { value: '0129', label: 'Ilocos Sur' },
  { value: '133900', label: 'City of Manila' },
];

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <SearchableSelect
        id="loc"
        name="loc"
        label="Province"
        value={value}
        options={OPTIONS}
        onChange={setValue}
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

describe('SearchableSelect', () => {
  it('filters options as the user types', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Province' });
    await user.click(input);
    await user.type(input, 'ilocos');
    expect(await screen.findByRole('option', { name: 'Ilocos Norte' })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'Ilocos Sur' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'City of Manila' })).not.toBeInTheDocument();
  });

  it('commits only listed values - free text reverts on blur', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Province' });
    await user.click(input);
    await user.type(input, 'Atlantis');
    expect(screen.getByText(/No matches/)).toBeInTheDocument();
    fireEvent.blur(input);
    expect(screen.getByTestId('value')).toHaveTextContent('');
    expect(input).toHaveValue('');
  });

  it('selects an option by pointer and clears it by typing + blur', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Province' });
    await user.click(input);
    await user.click(await screen.findByRole('option', { name: 'Ilocos Sur' }));
    expect(screen.getByTestId('value')).toHaveTextContent('0129');

    // Typing a non-matching value then leaving reverts to the selection.
    await user.click(input);
    await user.clear(input);
    await user.type(input, 'Nowhere');
    fireEvent.blur(input);
    expect(screen.getByTestId('value')).toHaveTextContent('0129');
    expect(input).toHaveValue('Ilocos Sur');
  });

  it('supports keyboard selection', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Province' });
    await user.click(input);
    await user.type(input, 'manila');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByTestId('value')).toHaveTextContent('133900');
  });

  it('reflects an externally cleared selection', async () => {
    function ClearHarness() {
      const [value, setValue] = useState('0128');
      return (
        <>
          <SearchableSelect
            id="loc"
            name="loc"
            label="Province"
            value={value}
            options={OPTIONS}
            onChange={setValue}
          />
          <button type="button" onClick={() => setValue('')}>
            clear
          </button>
        </>
      );
    }
    const user = userEvent.setup();
    render(<ClearHarness />);
    expect(screen.getByRole('combobox', { name: 'Province' })).toHaveValue('Ilocos Norte');
    await user.click(screen.getByRole('button', { name: 'clear' }));
    expect(screen.getByRole('combobox', { name: 'Province' })).toHaveValue('');
  });
});
