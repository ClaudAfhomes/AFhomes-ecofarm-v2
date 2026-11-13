import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen } from '../test/utils';
import type { SessionUser } from '../lib/session';
import { GlobalSearch } from './GlobalSearch';
import { MyWorkToday } from '../features/afhomes/MyWorkToday';

vi.mock('../features/business/services', () => ({
  getCustomersPage: vi.fn(async ({ search }: { search: string }) => ({
    data: search.startsWith('ana')
      ? [{ id: 'c-1', fullName: 'ANA SANTOS', customerNumber: 'AF-CUS-00001' }]
      : [],
    total: 1,
  })),
  getCustomerApplicationsPage: vi.fn(async (params: { search?: string; status?: string }) => ({
    data: params.search?.startsWith('AF-APP')
      ? [{ id: 'a-1', applicationNumber: 'AF-APP-0001', status: 'submitted', createdBy: 'sm-1' }]
      : params.search || params.status === 'submitted'
        ? []
        : [
            { id: 'a-2', applicationNumber: 'AF-APP-0002', status: 'draft', createdBy: 'sm-1' },
            { id: 'a-3', applicationNumber: 'AF-APP-0003', status: 'submitted', createdBy: 'other' },
          ],
    total: 7,
  })),
  getReservationAgreementsPage: vi.fn(async (params: { search?: string }) => ({
    data: params.search?.startsWith('AF-RSV')
      ? [{ id: 'r-1', reservationNumber: 'AF-RSV-0001' }]
      : [],
    total: 1,
  })),
  getActivationQueue: vi.fn(async () => ({
    items: [{ activatable: true }, { activatable: true }, { activatable: false }],
    total: 3,
  })),
}));
vi.mock('../features/afhomes/services', () => ({
  getAfHomesDashboardQueues: vi.fn(async () => ({
    ostMembers: null,
    ostApplications: null,
    paymentVerification: 4,
  })),
}));

type ModuleKey = SessionUser['afHomesPermissions'][number]['moduleKey'];
const perm = (moduleKey: ModuleKey, canUpdate = false) => ({
  moduleKey,
  canView: true,
  canCreate: false,
  canUpdate,
  canDelete: false,
});
const userWith = (roleSlug: string, modules: ModuleKey[], id = 'sm-1'): SessionUser => ({
  id,
  name: 'Tester',
  email: 't@example.com',
  roleId: 'r',
  roleSlug,
  roleName: roleSlug,
  status: 'active',
  afHomesPermissions: modules.map((m) => perm(m)),
});

describe('global search', () => {
  it('finds a customer, an application and a reservation and links to each record', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />, {
      user: userWith('admin', ['sales.customers', 'sales.card_sales']),
    });
    await user.type(screen.getByLabelText(/Search customers/), 'ana');
    expect(await screen.findByRole('link', { name: 'ANA SANTOS · Customer' })).toHaveAttribute(
      'href',
      '/admin/customers/c-1',
    );
    await user.clear(screen.getByLabelText(/Search customers/));
    await user.type(screen.getByLabelText(/Search customers/), 'AF-APP-0001');
    expect(await screen.findByRole('link', { name: 'AF-APP-0001 · Application' })).toHaveAttribute(
      'href',
      '/admin/customers/applications/a-1',
    );
    await user.clear(screen.getByLabelText(/Search customers/));
    await user.type(screen.getByLabelText(/Search customers/), 'AF-RSV-0001');
    expect(await screen.findByRole('link', { name: 'AF-RSV-0001 · Reservation' })).toHaveAttribute(
      'href',
      '/admin/sales/reservations/r-1',
    );
  });

  it('says there is no match and renders nothing without permission', async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<GlobalSearch />, {
      user: userWith('admin', ['sales.customers']),
    });
    await user.type(screen.getByLabelText(/Search customers/), 'zzz');
    expect(await screen.findByText('No match.')).toBeInTheDocument();
    unmount();
    const { container } = renderWithProviders(<GlobalSearch />, {
      user: userWith('hr', ['dashboard.view']),
    });
    expect(container).toBeEmptyDOMElement();
  });
});

describe('My work today', () => {
  it('Finance sees payments waiting and the count ready to activate', async () => {
    renderWithProviders(<MyWorkToday />, {
      user: userWith('finance', ['finance.payment_verification', 'finance.card_activation']),
    });
    expect(await screen.findByText('Payments waiting:')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Payments waiting/ })).toHaveTextContent('4');
    expect(await screen.findByRole('link', { name: /Ready to activate/ })).toHaveTextContent('2');
  });

  it('Admin sees applications awaiting approval', async () => {
    renderWithProviders(<MyWorkToday />, { user: userWith('admin', ['sales.customers']) });
    expect(await screen.findByRole('link', { name: /Applications awaiting approval/ })).toHaveTextContent('7');
  });

  it('an SM sees only their own applications and what each waits on', async () => {
    renderWithProviders(<MyWorkToday />, { user: userWith('sales_manager', ['sales.customers']) });
    expect(await screen.findByText(/AF-APP-0002/)).toBeInTheDocument();
    expect(screen.getByText(/draft: Upload signed application/)).toBeInTheDocument();
    expect(screen.queryByText(/AF-APP-0003/)).toBeNull();
  });

  it('renders nothing for a role with no queues', async () => {
    const { container } = renderWithProviders(<MyWorkToday />, {
      user: userWith('hr', ['dashboard.view']),
    });
    expect(container).toBeEmptyDOMElement();
  });
});
