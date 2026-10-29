import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ApplicationHolder, GenealogyNode } from '@afhomes/contracts';
import { renderWithProviders } from '../../test/utils';
import { HolderFields, RecommenderFields, emptyHolder } from './official-forms-fields';
import { getGenealogy, getOstMemberContacts } from '../genealogy/services';

vi.mock('../genealogy/services', () => ({
  getGenealogy: vi.fn(),
  getGenealogyNode: vi.fn(),
  getGenealogyUpline: vi.fn(async () => []),
  getGenealogyDownline: vi.fn(async () => []),
  getGenealogySummary: vi.fn(),
  getOstMemberContacts: vi.fn(async () => ({})),
}));

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
  it('requests reference review rather than suggesting a missing ZIP can be submitted blank', () => {
    render({ cityMunicipalityCode: '0205706000', postalCode: '' });
    expect(
      screen.getByText('Postal reference needs review for this location.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('No published code. Leave blank.')).not.toBeInTheDocument();
  });
  it('no longer claims the postal code fills from the city', () => {
    render();
    expect(screen.queryByText('Fills from the city selected.')).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/* Recommender details                                                 */
/* ------------------------------------------------------------------ */

const node = (
  staffId: string,
  fullName: string,
  role: GenealogyNode['role'],
  over: Partial<GenealogyNode> = {},
): GenealogyNode => ({
  staffId,
  fullName,
  role,
  status: 'active',
  ostStatus: 'active',
  uplineStaffId: null,
  directDownlineCount: 0,
  totalDescendantCount: 0,
  ...over,
});

const OST_A = '00000000-0000-4000-8000-0000000000a1';
const OST_B = '00000000-0000-4000-8000-0000000000b2';
const SM_A = '00000000-0000-4000-8000-0000000000c3';

function Recommender({ initial }: { initial?: Partial<Parameters<typeof RecommenderFields>[0]['meta']> }) {
  const [meta, setMeta] = useState({
    svdStaffId: '',
    ssmStaffId: '',
    smStaffId: '',
    referrerStaffId: '',
    vipRecommenderName: '',
    recommenderContact: '',
    recommenderEmail: '',
    acknowledgedAt: '2026-10-19',
    ...initial,
  });
  return (
    <RecommenderFields
      meta={meta}
      chainNames={{}}
      onChange={(key, value) => setMeta((current) => ({ ...current, [key]: value }))}
      onChain={(next) => setMeta((current) => ({ ...current, ...next }))}
    />
  );
}

const renderRecommender = (initial?: Parameters<typeof Recommender>[0]['initial']) =>
  renderWithProviders(<Recommender initial={initial} />);

const optionsOf = (label: string): string[] =>
  within(screen.getByLabelText(label))
    .getAllByRole('option')
    .map((option) => option.textContent ?? '');

describe('recommender loading states', () => {
  it('spins inside every chain dropdown while the genealogy loads', () => {
    vi.mocked(getGenealogy).mockReturnValue(new Promise(() => {}));
    renderRecommender();
    // A disabled dropdown with no spinner leaves the operator staring at four
    // empty boxes with no explanation.
    for (const label of ['SVD', 'SSM', 'SM', 'Referrer', 'VIP Recommender']) {
      const select = screen.getByLabelText(label);
      expect(select).toHaveAttribute('aria-busy', 'true');
      expect(select.parentElement?.querySelector('[class*="ring"]')).not.toBeNull();
    }
  });

  it('spins inside the VIP Recommender dropdown while the genealogy loads', () => {
    vi.mocked(getGenealogy).mockReturnValue(new Promise(() => {}));
    renderRecommender();
    expect(screen.getByLabelText('VIP Recommender')).toHaveAttribute('aria-busy', 'true');
  });

  it('offers a real retry button when the genealogy fails, and spins on it', async () => {
    vi.mocked(getGenealogy).mockRejectedValue(new Error('offline'));
    renderRecommender();
    const retry = await screen.findByRole('button', { name: 'Retry chain list' });
    expect(retry).toBeInTheDocument();
    // The old affordance was the words "Chain list unavailable. Retry." with
    // nothing clickable behind them.
    expect(screen.queryByText('Chain list unavailable. Retry.')).not.toBeInTheDocument();

    vi.mocked(getGenealogy).mockResolvedValue([node(OST_A, 'ANA SANTOS', 'ost')]);
    fireEvent.click(retry);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Retry chain list' })).not.toBeInTheDocument(),
    );
    expect(optionsOf('VIP Recommender')).toContain('ANA SANTOS');
  });
});

describe('VIP recommender', () => {
  it('is a dropdown of active OST members, not a typed name', async () => {
    vi.mocked(getGenealogy).mockResolvedValue([
      node(OST_A, 'ANA SANTOS', 'ost'),
      node(OST_B, 'BEN REYES', 'ost'),
      node(SM_A, 'CARLO CRUZ', 'sales_manager'),
      node(OST_A, 'INACTIVE ONE', 'ost', { status: 'inactive' }),
    ]);
    renderRecommender();
    await waitFor(() => expect(optionsOf('VIP Recommender')).toContain('BEN REYES'));
    const options = optionsOf('VIP Recommender');
    expect(options).toEqual(['Not specified', 'ANA SANTOS', 'BEN REYES']);
    // Not a text box any more, and not a non-OST seller.
    expect(screen.queryByRole('textbox', { name: 'VIP Recommender' })).not.toBeInTheDocument();
  });

  it('lists the whole OST roster, not only the selected upline downline', async () => {
    vi.mocked(getGenealogy).mockResolvedValue([
      node(OST_A, 'ANA SANTOS', 'ost'),
      node(OST_B, 'BEN REYES', 'ost'),
    ]);
    renderRecommender({ smStaffId: SM_A });
    // A recommender is not in the applicant's reporting chain, so the upline
    // must not narrow the list the way it narrows Referrer.
    await waitFor(() => expect(optionsOf('VIP Recommender')).toContain('BEN REYES'));
    expect(optionsOf('VIP Recommender')).toHaveLength(3);
  });

  it('stores the chosen recommender name', async () => {
    vi.mocked(getGenealogy).mockResolvedValue([node(OST_A, 'ANA SANTOS', 'ost')]);
    renderRecommender();
    await waitFor(() => expect(optionsOf('VIP Recommender')).toContain('ANA SANTOS'));
    fireEvent.change(screen.getByLabelText('VIP Recommender'), {
      target: { value: 'ANA SANTOS' },
    });
    expect(screen.getByLabelText('VIP Recommender')).toHaveValue('ANA SANTOS');
  });

  it('keeps a stored recommender that is no longer an OST member visible', async () => {
    vi.mocked(getGenealogy).mockResolvedValue([node(OST_A, 'ANA SANTOS', 'ost')]);
    renderRecommender({ vipRecommenderName: 'FORMER MEMBER' });
    await waitFor(() => expect(optionsOf('VIP Recommender')).toContain('ANA SANTOS'));
    // Otherwise the dropdown would display "Not specified" while still holding
    // the old name, and the operator would never know what is stored.
    expect(optionsOf('VIP Recommender')).toContain('FORMER MEMBER (retired)');
    expect(screen.getByLabelText('VIP Recommender')).toHaveValue('FORMER MEMBER');
  });
});

describe('recommender typed fields', () => {
  it.each(['0917ABC', '123'])('does not offer invalid stored phone %s', async (phone) => {
    vi.mocked(getGenealogy).mockResolvedValue([node('ost-1', 'ANA SANTOS', 'ost')]);
    vi.mocked(getOstMemberContacts).mockResolvedValue({
      'ost-1': { phone, email: 'ana@example.com' },
    });
    renderRecommender({ referrerStaffId: '', vipRecommenderName: 'ANA SANTOS' });
    expect(await within(screen.getByLabelText('Recommender Email')).findByRole('option', { name: 'ana@example.com' })).toBeInTheDocument();
    expect(within(screen.getByLabelText('Recommender Contact')).queryByRole('option', { name: new RegExp(phone) })).not.toBeInTheDocument();
  });
  it('refuses a contact number carrying letters by not offering invalid options', async () => {
    vi.mocked(getGenealogy).mockResolvedValue([
      node('ost-1', 'ANA SANTOS', 'ost'),
    ]);
    vi.mocked(getOstMemberContacts).mockResolvedValue({
      'ost-1': { phone: '09171234567', email: 'ana@example.com' },
    });
    renderRecommender({
      referrerStaffId: 'ost-1',
      vipRecommenderName: '',
    });
    await waitFor(() => expect(screen.getByLabelText('Recommender Contact')).toBeInTheDocument());
    // Wait for contact options to load
    await waitFor(() => {
      const contactSelect = screen.getByLabelText('Recommender Contact');
      expect(within(contactSelect).getByRole('option', { name: /09171234567/ })).toBeInTheDocument();
    });
    expect(within(screen.getByLabelText('Recommender Contact')).queryByRole('option', { name: /ana@example\.com/ })).not.toBeInTheDocument();
    // Invalid contact numbers with letters are never offered as options
    expect(within(screen.getByLabelText('Recommender Contact')).queryByRole('option', { name: /0917abc/ })).not.toBeInTheDocument();
  });

  it('keeps the email lowercase in dropdown options', async () => {
    vi.mocked(getGenealogy).mockResolvedValue([
      node('ost-1', 'ANA SANTOS', 'ost'),
    ]);
    vi.mocked(getOstMemberContacts).mockResolvedValue({
      'ost-1': { phone: '09171234567', email: 'Ana@Example.COM' },
    });
    renderRecommender({
      referrerStaffId: '',
      vipRecommenderName: 'ANA SANTOS',
    });
    await waitFor(() => expect(screen.getByLabelText('Recommender Email')).toBeInTheDocument());
    // Wait for email options to load
    await waitFor(() => {
      const emailSelect = screen.getByLabelText('Recommender Email');
      expect(within(emailSelect).getByRole('option', { name: /ana@example\.com/ })).toBeInTheDocument();
    });
    expect(within(screen.getByLabelText('Recommender Email')).queryByRole('option', { name: /Ana@Example/ })).not.toBeInTheDocument();
  });
});
