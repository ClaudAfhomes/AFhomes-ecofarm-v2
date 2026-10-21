import { fireEvent, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CustomerLookupPage } from './CustomerLookupPage';
import { renderWithProviders } from '../../test/utils';
import { requestList, protectedRequest } from '../../lib/api/client';
import { RequireRole } from '../../app/RequireRole';

vi.mock('../../lib/api/client', () => ({
  requestList: vi.fn(),
  protectedRequest: vi.fn(),
  setApiAccessTokenForTests: vi.fn(),
}));

const JUAN = {
  firstName: 'Juan',
  maskedLastName: 'D***',
  vipTier: 'GOLD' as const,
  validUntil: '2033-10-21',
};

const MARIA = {
  firstName: 'Maria',
  maskedLastName: 'S***',
  vipTier: 'SILVER' as const,
  validUntil: '2031-10-11',
};

/** Type, wait for the matching suggestion, and pick it: the only path to a card. */
async function pickOption(name: RegExp) {
  const option = await screen.findByRole('option', { name });
  fireEvent.mouseDown(option);
}

beforeEach(() => {
  vi.mocked(requestList).mockReset();
  vi.mocked(protectedRequest).mockReset();
});

it('shows an active VIP customer with only the four approved fields', async () => {
  vi.mocked(requestList).mockResolvedValue([JUAN]);
  renderWithProviders(<CustomerLookupPage />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Find customer' }), {
    target: { value: 'JUA' },
  });
  await pickOption(/Juan D\*\*\*/);
  const card = (await screen.findByRole('heading', { name: /Juan D\*\*\*/ })).closest('article');
  expect(card).toHaveTextContent('Juan D***');
  expect(card).toHaveTextContent('GOLD');
  expect(card).toHaveTextContent('2033-10-21');
  // No identifiers or private fields anywhere on the card.
  expect(card?.textContent).not.toMatch(/AF-CUS-/);
  expect(card?.textContent).not.toMatch(/AF-CC-/);
  expect(card?.textContent).not.toMatch(/MBS-/);
  expect(card?.textContent).not.toMatch(/Payment Status/);
});

it('never renders a Membership Code, whatever the search term was', async () => {
  vi.mocked(requestList).mockResolvedValue([]);
  renderWithProviders(<CustomerLookupPage />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Find customer' }), {
    target: { value: 'MBS-000004' },
  });
  const notices = await screen.findAllByText('No active VIP customer found');
  expect(notices.length).toBeGreaterThan(0);
  expect(screen.queryByRole('article')).toBeNull();
});

it('queries the customer-lookup endpoint, not the member-transaction lookup', async () => {
  vi.mocked(requestList).mockResolvedValue([]);
  renderWithProviders(<CustomerLookupPage />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Find customer' }), {
    target: { value: 'AF-CC-1A2B3C4D' },
  });
  const notices = await screen.findAllByText('No active VIP customer found');
  expect(notices.length).toBeGreaterThan(0);
  expect(vi.mocked(requestList).mock.calls[0]?.[0]).toContain('/memberships/customer-lookup');
});

it('prompts for more characters below the minimum instead of querying', async () => {
  vi.mocked(requestList).mockReset();
  renderWithProviders(<CustomerLookupPage />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Find customer' }), {
    target: { value: 'A' },
  });
  expect(
    screen.getByText('Enter at least two characters to find an active VIP customer'),
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
    expect(await screen.findByRole('heading', { name: 'Customer Lookup' })).toBeInTheDocument();
  },
);

it('refuses the direct lookup to a role holding only the till permission', async () => {
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
  expect(screen.queryByRole('heading', { name: 'Customer Lookup' })).not.toBeInTheDocument();
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
  expect(screen.queryByRole('heading', { name: 'Customer Lookup' })).not.toBeInTheDocument();
});

it('searches live with no Search button to click', async () => {
  vi.mocked(requestList).mockResolvedValue([JUAN]);
  renderWithProviders(<CustomerLookupPage />);
  expect(screen.queryByRole('button', { name: 'Search' })).toBeNull();
  fireEvent.change(screen.getByRole('combobox', { name: 'Find customer' }), {
    target: { value: 'JUA' },
  });
  await pickOption(/Juan D\*\*\*/);
  expect(await screen.findByRole('heading', { name: /Juan D\*\*\*/ })).toBeInTheDocument();
  expect(vi.mocked(requestList).mock.calls[0]?.[0]).toContain(
    '/memberships/customer-lookup?search=JUA',
  );
});

it('shows suggestion skeletons while pending, with no card skeleton', async () => {
  vi.mocked(requestList).mockReturnValue(new Promise(() => {}));
  renderWithProviders(<CustomerLookupPage />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Find customer' }), {
    target: { value: 'JUA' },
  });
  const listbox = await screen.findByRole('listbox', { name: 'Name suggestions' });
  expect(within(listbox).getAllByRole('presentation', { hidden: true })).toHaveLength(3);
  expect(screen.queryByRole('article')).toBeNull();
});

it.each([
  ['GOLD', 'Gold VIP membership card'],
  ['SILVER', 'Silver VIP membership card'],
  ['BRONZE', 'Bronze VIP membership card'],
] as const)('shows the %s card artwork on a %s member card', async (tier, alt) => {
  const row = { ...JUAN, vipTier: tier as 'GOLD' | 'SILVER' | 'BRONZE' };
  vi.mocked(requestList).mockResolvedValue([row]);
  renderWithProviders(<CustomerLookupPage />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Find customer' }), {
    target: { value: 'JUA' },
  });
  await pickOption(new RegExp(`Juan D\\*\\*\\*`));
  expect(await screen.findByAltText(alt)).toBeInTheDocument();
  const card = (await screen.findByRole('heading', { name: /Juan D\*\*\*/ })).closest('article');
  expect(card).toHaveAttribute('data-tier', tier);
});

it('shows suggestion rows with masked names only', async () => {
  vi.mocked(requestList).mockResolvedValue([JUAN, MARIA]);
  renderWithProviders(<CustomerLookupPage />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Find customer' }), {
    target: { value: 'A' },
  });
  // need 2 chars
  fireEvent.change(screen.getByRole('combobox', { name: 'Find customer' }), {
    target: { value: 'MA' },
  });
  const listbox = await screen.findByRole('listbox', { name: 'Name suggestions' });
  await screen.findByRole('option', { name: /Maria S\*\*\*/ });
  expect(listbox.textContent).not.toMatch(/AF-CUS-/);
  expect(listbox.textContent).not.toMatch(/AF-CC-/);
  expect(listbox.textContent).not.toMatch(/MBS-/);
});

describe('name suggestions', () => {
  it('suggests names matching the typed letters, prefix-first', async () => {
    vi.mocked(requestList).mockResolvedValue([JUAN, MARIA]);
    renderWithProviders(<CustomerLookupPage />);
    const box = screen.getByRole('combobox', { name: 'Find customer' });
    fireEvent.change(box, { target: { value: 'MA' } });
    expect(await screen.findByRole('option', { name: /Maria S\*\*\*/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Juan D\*\*\*/ })).toBeNull();
  });

  it('shows the picked suggestion card on Enter', async () => {
    vi.mocked(requestList).mockResolvedValue([JUAN, MARIA]);
    renderWithProviders(<CustomerLookupPage />);
    const box = screen.getByRole('combobox', { name: 'Find customer' });
    fireEvent.change(box, { target: { value: 'MA' } });
    await screen.findByRole('option', { name: /Maria S\*\*\*/ });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box).toHaveValue('Maria S***');
    expect(await screen.findByRole('heading', { name: /Maria S\*\*\*/ })).toBeInTheDocument();
  });

  it('picks the top suggestion on Enter with nothing highlighted', async () => {
    vi.mocked(requestList).mockResolvedValue([JUAN, MARIA]);
    renderWithProviders(<CustomerLookupPage />);
    const box = screen.getByRole('combobox', { name: 'Find customer' });
    fireEvent.change(box, { target: { value: 'MA' } });
    await screen.findByRole('option', { name: /Maria S\*\*\*/ });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box).toHaveValue('Maria S***');
    expect(await screen.findByRole('heading', { name: /Maria S\*\*\*/ })).toBeInTheDocument();
  });

  it('closes the suggestions on Escape with no card shown', async () => {
    vi.mocked(requestList).mockResolvedValue([JUAN, MARIA]);
    renderWithProviders(<CustomerLookupPage />);
    const box = screen.getByRole('combobox', { name: 'Find customer' });
    fireEvent.change(box, { target: { value: 'MA' } });
    await screen.findByRole('option', { name: /Maria S\*\*\*/ });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Name suggestions' })).toBeNull();
    expect(screen.queryByRole('heading', { name: /Maria S\*\*\*/ })).toBeNull();
  });

  it('clears the shown card as soon as typing resumes', async () => {
    vi.mocked(requestList).mockResolvedValue([JUAN, MARIA]);
    renderWithProviders(<CustomerLookupPage />);
    const box = screen.getByRole('combobox', { name: 'Find customer' });
    fireEvent.change(box, { target: { value: 'MA' } });
    await pickOption(/Maria S\*\*\*/);
    expect(await screen.findByRole('heading', { name: /Maria S\*\*\*/ })).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'MAR' } });
    expect(screen.queryByRole('heading', { name: /Maria S\*\*\*/ })).toBeNull();
  });
});

it('offers no mutating control at all', async () => {
  vi.mocked(requestList).mockResolvedValue([JUAN]);
  renderWithProviders(<CustomerLookupPage />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Find customer' }), {
    target: { value: 'JUA' },
  });
  await pickOption(/Juan D\*\*\*/);
  await screen.findByRole('heading', { name: /Juan D\*\*\*/ });
  expect(screen.queryByRole('button', { name: /edit|activate|payment|redeem/i })).toBeNull();
});