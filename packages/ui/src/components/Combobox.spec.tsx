import { describe, expect, it, vi } from 'vitest';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Combobox, type ComboboxOption } from './Combobox.js';

const PROVINCES: ComboboxOption[] = [
  { code: '0403400000', name: 'Laguna' },
  { code: '0406100000', name: 'Batangas' },
];

function setup(overrides: Partial<Parameters<typeof Combobox>[0]> = {}) {
  const onSelect = vi.fn();
  const utils = render(
    <Combobox
      id="province"
      label="Province"
      value={null}
      options={PROVINCES}
      onSelect={onSelect}
      {...overrides}
    />,
  );
  return { onSelect, ...utils, user: userEvent.setup() };
}

const box = () => screen.getByRole('combobox', { name: 'Province' });

describe('Combobox accessibility', () => {
  it('is a labelled combobox, not a free-text box', () => {
    setup();
    expect(box()).toBeInTheDocument();
  });

  it('reports collapsed until it is opened', async () => {
    const { user } = setup();
    expect(box()).toHaveAttribute('aria-expanded', 'false');

    await user.click(box());

    expect(box()).toHaveAttribute('aria-expanded', 'true');
  });

  it('points aria-controls at the listbox it actually renders', async () => {
    const { user } = setup();

    await user.click(box());

    const listboxId = box().getAttribute('aria-controls');
    expect(listboxId).toBeTruthy();
    expect(document.getElementById(listboxId!)).toHaveAttribute('role', 'listbox');
  });

  it('announces that it autocompletes', () => {
    setup();
    expect(box()).toHaveAttribute('aria-autocomplete', 'list');
  });

  it('tracks the active option with aria-activedescendant', async () => {
    const { user } = setup();

    await user.click(box());
    await user.keyboard('{ArrowDown}');

    const active = box().getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    expect(document.getElementById(active!)).toHaveAttribute('role', 'option');
  });
});

describe('Combobox browsing and searching', () => {
  it('offers every option when opened with nothing typed', async () => {
    const { user } = setup();

    await user.click(box());

    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Laguna',
      'Batangas',
    ]);
  });

  it('ranks an exact match above a merely-starting one', async () => {
    const { user } = setup({ options: [{ code: '1', name: 'Macalinos' }, ...PROVINCES] });

    await user.click(box());
    await user.keyboard('lag');

    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Laguna');
  });

  it('says so plainly when nothing matches', async () => {
    const { user } = setup();

    await user.click(box());
    await user.keyboard('zzzz');

    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText(/no match/i)).toBeInTheDocument();
  });

  it('offers every option when reopening a control that already has a value', async () => {
    // The committed value is the displayed answer, not a filter. If opening a
    // filled selector filtered by its own text, the user could only ever re-pick
    // what they already had, and an unrecognised stored value would hide the
    // entire list with no way to escape it.
    const { user } = setup({ value: PROVINCES[0] });

    await user.click(box());

    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Laguna',
      'Batangas',
    ]);
  });

  it('still filters as soon as the user searches', async () => {
    const { user } = setup({ value: PROVINCES[0] });

    await user.click(box());
    await user.clear(box());
    await user.keyboard('Batan');

    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option')).toHaveTextContent('Batangas');
  });

  it('restores the committed value when a cleared field is abandoned', async () => {
    const { user, onSelect } = setup({ value: PROVINCES[0] });

    await user.click(box());
    await user.clear(box());
    await user.tab();

    expect(onSelect).not.toHaveBeenCalled();
    expect(box()).toHaveValue('Laguna');
  });
});

describe('Combobox selection', () => {
  it('selects the active option on Enter', async () => {
    const { user, onSelect } = setup();

    await user.click(box());
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onSelect).toHaveBeenCalledWith(PROVINCES[0]);
  });

  it('selects on click', async () => {
    const { user, onSelect } = setup();

    await user.click(box());
    await user.click(screen.getByRole('option', { name: 'Batangas' }));

    expect(onSelect).toHaveBeenCalledWith(PROVINCES[1]);
  });

  it('moves the active option with the arrow keys, and wraps', async () => {
    const { user } = setup();

    await user.click(box());
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(document.getElementById(box().getAttribute('aria-activedescendant')!)).toHaveTextContent(
      'Batangas',
    );

    await user.keyboard('{ArrowDown}');
    expect(document.getElementById(box().getAttribute('aria-activedescendant')!)).toHaveTextContent(
      'Laguna',
    );
  });

  it('closes on Escape without selecting anything', async () => {
    const { user, onSelect } = setup();

    await user.click(box());
    await user.keyboard('{ArrowDown}{Escape}');

    expect(box()).toHaveAttribute('aria-expanded', 'false');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows the committed selection as the input value', () => {
    setup({ value: PROVINCES[1] });
    expect(box()).toHaveValue('Batangas');
  });

  it('clears the selection', async () => {
    const { user, onSelect } = setup({ value: PROVINCES[1] });

    await user.click(screen.getByRole('button', { name: /clear/i }));

    expect(onSelect).toHaveBeenCalledWith(null);
  });
});

describe('Combobox never invents a value', () => {
  it('reverts an unmatched typed string instead of committing it', async () => {
    // The whole point of a verified-code selector: free text that matches no
    // official record must not become the address.
    const { user, onSelect } = setup({ value: PROVINCES[0] });

    await user.click(box());
    await user.keyboard('NotARealProvince');
    await user.tab();

    expect(onSelect).not.toHaveBeenCalled();
    expect(box()).toHaveValue('Laguna');
  });

  it('does not commit the draft when the user just clicks away from a clean match', async () => {
    const { user, onSelect } = setup();

    await user.click(box());
    await user.keyboard('Laguna');
    await user.tab();

    // Still nothing selected: matching text is a suggestion, not a selection.
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('Combobox states', () => {
  it('shows a loading message and no options', () => {
    setup({ loading: true, loadingLabel: 'Loading provinces' });

    expect(screen.getByText(/loading provinces/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('says nothing at all until the list is opened', () => {
    // A combobox nobody has touched must not claim to be loading, nor claim the
    // reference list is empty. `isPending` is true for a DISABLED query in
    // TanStack Query v5, so a lazily-fetched list would otherwise announce
    // "Loading provinces…" forever before the user ever reached for it - and an
    // unfetched empty list would read as "no provinces exist", which is a lie.
    setup({ options: [] });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no .* to show/i)).not.toBeInTheDocument();
  });

  it('does say the list is empty once the user has opened it', async () => {
    const { user } = setup({ options: [] });

    await user.click(box());

    expect(screen.getByText(/no .* to show/i)).toBeInTheDocument();
  });

  it('shows a safe error with a retry, never a raw failure', async () => {
    const onRetry = vi.fn();
    const { user } = setup({
      error: 'Unable to load provinces. Try again.',
      onRetry,
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load provinces. Try again.');

    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('tells the user when the reference list came back empty', async () => {
    const { user } = setup({ options: [] });

    await user.click(box());

    expect(screen.getByText(/no .* to show/i)).toBeInTheDocument();
  });

  it('is not focusable while disabled, so a child cannot be chosen first', () => {
    setup({ disabled: true });

    expect(box()).toBeDisabled();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('explains why a disabled level cannot be used yet', () => {
    setup({ disabled: true, disabledHint: 'Select a province first' });

    expect(screen.getByText('Select a province first')).toBeInTheDocument();
  });

  it('explains a disabled level exactly once, not as both hint and placeholder', () => {
    // The reason a level is disabled is the same sentence twice if it is also the
    // placeholder: two identical grey lines stacked under one field. The visible
    // hint is also the aria-describedby target, so it is the one to keep.
    setup({ disabled: true, disabledHint: 'Select a province first' });

    expect(screen.getAllByText('Select a province first')).toHaveLength(1);
    // No placeholder at all: `disabledHint` must never double as one.
    expect(box()).not.toHaveAttribute('placeholder');
  });
});

describe('Combobox rendering hooks', () => {
  it('lets the caller show a distinguishing badge without changing the value', async () => {
    const { user } = setup({
      label: 'City / municipality',
      options: [
        { code: '0403403000', name: 'City of Binan', type: 'city' },
        { code: '0403406000', name: 'Calauan', type: 'municipality' },
      ],
      renderOption: (option) => (
        <>
          {option.name}
          <span data-testid="kind">{option.type}</span>
        </>
      ),
    });

    await user.click(screen.getByRole('combobox', { name: 'City / municipality' }));

    const options = screen.getAllByRole('option');
    expect(within(options[0]!).getByTestId('kind')).toHaveTextContent('city');
    expect(within(options[1]!).getByTestId('kind')).toHaveTextContent('municipality');
  });
});