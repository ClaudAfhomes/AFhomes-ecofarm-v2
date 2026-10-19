import { fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import type { ApplicationHolder } from '@afhomes/contracts';
import { renderWithProviders } from '../../test/utils';
import { HolderFields, emptyHolder } from './official-forms-fields';

/**
 * The holder block of the customer-application editor.
 *
 * These are the rules the form itself owns: what a pick-list may contain, what
 * a typed field may hold, and what it may NOT silently rewrite. The contract
 * (`@afhomes/contracts`) is separately pinned - this file proves the SCREEN
 * says the same thing, because a form that offers a value the server refuses
 * is worse than one that never offers it.
 */

function Holder({ initial }: { initial?: Partial<ApplicationHolder> }) {
  const [value, setValue] = useState<ApplicationHolder>({
    ...emptyHolder('PRIMARY'),
    ...initial,
  });
  return <HolderFields title="3. Primary holder" value={value} onChange={setValue} />;
}

const render = (initial?: Partial<ApplicationHolder>) =>
  renderWithProviders(<Holder initial={initial} />);

const optionLabels = (label: string): string[] =>
  within(screen.getByLabelText(label))
    .getAllByRole('option')
    .map((option) => option.textContent ?? '');

/** A date `years` back from now, so the age rule never depends on a fixture year. */
const yearsAgo = (years: number): string => `${new Date().getFullYear() - years}-01-01`;

describe('holder pick-lists', () => {
  it('offers no suffix as "None", not "Not specified"', () => {
    render();
    // "No suffix" is a statement about the person; "not specified" is a
    // statement about the form, and only the first one is true here.
    expect(optionLabels('Suffix')[0]).toBe('None');
    expect(optionLabels('Suffix')).not.toContain('Not specified');
    expect(optionLabels('Suffix').slice(1)).toEqual(['Jr.', 'Sr.', 'II', 'III', 'IV']);
  });

  it('keeps the other pick-lists on their shared "Not specified" empty choice', () => {
    render();
    expect(optionLabels('Sex')[0]).toBe('Not specified');
    expect(optionLabels('Civil status')[0]).toBe('Not specified');
  });

  it('offers only the recordable sexes, never "Other"', () => {
    render();
    expect(optionLabels('Sex')).toEqual(['Not specified', 'Male', 'Female']);
    expect(optionLabels('Sex')).not.toContain('Other');
  });

  it('offers only the recordable civil statuses, never an annulled one', () => {
    render();
    expect(optionLabels('Civil status')).toEqual([
      'Not specified',
      'Single',
      'Married',
      'Widowed',
      'Separated',
    ]);
  });

  it('keeps a stored value that is no longer offered visible, never silently swapped', () => {
    // A <select> whose value matches no <option> DISPLAYS the first option
    // while still holding the old one: the form would read "Not specified" and
    // submit something else. The retired value has to stay on screen.
    render({ sex: 'Other', civilStatus: 'Annulled' });
    expect(optionLabels('Sex')).toContain('Other (retired)');
    expect(optionLabels('Civil status')).toContain('Annulled (retired)');
    expect(screen.getByLabelText('Sex')).toHaveValue('Other');
    expect(screen.getByLabelText('Civil status')).toHaveValue('Annulled');
  });
});

describe('holder typed fields', () => {
  it('takes citizenship as typed text, not a closed dropdown', () => {
    render();
    const citizenship = screen.getByLabelText('Citizenship');
    expect(citizenship.tagName).toBe('INPUT');
    expect(citizenship).toHaveAttribute('type', 'text');
    expect(screen.queryByRole('combobox', { name: 'Citizenship' })).not.toBeInTheDocument();
  });

  it('accepts any nationality a holder actually holds', () => {
    render();
    // The closed set the workbook template uses covers three cases; a real
    // applicant can hold any nationality, so the field must not refuse one.
    fireEvent.change(screen.getByLabelText('Citizenship'), {
      target: { value: 'American' },
    });
    expect(screen.getByLabelText('Citizenship')).toHaveValue('American');
  });

  it('refuses characters that are not part of a nationality', () => {
    render();
    fireEvent.change(screen.getByLabelText('Citizenship'), {
      target: { value: 'A1m<er>ican!' },
    });
    expect(screen.getByLabelText('Citizenship')).toHaveValue('American');
  });

  it('keeps digits and address punctuation in the street lines', () => {
    render();
    // An address is not a name: house numbers and unit designators ARE the
    // address, and a name-only filter would reject "123 Mabini St.".
    const field = screen.getByLabelText('Permanent address line 1');
    fireEvent.change(field, { target: { value: "123 Mabini St. (Unit 4-B), Brgy. San Felipe" } });
    expect(field).toHaveValue('123 Mabini St. (Unit 4-B), Brgy. San Felipe');
  });

  it('refuses characters that are not part of an address', () => {
    render();
    const field = screen.getByLabelText('Permanent address line 1');
    fireEvent.change(field, { target: { value: '12 Mabini <script>' } });
    expect(field).toHaveValue('12 Mabini Script');
  });

  it('title-cases each word of the street line', () => {
    render();
    const field = screen.getByLabelText('Permanent address line 2');
    fireEvent.change(field, { target: { value: 'unit 12 LOS REYES' } });
    expect(field).toHaveValue('Unit 12 Los Reyes');
  });

  it('capitalises the initial letter and every letter after a space', () => {
    render();
    const field = screen.getByLabelText('Last name');
    fireEvent.change(field, { target: { value: 'de la cruz' } });
    expect(field).toHaveValue('De La Cruz');
  });

  it.each(['Last name', 'First name', 'Middle name', 'Printed name'])(
    'refuses numbers and symbols in %s',
    (label) => {
      render();
      const field = screen.getByLabelText(label);
      fireEvent.change(field, { target: { value: "o'brien-jr!2 de la cruz@#3" } });
      expect(field).toHaveValue("O'brien-jr De La Cruz");
    },
  );

  it.each([
    // The three business fields that have always displayed in caps keep doing
    // so: the filter must change what may be TYPED, never how a field renders.
    ['Occupation / business', 'occupationBusinessName', '3M PHILS & CO/SALES'],
    ['Office / business address', 'officeBusinessAddress', '3M PHILS & CO/SALES'],
    // Industry has no uppercase convention, and none was invented for it.
    ['Business / industry', 'businessIndustry', '3M Phils & Co/Sales'],
    ['Employed position', 'employedPosition', '3M PHILS & CO/SALES'],
  ])('refuses unusable characters in %s', (label, _key, expected) => {
    render();
    const field = screen.getByLabelText(label as string);
    // Digits, ampersands and slashes are ordinary in these fields ("3M
    // Philippines", "Sales & Marketing"); angle brackets are not.
    fireEvent.change(field, { target: { value: '3M <Phils> & Co/Sales' } });
    expect(field).toHaveValue(expected as string);
  });
});

describe('holder birth date', () => {
  it('accepts a working age', () => {
    render();
    const field = screen.getByLabelText('Birth date');
    fireEvent.change(field, { target: { value: yearsAgo(30) } });
    expect(field).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('refuses an age past working life', () => {
    render();
    const field = screen.getByLabelText('Birth date');
    fireEvent.change(field, { target: { value: yearsAgo(76) } });
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('75 or less');
  });
});

describe('postal code hint', () => {
  it('no longer claims the postal code fills from the city', () => {
    render();
    expect(screen.queryByText('Fills from the city selected.')).not.toBeInTheDocument();
  });
});