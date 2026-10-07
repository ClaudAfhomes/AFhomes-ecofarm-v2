import { fireEvent, screen } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import { CustomerLookupPage } from './CustomerLookupPage';
import { renderWithProviders } from '../../test/utils';
import { requestList } from '../../lib/api/client';
import { RequireRole } from '../../app/RequireRole';

vi.mock('../../lib/api/client', () => ({
  requestList: vi.fn(),
  setApiAccessTokenForTests: vi.fn(),
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
  customerNumber: 'AF-CUS-00042',
  customerCode: 'AF-CC-1A2B3C4D',
  fullName: 'PROSPECT DELA CRUZ',
  customerStatus: 'prospect' as const,
  tier: null,
  membershipStatus: null,
  membershipExpiresAt: null,
  category: 'PENDING' as const,
};

it('shows a non-member customer with the two statuses kept separate', async () => {
  vi.mocked(requestList).mockResolvedValue([PROSPECT]);
  renderWithProviders(<CustomerLookupPage />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find customer' }), {
    target: { value: 'DELA' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByRole('heading', { name: 'PROSPECT DELA CRUZ' })).toBeInTheDocument();
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
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find customer' }), {
    // The term a user would paste from a printed card.
    target: { value: 'MBS-000004' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByRole('heading', { name: 'PROSPECT DELA CRUZ' })).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/MBS-/);
  expect(document.body.textContent).not.toMatch(/AFHOMES:/);
  // The member's status is shown in place of the code.
  const row = screen.getByRole('heading', { name: 'PROSPECT DELA CRUZ' }).closest('article');
  expect(row?.textContent).toMatch(/suspended/i);
  // Both statuses are present as separate rows, not merged into one value.
  expect(row).toHaveTextContent('Customer status');
  expect(row).toHaveTextContent('Membership status');
});

it('queries the customer-lookup endpoint, not the member-transaction lookup', async () => {
  vi.mocked(requestList).mockReset();
  vi.mocked(requestList).mockResolvedValue([]);
  renderWithProviders(<CustomerLookupPage />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find customer' }), {
    target: { value: 'AF-CC-1A2B3C4D' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await screen.findByText('No matching customers or members');
  expect(vi.mocked(requestList).mock.calls[0]?.[0]).toContain('/memberships/customer-lookup');
});

it('prompts for more characters below the minimum instead of querying', async () => {
  vi.mocked(requestList).mockReset();
  renderWithProviders(<CustomerLookupPage />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find customer' }), {
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
    expect(await screen.findByRole('heading', { name: 'Membership Lookup' })).toBeInTheDocument();
    expect(screen.queryByText('Customer Lookup')).not.toBeInTheDocument();
  },
);
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

it('offers no mutating control at all', async () => {
  vi.mocked(requestList).mockResolvedValue([PROSPECT]);
  renderWithProviders(<CustomerLookupPage />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find customer' }), {
    target: { value: 'DELA' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await screen.findByRole('heading', { name: 'PROSPECT DELA CRUZ' });
  // Read-only by construction: a GSD operator looking up a customer has no button
  // that could edit one, take a payment or spend points.
  expect(screen.queryByRole('button', { name: /edit|activate|payment|redeem/i })).toBeNull();
});
