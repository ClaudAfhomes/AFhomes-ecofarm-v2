import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ApplicationHolder, GenealogyNode } from '@afhomes/contracts';
import { renderWithProviders } from '../../test/utils';
import { HolderFields, RecommenderFields, emptyHolder } from './official-forms-fields';
import { getGenealogy, getOstMemberContacts, resolveAaNumber, getAccreditationNumbers } from '../genealogy/services';

vi.mock('../genealogy/services', () => ({
  getGenealogy: vi.fn(),
  getGenealogyNode: vi.fn(),
  getGenealogyUpline: vi.fn(async () => []),
  getGenealogyDownline: vi.fn(async () => []),
  getGenealogySummary: vi.fn(),
  getOstMemberContacts: vi.fn(async () => ({})),
  resolveAaNumber: vi.fn(),
  getAccreditationNumbers: vi.fn(async () => ({})),
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

function Holder({ initial, tabbed = false }: { initial?: Partial<ApplicationHolder>; tabbed?: boolean }) {
  const [value, setValue] = useState<ApplicationHolder>({
    ...emptyHolder('PRIMARY'),
    ...initial,
  });
  return <HolderFields title="3. Primary holder" value={value} onChange={setValue} sectioned={tabbed} tabbed={tabbed} />;
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
  it('keeps suffix as optional free text, including values outside the workbook vocabulary', () => {
    render();
    expect(screen.getByRole('textbox', { name: 'Suffix' })).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Suffix'), { target: { value: 'V' } });
    expect(screen.getByLabelText('Suffix')).toHaveValue('V');
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
  it('preserves entries while switching V4 detail tabs and supports keyboard navigation', () => {
    renderWithProviders(<Holder tabbed />);
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Maria' } });
    expect(screen.getByLabelText('Email')).not.toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Contact' }));
    expect(screen.getByLabelText('Email')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'maria@example.test' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Personal' }));
    expect(screen.getByLabelText('First name')).toHaveValue('Maria');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Personal' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Address' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Address' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Contact' }));
    expect(screen.getByLabelText('Email')).toHaveValue('maria@example.test');
  });
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

function Recommender({
  initial,
  networkSelection,
}: {
  initial?: Partial<Parameters<typeof RecommenderFields>[0]['meta']>;
  networkSelection?: Parameters<typeof RecommenderFields>[0]['networkSelection'];
}) {
  const [meta, setMeta] = useState({
    svdStaffId: '',
    ssmStaffId: '',
    smStaffId: '',
    referrerStaffId: '',
    vipRecommenderName: '',
    recommenderContact: '',
    recommenderEmail: '',
    acknowledgedAt: '2026-10-19',
    referrerAaNumber: '',
    recommenderAaNumber: '',
    recommenderStaffId: '',
    ...initial,
  });
  return (
    <RecommenderFields
      meta={meta}
      chainNames={{}}
      networkSelection={networkSelection}
      onChange={(key, value) => setMeta((current) => ({ ...current, [key]: value }))}
      onChain={(next) => setMeta((current) => ({ ...current, ...next }))}
    />
  );
}

const renderRecommender = (initial?: Parameters<typeof Recommender>[0]['initial']) =>
  renderWithProviders(<Recommender initial={initial} />);

const renderNewRecommender = () => renderWithProviders(<Recommender networkSelection />);

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

describe('recommender contact/email loading states', () => {
  it('spins and disables both dropdowns while contact lookup is in flight, never offering empty options early', async () => {
    vi.mocked(getGenealogy).mockResolvedValue([node('ost-1', 'ANA SANTOS', 'ost')]);
    vi.mocked(getOstMemberContacts).mockReturnValue(new Promise(() => {}));
    renderRecommender({ referrerStaffId: '', vipRecommenderName: 'ANA SANTOS' });
    // The VIP Recommender name only resolves to a staff id - and the contact
    // lookup only starts - once the genealogy chain itself has loaded.
    await waitFor(() => expect(optionsOf('VIP Recommender')).toContain('ANA SANTOS'));
    const contactSelect = screen.getByLabelText('Recommender Contact');
    const emailSelect = screen.getByLabelText('Recommender Email');
    await waitFor(() => {
      expect(contactSelect).toHaveAttribute('aria-busy', 'true');
      expect(emailSelect).toHaveAttribute('aria-busy', 'true');
    });
    expect(contactSelect).toBeDisabled();
    expect(emailSelect).toBeDisabled();
    expect(contactSelect.parentElement?.querySelector('[class*="ring"]')).not.toBeNull();
    expect(emailSelect.parentElement?.querySelector('[class*="ring"]')).not.toBeNull();
    expect(within(contactSelect).queryByRole('option', { name: 'No contact available' })).not.toBeInTheDocument();
    expect(within(emailSelect).queryByRole('option', { name: 'No email available' })).not.toBeInTheDocument();
  });

  it('enables both dropdowns and populates real options once the fetch resolves', async () => {
    vi.mocked(getGenealogy).mockResolvedValue([node('ost-1', 'ANA SANTOS', 'ost')]);
    vi.mocked(getOstMemberContacts).mockResolvedValue({
      'ost-1': { phone: '09171234567', email: 'ana@example.com' },
    });
    renderRecommender({ referrerStaffId: '', vipRecommenderName: 'ANA SANTOS' });
    expect(
      await within(screen.getByLabelText('Recommender Contact')).findByRole('option', { name: /09171234567/ }),
    ).toBeInTheDocument();
    expect(
      await within(screen.getByLabelText('Recommender Email')).findByRole('option', { name: 'ana@example.com' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Recommender Contact')).not.toBeDisabled();
    expect(screen.getByLabelText('Recommender Email')).not.toBeDisabled();
  });

  it('shows an empty-state message, not "No contact"/"No email" prematurely, once loading finishes with nothing to offer', async () => {
    vi.mocked(getGenealogy).mockResolvedValue([node('ost-1', 'ANA SANTOS', 'ost')]);
    vi.mocked(getOstMemberContacts).mockResolvedValue({ 'ost-1': { phone: null, email: '' } });
    renderRecommender({ referrerStaffId: '', vipRecommenderName: 'ANA SANTOS' });
    await waitFor(() =>
      expect(within(screen.getByLabelText('Recommender Contact')).getByRole('option', { name: 'No contact available' })).toBeInTheDocument(),
    );
    expect(within(screen.getByLabelText('Recommender Email')).getByRole('option', { name: 'No email available' })).toBeInTheDocument();
    expect(screen.getByLabelText('Recommender Contact')).not.toBeDisabled();
    expect(screen.getByLabelText('Recommender Email')).not.toBeDisabled();
  });

  it('recovers from a failed contact lookup with a retry, instead of spinning forever', async () => {
    vi.mocked(getGenealogy).mockResolvedValue([node('ost-1', 'ANA SANTOS', 'ost')]);
    vi.mocked(getOstMemberContacts).mockRejectedValue(new Error('offline'));
    renderRecommender({ referrerStaffId: '', vipRecommenderName: 'ANA SANTOS' });
    const retry = await screen.findByRole('button', { name: 'Retry contact lookup' });
    await waitFor(() => {
      expect(within(screen.getByLabelText('Recommender Contact')).getByRole('option', { name: 'Unable to load contact numbers' })).toBeInTheDocument();
      expect(within(screen.getByLabelText('Recommender Email')).getByRole('option', { name: 'Unable to load email' })).toBeInTheDocument();
    });
    // Settled on error, not stuck spinning - and still interactive.
    expect(screen.getByLabelText('Recommender Contact')).not.toBeDisabled();
    expect(screen.getByLabelText('Recommender Email')).not.toBeDisabled();

    vi.mocked(getOstMemberContacts).mockResolvedValue({
      'ost-1': { phone: '09171234567', email: 'ana@example.com' },
    });
    fireEvent.click(retry);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Retry contact lookup' })).not.toBeInTheDocument(),
    );
    expect(within(screen.getByLabelText('Recommender Contact')).getByRole('option', { name: /09171234567/ })).toBeInTheDocument();
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

/**
 * New Customer Application only (`networkSelection` set): the VIP recommender
 * is an AA-number input, not a name dropdown. Nothing here is picked by hand -
 * proving that means proving the typed number actually drives the resolved
 * name, the role guard, the mutual-exclusion guard, and the read-only upline.
 */
describe('VIP recommender AA-number resolution (New Customer Application)', () => {
  it('suggests only active visible OST AAO numbers in the input', async () => {
    vi.mocked(getGenealogy).mockResolvedValue([
      node(OST_A, 'ANA SANTOS', 'ost'), node(SM_A, 'BEN CRUZ', 'sales_manager'),
    ]);
    vi.mocked(getAccreditationNumbers).mockResolvedValue({ [OST_A]: 'AAO26100001', [SM_A]: 'AAI26050002' });
    const { container } = renderNewRecommender();
    await waitFor(() => expect(container.querySelector('datalist option[value="AAO26100001"]')).not.toBeNull());
    expect(container.querySelector('datalist option[value="AAI26050002"]')).toBeNull();
    expect(screen.getByLabelText('OST Referrer AA number')).toHaveAttribute('list');
  });

  it('resolves a typed AA number to the recommender and shows their SM/SSM/SVD upline with AA numbers', async () => {
    vi.mocked(getGenealogy).mockResolvedValue([
      node(OST_A, 'ANA SANTOS', 'ost', { uplineStaffId: SM_A }),
      node(SM_A, 'BEN CRUZ', 'sales_manager'),
    ]);
    vi.mocked(resolveAaNumber).mockResolvedValue({
      member: {
        staffId: OST_A,
        fullName: 'ANA SANTOS',
        role: 'ost',
        aaNumber: 'AAO26100001',
        kind: 'OST',
        status: 'accredited',
      },
    });
    vi.mocked(getAccreditationNumbers).mockResolvedValue({ [SM_A]: 'AAI26050002' });
    renderNewRecommender();
    fireEvent.change(screen.getByLabelText('OST VIP recommender AA number'), {
      target: { value: 'AAO26100001' },
    });
    expect(await screen.findByText(/ANA SANTOS/)).toBeVisible();
    expect(await screen.findByText('BEN CRUZ')).toBeVisible();
    expect(await screen.findByText(/AAI26050002/)).toBeVisible();
  });

  it('refuses a resolved member who is not an accredited OST member', async () => {
    vi.mocked(getGenealogy).mockResolvedValue([node(SM_A, 'BEN CRUZ', 'sales_manager')]);
    vi.mocked(resolveAaNumber).mockResolvedValue({
      member: {
        staffId: SM_A,
        fullName: 'BEN CRUZ',
        role: 'sales_manager',
        aaNumber: 'AAI26050002',
        kind: 'IST',
        status: 'accredited',
      },
    });
    renderNewRecommender();
    fireEvent.change(screen.getByLabelText('OST VIP recommender AA number'), {
      target: { value: 'AAI26050002' },
    });
    expect(await screen.findByText(/must be an accredited OST member/)).toBeVisible();
  });

  it('refuses a recommender who is also the selected referrer', async () => {
    vi.mocked(getGenealogy).mockResolvedValue([node(OST_A, 'ANA SANTOS', 'ost')]);
    vi.mocked(resolveAaNumber).mockResolvedValue({
      member: {
        staffId: OST_A,
        fullName: 'ANA SANTOS',
        role: 'ost',
        aaNumber: 'AAO26100001',
        kind: 'OST',
        status: 'accredited',
      },
    });
    renderWithProviders(
      <Recommender initial={{ referrerStaffId: OST_A }} networkSelection />,
    );
    fireEvent.change(screen.getByLabelText('OST VIP recommender AA number'), {
      target: { value: 'AAO26100001' },
    });
    expect(
      await screen.findByText('Referrer and VIP recommender must be different members.'),
    ).toBeVisible();
  });

  it('resolves the referrer compactly - a verified/invalid status only, never a name or contact', async () => {
    vi.mocked(getGenealogy).mockResolvedValue([node(OST_A, 'ANA SANTOS', 'ost')]);
    vi.mocked(resolveAaNumber).mockResolvedValue({
      member: {
        staffId: OST_A,
        fullName: 'ANA SANTOS',
        role: 'ost',
        aaNumber: 'AAO26100001',
        kind: 'OST',
        status: 'accredited',
      },
    });
    renderNewRecommender();
    fireEvent.change(screen.getByLabelText('OST Referrer AA number'), {
      target: { value: 'AAO26100001' },
    });
    expect(await screen.findByText('✓ Verified')).toBeVisible();
    expect(screen.queryByText(/ANA SANTOS/)).not.toBeInTheDocument();
  });

  it('rejects a referrer and recommender who do not share a sales team', async () => {
    vi.mocked(getGenealogy).mockResolvedValue([
      node(OST_A, 'ANA SANTOS', 'ost', { uplineStaffId: SM_A }),
      node(SM_A, 'BEN CRUZ', 'sales_manager'),
      node(OST_B, 'CARLA REYES', 'ost', { uplineStaffId: 'sm-b' }),
      node('sm-b', 'DAN TORRES', 'sales_manager'),
    ]);
    vi.mocked(resolveAaNumber).mockImplementation(async (aaNumber) =>
      aaNumber === 'AAO26100001'
        ? {
            member: {
              staffId: OST_A,
              fullName: 'ANA SANTOS',
              role: 'ost',
              aaNumber,
              kind: 'OST',
              status: 'accredited',
            },
          }
        : {
            member: {
              staffId: OST_B,
              fullName: 'CARLA REYES',
              role: 'ost',
              aaNumber,
              kind: 'OST',
              status: 'accredited',
            },
          },
    );
    renderNewRecommender();
    fireEvent.change(screen.getByLabelText('OST Referrer AA number'), {
      target: { value: 'AAO26100001' },
    });
    await screen.findByText('✓ Verified');
    fireEvent.change(screen.getByLabelText('OST VIP recommender AA number'), {
      target: { value: 'AAO26100002' },
    });
    expect(
      await screen.findByText(/referrer and VIP recommender belong to different teams/),
    ).toBeVisible();
  });
});
