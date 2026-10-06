import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AfHomesPermission, DashboardQueues } from '@afhomes/contracts';

import { renderWithProviders } from '../../test/utils';
import type { SessionUser } from '../../lib/session';
import { AfHomesQueueCards, QueueCard } from './AfHomesQueueCards';

const getQueues = vi.hoisted(() => vi.fn());
vi.mock('./services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services')>();
  return { ...actual, getAfHomesDashboardQueues: getQueues };
});

const permission = (moduleKey: AfHomesPermission['moduleKey']): AfHomesPermission => ({
  moduleKey,
  canView: true,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
});

const user = (modules: AfHomesPermission['moduleKey'][]): SessionUser => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Test User',
  email: 'test@afhomes.test',
  roleId: 'r-test',
  roleName: 'Test',
  status: 'active',
  afHomesPermissions: [
    permission('dashboard.view'),
    ...modules.map((moduleKey) => permission(moduleKey)),
  ],
});

const ADMIN = user(['network.ost_members', 'network.ost_registrations', 'finance.payment_verification']);
const FINANCE = user(['finance.payment_verification']);
const SELLER = user(['sales.card_sales']);

const queues = (over: Partial<DashboardQueues> = {}): DashboardQueues => ({
  ostMembers: 25,
  ostApplications: 3,
  paymentVerification: 5,
  ...over,
});

beforeEach(() => {
  getQueues.mockReset();
  getQueues.mockResolvedValue(queues());
});

const renderCards = (as: SessionUser = ADMIN) => renderWithProviders(<AfHomesQueueCards />, { user: as });

describe('QueueCard', () => {
  it('renders the JAD card grammar with an accessible pending label', () => {
    renderWithProviders(
      <QueueCard to="/admin/x" label="OST Applications" icon="user" description="d" data={3} />,
    );
    expect(screen.getByRole('link', { name: 'OST Applications: 3 pending' })).toBeInTheDocument();
  });
});

describe('AfHomesQueueCards (JAD QueueCard parity)', () => {
  it('1/2. renders the OST Members stat with its total and a registered chip', async () => {
    renderCards();
    const card = await screen.findByRole('link', { name: 'OST Members: 25 total' });
    expect(card).toBeInTheDocument();
    expect(card).toHaveAttribute('href', '/admin/ost/members');
    expect(screen.getByText('registered')).toBeInTheDocument();
    expect(screen.getByText('Total registered OST members')).toBeInTheDocument();
  });

  it('3/4/6/7. renders action queues with pending counts and action-needed chips', async () => {
    renderCards();
    expect(await screen.findByRole('link', { name: 'OST Applications: 3 pending' })).toHaveAttribute(
      'href',
      '/admin/ost/applications',
    );
    expect(
      await screen.findByRole('link', { name: 'Payment Verification: 5 pending' }),
    ).toHaveAttribute('href', '/admin/finance/payments');
    expect(screen.getAllByText('action needed')).toHaveLength(2);
  });

  it('5/8. shows clear chips when an action queue is empty', async () => {
    getQueues.mockResolvedValue(queues({ ostApplications: 0, paymentVerification: 0 }));
    renderCards();
    expect(await screen.findByRole('link', { name: 'OST Applications: 0 pending' })).toBeInTheDocument();
    expect(screen.getAllByText('clear')).toHaveLength(2);
  });

  it('9. sorts action queues highest-pending-first', async () => {
    getQueues.mockResolvedValue(queues({ ostMembers: 1, ostApplications: 1, paymentVerification: 5 }));
    const { container } = renderCards();
    await screen.findByText('Payment Verification');
    const links = [...container.querySelectorAll('a')].map((a) => a.getAttribute('aria-label'));
    expect(links).toEqual([
      'OST Members: 1 total',
      'Payment Verification: 5 pending',
      'OST Applications: 1 pending',
    ]);
  });

  it('10. keeps the stat card first even when an action queue is larger', async () => {
    getQueues.mockResolvedValue(queues({ ostMembers: 2, ostApplications: 9, paymentVerification: 1 }));
    const { container } = renderCards();
    await screen.findByText('OST Members');
    const first = container.querySelector('ul a')?.getAttribute('aria-label');
    expect(first).toBe('OST Members: 2 total');
  });

  it('11. hides cards the caller cannot access', async () => {
    const { container } = renderCards(FINANCE);
    expect(await screen.findByText('Payment Verification')).toBeInTheDocument();
    expect(screen.queryByText('OST Members')).toBeNull();
    expect(screen.queryByText('OST Applications')).toBeNull();
    expect(container.querySelectorAll('a')).toHaveLength(1);
  });

  it('11b. renders nothing when no queue is permitted', async () => {
    const { container } = renderCards(SELLER);
    await waitFor(() => {
      expect(getQueues).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(container.textContent).toBe('');
    });
    expect(screen.queryByText('All clear')).toBeNull();
  });

  it('12. shows skeletons without flashing zero counts while loading', () => {
    getQueues.mockReturnValue(new Promise(() => {}));
    const { container } = renderCards();
    expect(screen.getByRole('status')).toHaveTextContent('Loading queues…');
    expect(screen.queryByText('OST Members')).toBeNull();
    expect(container.querySelectorAll('ul[aria-hidden="true"] li')).toHaveLength(3);
  });

  it('13. surfaces queue errors with retry and renders no fake zeros', async () => {
    const operator = userEvent.setup();
    getQueues.mockRejectedValueOnce(new Error('boom'));
    const { container } = renderCards();
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(container.querySelector('a')).toBeNull();
    expect(screen.queryByText('OST Members')).toBeNull();
    await operator.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('OST Members')).toBeInTheDocument();
  });

  it('14/15. shows All clear when every visible action queue is 0, stat aside', async () => {
    getQueues.mockResolvedValue(queues({ ostMembers: 25, ostApplications: 0, paymentVerification: 0 }));
    renderCards();
    expect(await screen.findByText('All clear')).toBeInTheDocument();
    expect(screen.getByText('No pending items for your role.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'OST Members: 25 total' })).toBeInTheDocument();
  });

  it('16. never renders a Withdrawals card or route', async () => {
    renderCards();
    await screen.findByText('OST Members');
    expect(screen.queryByText(/withdrawal/i)).toBeNull();
    expect(document.querySelector('a[href*="withdraw"]')).toBeNull();
  });
});
