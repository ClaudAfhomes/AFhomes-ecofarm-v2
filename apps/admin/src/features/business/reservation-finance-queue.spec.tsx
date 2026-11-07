import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SessionUser } from '../../lib/session';
import { BusinessFinanceQueuePage } from './BusinessFinanceQueuePage';

/**
 * Task J: the application-origin workflow as Finance sees it.
 *
 * An executed reservation has no card sale, so every action here is a RESERVATION
 * action. What matters is that a reservation row is never treated as a sale row,
 * and that a stale "fully paid" in a browser cannot produce a sale.
 *
 * The fake is `fetch`, the same seam the rest of this suite uses: the real client,
 * the real schemas and the real component all run.
 */
const RES_ID = 'eeeeeeee-0000-4000-8000-0000000000e1';
const REQUEST_ID = 'dddddddd-0000-4000-8000-0000000000dd';

const RESERVATION_ROW = {
  origin: 'reservation',
  reservationId: RES_ID,
  reservationNumber: 'AF-RES-ZZZZZ',
  customerApplicationId: 'aaaaaaaa-0000-4000-8000-000000000001',
  applicationNumber: 'AF-APP-00000001',
  applicationStatus: 'approved',
  purchaseTermsId: '22222222-0000-4222-8222-222222222222',
  sellerStaffId: '11111111-1111-4111-8111-111111111111',
  sellerName: 'Ana Seller',
  tier: 'BRONZE',
  customerId: 'cccccccc-0000-4000-8000-000000000003',
  customerName: 'ANA CRUZ',
  productName: 'VIP BRONZE',
  status: 'executed',
  paymentScheme: 'spot_cash',
  totalPrice: '54000.00',
  reservationFee: '10000.00',
  requiredInitial: '10000.00',
  installmentMonths: null,
  monthlyAmount: null,
  validityMonths: 84,
  verifiedTotal: '0.00',
  remainingBalance: '54000.00',
  overpaidAmount: '0.00',
  recordedPaymentCount: 0,
  fullyPaid: false,
  firstVerifiedPayment: null,
  spotCashDeadline: null,
  saleId: null,
  activatable: false,
};

const RECORDED_PAYMENT = {
  id: '99999999-9999-4999-8999-999999999999',
  origin: 'reservation',
  saleId: null,
  reservationId: RES_ID,
  customerId: 'cccccccc-0000-4000-8000-000000000003',
  amount: '10000.00',
  paymentType: 'down_payment',
  method: 'cash',
  reference: 'REF-1',
  notes: null,
  status: 'recorded',
  rejectionReason: null,
  recordedBy: '22222222-2222-4222-8222-222222222222',
  verifiedBy: null,
  recordedAt: '2026-10-07T00:00:00.000Z',
  verifiedAt: null,
};

const FINANCE_USER = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'finance@example.test',
  fullName: 'Fae Finance',
  afHomesRole: 'finance',
  afHomesPermissions: [
    {
      moduleKey: 'finance.payment_verification',
      canView: true,
      canCreate: false,
      canUpdate: true,
      canDelete: false,
    },
    {
      moduleKey: 'sales.card_sales',
      canView: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    },
  ],
} as unknown as SessionUser;

const requests: { url: string; method: string; body: unknown }[] = [];
let queueRow: Record<string, unknown> = RESERVATION_ROW;

const ok = (data: unknown) =>
  new Response(JSON.stringify({ data, meta: { total: Array.isArray(data) ? data.length : 0 } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes('/queues/finance')) return ok([queueRow]);
    if (url.endsWith(`/reservations/${RES_ID}/payments`)) {
      return method === 'GET' ? ok([RECORDED_PAYMENT]) : ok([RECORDED_PAYMENT]);
    }
    if (url.includes('/documents/')) {
      return new Response(
        JSON.stringify({
          filename: 'AF-Homes-reservation.pdf',
          mime: 'application/pdf',
          content: 'JVBERi0=',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.includes('/finalize')) {
      return new Response(
        JSON.stringify({
          saleId: '77777777-0000-4000-8000-000000000077',
          reservationId: RES_ID,
          activationRequired: true,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
    return ok([]);
  });
}

beforeEach(() => {
  requests.length = 0;
  queueRow = RESERVATION_ROW;
  vi.stubGlobal('fetch', mockFetch());
  // The download path needs an object URL; jsdom has none.
  URL.createObjectURL = () => 'blob:stub';
  URL.revokeObjectURL = () => {};
});

const renderQueue = (user: SessionUser = FINANCE_USER) =>
  renderWithProviders(<BusinessFinanceQueuePage />, { user });

/** Row actions live behind the three-dots menu: open it, then pick an item. */
async function openRowMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Actions for AF-RES-ZZZZZ' }));
}

async function pickMenuItem(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('menuitem', { name }));
}

describe('Finance queue with an application-origin reservation', () => {
  it('lists the executed AF-RES and never a sale number', async () => {
    renderQueue();
    expect(await screen.findByText('AF-RES-ZZZZZ')).toBeTruthy();
    expect(screen.queryByText(/AF-CSALE/)).toBeNull();
  });

  it('shows the outstanding balance on the row with a capitalized badge', async () => {
    renderQueue();
    expect(await screen.findByText('AF-RES-ZZZZZ')).toBeTruthy();
    expect(screen.getByText('₱54,000.00')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.queryByText('executed')).toBeNull();
  });

  it('reads the one ledger by reservation, never by a sale id', async () => {
    const user = userEvent.setup();
    renderQueue();
    await screen.findByText('AF-RES-ZZZZZ');
    await openRowMenu(user);
    await pickMenuItem(user, 'Verify');
    await waitFor(() => {
      expect(requests.map((r) => r.url).filter((u) => u.includes('/sales/'))).toEqual([]);
      expect(
        requests.map((r) => r.url).filter((u) => u.endsWith(`/reservations/${RES_ID}/payments`)),
      ).toHaveLength(1);
    });
  });

  it('offers Print reservation and withholds Finalize while money is short', async () => {
    const user = userEvent.setup();
    renderQueue();
    await screen.findByText('AF-RES-ZZZZZ');
    await openRowMenu(user);
    const print = await screen.findByRole('menuitem', { name: /print reservation/i });
    expect(print.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByRole('menuitem', { name: /finalize purchase/i })).toBeNull();
  });

  it('offers Finalize only when the server-reported figures say fully paid', async () => {
    const user = userEvent.setup();
    queueRow = {
      ...RESERVATION_ROW,
      verifiedTotal: '54000.00',
      remainingBalance: '0.00',
      fullyPaid: true,
    };
    renderQueue();
    await screen.findByText('AF-RES-ZZZZZ');
    await openRowMenu(user);
    expect(await screen.findByRole('menuitem', { name: /finalize purchase/i })).toBeTruthy();
  });

  it('keeps Finalize disabled for a principal without the finance update grant', async () => {
    const user = userEvent.setup();
    queueRow = {
      ...RESERVATION_ROW,
      verifiedTotal: '54000.00',
      remainingBalance: '0.00',
      fullyPaid: true,
    };
    renderQueue({
      ...FINANCE_USER,
      afHomesPermissions: FINANCE_USER.afHomesPermissions.map((p) => ({ ...p, canUpdate: false })),
    } as SessionUser);
    await screen.findByText('AF-RES-ZZZZZ');
    await openRowMenu(user);
    const finalize = await screen.findByRole('menuitem', { name: /finalize purchase/i });
    expect(finalize.hasAttribute('disabled')).toBe(true);
    expect(requests.some((r) => r.url.includes('/finalize'))).toBe(false);
  });

  it('finalizes through the server and never constructs a sale locally', async () => {
    const user = userEvent.setup();
    queueRow = {
      ...RESERVATION_ROW,
      verifiedTotal: '54000.00',
      remainingBalance: '0.00',
      fullyPaid: true,
    };
    renderQueue();
    await screen.findByText('AF-RES-ZZZZZ');
    await openRowMenu(user);
    await pickMenuItem(user, 'Finalize purchase');
    await waitFor(() => {
      const call = requests.find((r) => r.url.includes('/finalize'));
      expect(call?.method).toBe('POST');
      // The browser asserts a request identity and nothing else.
      expect(Object.keys(call?.body ?? {}).sort()).toEqual(['requestId']);
      expect(REQUEST_ID).not.toBe('');
    });
  });

  it('reprints from the captured revision, not from a live view', async () => {
    const user = userEvent.setup();
    renderQueue();
    await screen.findByText('AF-RES-ZZZZZ');
    await openRowMenu(user);
    await pickMenuItem(user, 'Print reservation');
    await waitFor(() => {
      const issued = requests.map((r) => r.url).filter((u) => u.includes('/documents/'));
      // The client prefixes the API base, so match on the tail, not the whole URL.
      expect(issued.map((u) => u.slice(u.indexOf('/official-forms')))).toEqual([
        `/official-forms/reservations/${RES_ID}/documents/reservation/latest`,
      ]);
    });
  });

  it('opens the reservation details by clicking the row', async () => {
    renderQueue();
    await screen.findByText('AF-RES-ZZZZZ');
    fireEvent.click(
      screen.getByRole('link', { name: 'Record a reservation payment for AF-RES-ZZZZZ' }),
    );
    expect(await screen.findByText('Reservation figures')).toBeInTheDocument();
  });

  it('opens the full reservation details from the row menu, never Verify', async () => {
    const user = userEvent.setup();
    renderQueue();
    await screen.findByText('AF-RES-ZZZZZ');
    await openRowMenu(user);
    await pickMenuItem(user, 'View details');
    // Figures, parties and status — not the Verify action.
    expect(await screen.findByText('Reservation figures')).toBeInTheDocument();
    const detail = within(screen.getByRole('dialog'));
    expect(detail.getAllByText('₱54,000.00')).toHaveLength(2);
    expect(detail.getByText('Ana Seller')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Verify$/i })).toBeNull();
    // The ledger rows carry capitalized payment badges, never raw codes.
    expect(await screen.findByText('Recorded')).toBeInTheDocument();
    expect(screen.getByText(/REF-1/)).toBeInTheDocument();
  });
});
it('offers reservation recording and verification controls', async () => {
  const user = userEvent.setup();
  renderQueue();
  await screen.findByText('AF-RES-ZZZZZ');
  await openRowMenu(user);
  expect(screen.getByRole('menuitem', { name: /^Record payment$/i })).toBeTruthy();
  expect(screen.getByRole('menuitem', { name: /^Verify$/i })).toBeTruthy();
});
