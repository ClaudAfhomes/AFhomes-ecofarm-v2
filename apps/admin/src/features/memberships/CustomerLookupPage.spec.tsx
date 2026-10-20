import { fireEvent, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useLocation } from 'react-router';
import { CustomerLookupPage } from './CustomerLookupPage';
import { renderWithProviders } from '../../test/utils';
import { requestList } from '../../lib/api/client';
import { getCustomerById } from '../business/services';
import { RequireRole } from '../../app/RequireRole';

vi.mock('../../lib/api/client', () => ({
  requestList: vi.fn(),
  setApiAccessTokenForTests: vi.fn(),
}));
vi.mock('../business/services', () => ({
  getCustomerById: vi.fn(),
}));

/**
 * Customer Lookup, the GSD/Employee desk.
 *
 * The rule these tests exist to pin is the one that separates this screen from the
 * member-TRANSACTION lookup it replaced in the nav: NO Membership Code is ever
 * displayed. Not current, not legacy, not in the `AFHOMES:` envelope. That is a
 * business rule (a Membership Code is a transaction credential, not a customer-search
 * key), so it is asserted on the rendered output rather than left to review.
 */

const PROSPECT = {
  customerId: '11111111-1111-4111-8111-111111111111',
  customerNumber: 'AF-CUS-00042',
  customerCode: 'AF-CC-1A2B3C4D',
  fullName: 'PROSPECT DELA CRUZ',
  customerStatus: 'prospect' as const,
  tier: null,
  membershipStatus: null,
  membershipExpiresAt: null,
  category: 'PENDING' as const,
};

const FULL_PROSPECT = {
  id: '11111111-1111-4111-8111-111111111111',
  customerNumber: 'AF-CUS-00042',
  customerCode: 'AF-CC-1A2B3C4D',
  fullName: 'PROSPECT DELA CRUZ',
  status: 'prospect',
  paymentStatus: 'no_payment',
  tier: null,
  statedVipPackage: null,
  membershipExpiresAt: null,
  supplementaryFullName: null,
  derivedCategory: 'PENDING',
} as any;

/** Type, wait for the matching suggestion, and pick it: the only path to a card. */
async function pickOption(name: RegExp) {
  const option = await screen.findByRole('option', { name });
  fireEvent.mouseDown(option);
}

function LocationProbe() {
  const location = useLocation();
  return (
    <p aria-label="route">
      {location.pathname}
      {location.search}
    </p>
  );
}

beforeEach(() => {
  vi.mocked(getCustomerById).mockReset();
  vi.mocked(getCustomerById).mockResolvedValue(FULL_PROSPECT);
});

it('shows a non-member customer with the two statuses kept separate', async () => {
  vi.mocked(requestList).mockResolvedValue([PROSPECT]);
  renderWithProviders(<CustomerLookupPage />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Find customer' }), {
    target: { value: 'DELA' },
  });
  await pickOption(/PROSPECT DELA CRUZ/);
  expect(screen.getByRole('heading', { name: 'PROSPECT DELA CRUZ' })).toBeInTheDocument();
  // The identifiers share one paragraph, so assert on the row's text rather than on
  // an exact-match element, which would fail for a formatting reason.
  const row = screen.getByRole('heading', { name: 'PROSPECT DELA CRUZ' }).closest('article');
  expect(row).toHaveTextContent('AF-CUS-00042');
  expect(row).toHaveTextContent('AF-CC-1A2B3C4D');
  // A prospect holds no membership: that is stated, not left as an empty cell.
  expect(row).toHaveTextContent('None');
});

it('never renders a Membership Code, whatever the search term was', async () => {
  vi.mocked(requestList).mockResolvedValue([
    { ...PROSPECT, customerStatus: 'active' as const, tier: 'GOLD', membershipStatus: 'suspended' },
  ]);
  renderWithProviders(<CustomerLookupPage />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Find customer' }), {
    // The term a user would paste from a printed card.
    target: { value: 'MBS-000004' },
  });
  // A code matches no name, so the list itself says the customer does not
  // exist — and with nothing picked, no card renders at all.
  expect(await screen.findByText('Customer does not exist')).toBeInTheDocument();
  expect(screen.queryByRole('article')).toBeNull();
});

it('shows a suspended member record without ever printing a code', async () => {
  vi.mocked(requestList).mockResolvedValue([
    {
      ...PROSPECT,
      customerStatus: 'active' as const,
      tier: 'GOLD',
      membershipStatus: 'suspended' as const,
    },
  ]);
  vi.mocked(getCustomerById).mockResolvedValue({
    ...FULL_PROSPECT,
    tier: 'GOLD',
    membershipStatus: 'suspended',
    paymentStatus: 'fully_paid',
    membershipExpiresAt: '2031-10-11',
  } as any);
  renderWithProviders(<CustomerLookupPage />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Find customer' }), {
    target: { value: 'DEL' },
  });
  await pickOption(/PROSPECT DELA CRUZ/);
  // The member's status is shown in place of the code.
  const row = screen.getByRole('heading', { name: 'PROSPECT DELA CRUZ' }).closest('article');
  expect(row?.textContent).toMatch(/suspended/i);
  expect(row?.textContent).not.toMatch(/MBS-/);
  expect(row?.textContent).not.toMatch(/AFHOMES:/);
  // Payment status, VIP tier and validity are shown as separate facts.
  expect(row).toHaveTextContent('Payment Status');
  expect(row).toHaveTextContent('VIP Tier');
  expect(row).toHaveTextContent('Validity');
});

it('queries the customer-lookup endpoint, not the member-transaction lookup', async () => {
  vi.mocked(requestList).mockReset();
  vi.mocked(requestList).mockResolvedValue([]);
  renderWithProviders(<CustomerLookupPage />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Find customer' }), {
    target: { value: 'AF-CC-1A2B3C4D' },
  });
  // Nothing on file: the dropdown row and the empty panel agree.
  const notices = await screen.findAllByText('Customer does not exist');
  expect(notices).toHaveLength(2);
  expect(vi.mocked(requestList).mock.calls[0]?.[0]).toContain('/memberships/customer-lookup');
});

it('prompts for more characters below the minimum instead of querying', async () => {
  vi.mocked(requestList).mockReset();
  renderWithProviders(<CustomerLookupPage />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Find customer' }), {
    target: { value: 'A' },
  });
  expect(
    screen.getByText('Enter at least two characters to find a customer or member'),
  ).toBeInTheDocument();
  expect(vi.mocked(requestList)).not.toHaveBeenCalled();
});

it.each(['employee', 'admin', 'super_admin'])(
  'preserves authorized direct lookup for %s',
  async (roleSlug) => {
    renderWithProviders(
      <RequireRole>
        <CustomerLookupPage />
      </RequireRole>,
      {
        route: roleSlug === 'employee' ? '/employee/customer-lookup' : '/admin/customer-lookup',
        user: {
          id: 'qa-staff',
          name: 'QA STAFF',
          email: 'qa@example.test',
          roleId: 'qa-role',
          roleSlug,
          roleName: roleSlug,
          status: 'active',
          afHomesPermissions: [
            {
              moduleKey: 'operations.customer_lookup',
              canView: true,
              canCreate: false,
              canUpdate: false,
              canDelete: false,
            },
          ],
        },
      },
    );
    expect(await screen.findByRole('heading', { name: 'Membership Lookup' })).toBeInTheDocument();
    expect(screen.queryByText('Customer Lookup')).not.toBeInTheDocument();
  },
);
it('refuses the direct lookup to a role holding only the till permission', async () => {
  // The screen has its own module; the redemption till key must not open it.
  renderWithProviders(
    <RequireRole>
      <CustomerLookupPage />
    </RequireRole>,
    {
      route: '/admin/customer-lookup',
      user: {
        id: 'qa-till',
        name: 'QA TILL',
        email: 'till@example.test',
        roleId: 'qa-role',
        roleSlug: 'employee',
        roleName: 'Employee',
        status: 'active',
        afHomesPermissions: [
          {
            moduleKey: 'operations.redemption',
            canView: true,
            canCreate: false,
            canUpdate: false,
            canDelete: false,
          },
        ],
      },
    },
  );
  expect(screen.queryByRole('heading', { name: 'Membership Lookup' })).not.toBeInTheDocument();
});
it('denies the direct lookup to a customer without staff permissions', async () => {
  renderWithProviders(
    <RequireRole>
      <CustomerLookupPage />
    </RequireRole>,
    {
      route: '/admin/customer-lookup',
      user: {
        id: 'qa-customer',
        name: 'QA CUSTOMER',
        email: 'qa@example.test',
        roleId: 'qa-role',
        roleSlug: 'customer',
        roleName: 'Customer',
        status: 'active',
        afHomesPermissions: [],
      },
    },
  );
  expect(await screen.findByText('Access denied')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Membership Lookup' })).not.toBeInTheDocument();
});

it('searches live with no Search button to click', async () => {
  vi.mocked(requestList).mockResolvedValue([PROSPECT]);
  renderWithProviders(<CustomerLookupPage />);
  expect(screen.queryByRole('button', { name: 'Search' })).toBeNull();
  fireEvent.change(screen.getByRole('combobox', { name: 'Find customer' }), {
    target: { value: 'DELA' },
  });
  // The debounced term flows straight into the query — no submit step — and
  // the match is suggested; only the pick puts the card on screen.
  await pickOption(/PROSPECT DELA CRUZ/);
  expect(screen.getByRole('heading', { name: 'PROSPECT DELA CRUZ' })).toBeInTheDocument();
  expect(vi.mocked(requestList).mock.calls[0]?.[0]).toContain(
    '/memberships/customer-lookup?search=DELA',
  );
});

it('shows suggestion skeletons while pending, with no card skeleton', async () => {
  vi.mocked(requestList).mockReturnValue(new Promise(() => {}));
  renderWithProviders(<CustomerLookupPage />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Find customer' }), {
    target: { value: 'DELA' },
  });
  // No card-level skeleton is rendered while the search resolves.
  expect(screen.queryByRole('status', { name: 'Looking for Customer' })).toBeNull();
  expect(screen.queryByRole('article')).toBeNull();
  // The pending dropdown mirrors real suggestion rows (name + meta bars).
  const listbox = await screen.findByRole('listbox', { name: 'Name suggestions' });
  expect(within(listbox).getAllByRole('presentation', { hidden: true })).toHaveLength(3);
  expect(screen.queryByText('Looking for Customer…')).toBeNull();
  expect(screen.queryByText('Searching for matches…')).toBeNull();
  expect(screen.queryByText('No matching customers or members')).not.toBeInTheDocument();
});

it.each([
  ['GOLD', 'Gold VIP membership card'],
  ['SILVER', 'Silver VIP membership card'],
  ['BRONZE', 'Bronze VIP membership card'],
] as const)('shows the %s card artwork on a %s member card', async (tier, alt) => {
  vi.mocked(requestList).mockResolvedValue([
    { ...PROSPECT, customerStatus: 'active' as const, tier, membershipStatus: 'active' as const },
  ]);
  renderWithProviders(<CustomerLookupPage />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Find customer' }), {
    target: { value: 'DELA' },
  });
  await pickOption(/PROSPECT DELA CRUZ/);
  expect(await screen.findByAltText(alt)).toBeInTheDocument();
  const card = screen.getByRole('heading', { name: 'PROSPECT DELA CRUZ' }).closest('article');
  expect(card).toHaveAttribute('data-tier', tier);
});

it('shows a cardless placeholder — never a tier image — for a prospect', async () => {
  vi.mocked(requestList).mockResolvedValue([PROSPECT]);
  renderWithProviders(<CustomerLookupPage />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Find customer' }), {
    target: { value: 'DELA' },
  });
  await pickOption(/PROSPECT DELA CRUZ/);
  await screen.findByRole('heading', { name: 'PROSPECT DELA CRUZ' });
  expect(screen.getByText('No card on file')).toBeInTheDocument();
  expect(screen.queryByRole('img')).toBeNull();
  const card = screen.getByRole('heading', { name: 'PROSPECT DELA CRUZ' }).closest('article');
  expect(card).toHaveAttribute('data-tier', 'NONE');
});

const MARIA = {
  ...PROSPECT,
  customerId: '22222222-2222-4222-8222-222222222222',
  customerNumber: 'AF-CUS-00043',
  customerCode: 'AF-CC-9Z8Y7X6W',
  fullName: 'MARIA SANTOS',
  customerStatus: 'active' as const,
  tier: 'GOLD',
  membershipStatus: 'active' as const,
  membershipExpiresAt: '2031-10-11',
  category: 'ACTIVE_VIP' as const,
};

describe('name suggestions', () => {
  it('suggests names matching the typed letters, prefix-first', async () => {
    vi.mocked(requestList).mockResolvedValue([PROSPECT, MARIA]);
    renderWithProviders(<CustomerLookupPage />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Find customer' }), {
      target: { value: 'MAR' },
    });
    const listbox = await screen.findByRole('listbox', { name: 'Name suggestions' });
    expect(listbox).toBeInTheDocument();
    // MARIA SANTOS starts with the typed letters; the prospect does not match.
    // Options land with the debounced fetch, after the pending-state listbox.
    expect(await screen.findByRole('option', { name: /MARIA SANTOS/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /PROSPECT DELA CRUZ/ })).toBeNull();
    // The matched letters are highlighted, not just listed.
    expect(await screen.findByText('MAR')).toBeInTheDocument();
  });

  it('shows the picked suggestion card on Enter', async () => {
    vi.mocked(requestList).mockResolvedValue([PROSPECT, MARIA]);
    renderWithProviders(<CustomerLookupPage />);
    const box = screen.getByRole('combobox', { name: 'Find customer' });
    fireEvent.change(box, { target: { value: 'MAR' } });
    await screen.findByRole('listbox', { name: 'Name suggestions' });
    await screen.findByRole('option', { name: /MARIA SANTOS/ });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box).toHaveValue('MARIA SANTOS');
    expect(screen.queryByRole('listbox', { name: 'Name suggestions' })).toBeNull();
    // The pick — not the typing — is what puts the card on screen.
    expect(await screen.findByRole('heading', { name: 'MARIA SANTOS' })).toBeInTheDocument();
  });

  it('picks the top suggestion on Enter with nothing highlighted', async () => {
    vi.mocked(requestList).mockResolvedValue([PROSPECT, MARIA]);
    renderWithProviders(<CustomerLookupPage />);
    const box = screen.getByRole('combobox', { name: 'Find customer' });
    fireEvent.change(box, { target: { value: 'MAR' } });
    await screen.findByRole('option', { name: /MARIA SANTOS/ });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box).toHaveValue('MARIA SANTOS');
    expect(await screen.findByRole('heading', { name: 'MARIA SANTOS' })).toBeInTheDocument();
  });

  it('closes the suggestions on Escape with no card shown', async () => {
    vi.mocked(requestList).mockResolvedValue([PROSPECT, MARIA]);
    renderWithProviders(<CustomerLookupPage />);
    const box = screen.getByRole('combobox', { name: 'Find customer' });
    fireEvent.change(box, { target: { value: 'MAR' } });
    await screen.findByRole('option', { name: /MARIA SANTOS/ });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Name suggestions' })).toBeNull();
    // Nothing was picked, so no card: the panel invites a pick instead.
    expect(screen.queryByRole('heading', { name: 'MARIA SANTOS' })).toBeNull();
    expect(
      await screen.findByText('Select a suggested name to view the record.'),
    ).toBeInTheDocument();
  });

  it('never prints codes inside the suggestion rows', async () => {
    vi.mocked(requestList).mockResolvedValue([PROSPECT, MARIA]);
    renderWithProviders(<CustomerLookupPage />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Find customer' }), {
      target: { value: 'DE' },
    });
    const listbox = await screen.findByRole('listbox', { name: 'Name suggestions' });
    // Wait for real options: the pending-state list holds no names to judge.
    await screen.findByRole('option', { name: /DELA CRUZ/ });
    expect(listbox.textContent).not.toMatch(/MBS-/);
    expect(listbox.textContent).not.toMatch(/AFHOMES:/);
    expect(listbox.textContent).not.toMatch(/AF-CUS-/);
    expect(listbox.textContent).not.toMatch(/AF-CC-/);
  });

  it('clears the shown card as soon as typing resumes', async () => {
    vi.mocked(requestList).mockResolvedValue([PROSPECT, MARIA]);
    renderWithProviders(<CustomerLookupPage />);
    const box = screen.getByRole('combobox', { name: 'Find customer' });
    fireEvent.change(box, { target: { value: 'DEL' } });
    await pickOption(/PROSPECT DELA CRUZ/);
    expect(screen.getByRole('heading', { name: 'PROSPECT DELA CRUZ' })).toBeInTheDocument();
    // The next keystroke unpicks synchronously — the old card never lingers
    // beside suggestions for a different term.
    fireEvent.change(box, { target: { value: 'DELA' } });
    expect(screen.queryByRole('heading', { name: 'PROSPECT DELA CRUZ' })).toBeNull();
    expect(
      await screen.findByText('Select a suggested name to view the record.'),
    ).toBeInTheDocument();
  });
});

it('offers no mutating control at all', async () => {
  vi.mocked(requestList).mockResolvedValue([PROSPECT]);
  renderWithProviders(<CustomerLookupPage />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Find customer' }), {
    target: { value: 'DELA' },
  });
  await pickOption(/PROSPECT DELA CRUZ/);
  await screen.findByRole('heading', { name: 'PROSPECT DELA CRUZ' });
  // Read-only by construction: a GSD operator looking up a customer has no button
  // that could edit one, take a payment or spend points.
  expect(screen.queryByRole('button', { name: /edit|activate|payment|redeem/i })).toBeNull();
});


