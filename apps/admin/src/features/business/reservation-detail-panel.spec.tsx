import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SessionUser } from '../../lib/session';
import { Route, Routes } from 'react-router';

/**
 * Task J: the application-origin agreement screen after creation.
 *
 * The assertions are about what an operator is allowed to SEE and DO. Money is
 * whatever the server said; lifecycle buttons follow the state; and a rejected
 * payment must never be offered a verified receipt, because there is no verified
 * evidence to render.
 */
const RES_ID = 'eeeeeeee-0000-4000-8000-0000000000e1';
const SALE_ID = 'ffffffff-0000-4000-8000-0000000000f1';
const TERMS_ID = '00000000-0000-4000-8000-000000000009';

const calls = {
  createReservationAgreement: vi.fn(),
  submit: vi.fn(),
  decide: vi.fn(),
  reopen: vi.fn(),
  activate: vi.fn(),
  finalize: vi.fn(),
  preview: vi.fn(async () => ({
    kind: 'reservation_agreement' as const,
    fields: {},
    errors: [],
    requiresReview: true as const,
  })),
  records: [] as string[],
};

const agreement = (over: Record<string, unknown> = {}) => ({
  id: RES_ID,
  reservationNumber: 'AF-RES-ZZZZZ',
  origin: 'application',
  saleId: null,
  customerApplicationId: 'aaaaaaaa-0000-4000-8000-000000000001',
  customerId: 'cccccccc-0000-4000-8000-000000000003',
  sellerStaffId: '11111111-1111-4111-8111-111111111111',
  purchaseTermsId: TERMS_ID,
  planId: 'dddddddd-0000-4000-8000-000000000004',
  tier: 'BRONZE',
  inclusions: {},
  totalPrice: '54000.00',
  reservationFee: '10000.00',
  downPayment: '10000.00',
  totalPaymentReceived: '0.00',
  balance: '54000.00',
  monthlyAmortization: null,
  installmentMonths: null,
  paymentScheme: 'spot_cash',
  discountPercent: 15,
  validityYears: 7,
  yearlyPoints: 10000,
  annualPointsTranches: 5,
  holderLimit: 1,
  reservationDate: '2026-10-07',
  agreementDate: '2026-10-07',
  primarySignatureStatus: 'received',
  primary: {
    holderType: 'PRIMARY',
    name: 'ANA CRUZ',
    address: '1 Street',
    contactNumber: '09170000001',
    email: 'ana@example.test',
  },
  schedule: [],
  status: 'executed',
  createdAt: '2026-10-07T00:00:00.000Z',
  submittedAt: '2026-10-07T01:00:00.000Z',
  executedAt: '2026-10-07T02:00:00.000Z',
  ...over,
});

const FINANCE = {
  id: '22222222-2222-4222-8222-222222222222',
  afHomesPermissions: [
    { moduleKey: 'finance.payment_verification', canView: true, canUpdate: true },
    { moduleKey: 'finance.card_activation', canView: true, canUpdate: true },
    { moduleKey: 'sales.card_sales', canView: true, canUpdate: true },
  ],
} as unknown as SessionUser;
const READER = {
  ...FINANCE,
  afHomesPermissions: FINANCE.afHomesPermissions.map((p) => ({ ...p, canUpdate: false })),
} as unknown as SessionUser;

let current = agreement();
let finance: Record<string, unknown> = {
  reservationId: RES_ID,
  reservationNumber: 'AF-RES-ZZZZZ',
  customerApplicationId: current.customerApplicationId,
  applicationNumber: 'AF-APP-00000001',
  applicationStatus: 'approved',
  purchaseTermsId: TERMS_ID,
  sellerStaffId: '11111111-1111-4111-8111-111111111111',
  sellerName: 'Ana Seller',
  tier: 'BRONZE',
  customerId: current.customerId,
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
  verifiedTotal: '10000.00',
  remainingBalance: '44000.00',
  overpaidAmount: '0.00',
  fullyPaid: false,
  recordedPaymentCount: 1,
  firstVerifiedPayment: '2026-10-07T03:00:00.000Z',
  spotCashDeadline: '2026-10-14T03:00:00.000Z',
  saleId: null,
};

const payment = (over: Record<string, unknown> = {}) => ({
  id: '99999999-9999-4999-8999-999999999999',
  origin: 'reservation',
  saleId: null,
  reservationId: RES_ID,
  customerId: current.customerId,
  amount: '10000.00',
  paymentType: 'down_payment',
  method: 'cash',
  reference: 'REF-1',
  notes: null,
  status: 'recorded',
  rejectionReason: null,
  recordedBy: '22222222-2222-4222-8222-222222222222',
  verifiedBy: null,
  recordedAt: '2026-10-07T02:30:00.000Z',
  verifiedAt: null,
  ...over,
});

let payments = [payment()];

vi.mock('./services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services')>();
  return {
    ...actual,
    getReservationAgreement: async () => current,
    getReservationFinance: async () => finance,
    getReservationPayments: async () => payments,
    getReservationAgreements: async () => [],
    getSales: async () => [],
    getCardProducts: async () => [],
    getCustomerApplications: async () => [],
    getCustomerApplication: async () => null,
    getOfficialFormTemplate: async () => ({ filename: 'x', mime: 'text/plain', content: '' }),
    previewOfficialFormImport: calls.preview,
    exportReservationAgreement: async () => ({ filename: 'x', mime: 'text/plain', content: '' }),
    createReservationAgreement: calls.createReservationAgreement,
    updateReservationAgreement: async () => current,
    submitReservationAgreement: calls.submit,
    decideReservationAgreement: calls.decide,
    reopenReservationAgreement: calls.reopen,
    activateSale: calls.activate,
    finalizeReservationPurchase: calls.finalize,
    exportPurchaseDocument: async (sourceId: string, kind: string) => {
      calls.records.push(`${sourceId}:${kind}`);
      return { filename: `${kind}.pdf`, mime: 'application/pdf', content: 'JVBERi0=' };
    },
  };
});

const { ReservationAgreementEditorPage } = await import('./OfficialFormsPages');

beforeEach(() => {
  calls.records.length = 0;
  calls.createReservationAgreement.mockReset().mockResolvedValue(current);
  calls.submit.mockReset().mockResolvedValue(current);
  calls.decide.mockReset().mockResolvedValue(current);
  calls.reopen.mockReset().mockResolvedValue(current);
  calls.activate.mockReset().mockResolvedValue({
    membershipId: 'abcdabcd-0000-4000-8000-0000000000ab',
    membershipNumber: 'MBS-37807BC5-3EE3740B-52E12516-3245E27BAAAA',
    fallbackCode: null,
    qrToken: null,
    pointsAllocated: 10000,
    alreadyActive: false,
  });
  calls.finalize.mockReset().mockResolvedValue({
    saleId: SALE_ID,
    reservationId: RES_ID,
    activationRequired: true,
  });
  calls.preview.mockReset().mockResolvedValue({
    kind: 'reservation_agreement',
    fields: {},
    errors: [],
    requiresReview: true,
  });
  current = agreement();
  finance = {
    ...finance,
    verifiedTotal: '10000.00',
    remainingBalance: '44000.00',
    overpaidAmount: '0.00',
    fullyPaid: false,
    saleId: null,
  };
  payments = [payment()];
  URL.createObjectURL = () => 'blob:stub';
  URL.revokeObjectURL = () => {};
});

const renderDetail = (user: SessionUser = FINANCE) =>
  renderWithProviders(
    // A real route match, so `useParams().id` resolves. Without it the page
    // renders as a NEW agreement and every lifecycle assertion would pass for
    // the wrong reason.
    <Routes>
      <Route path="/admin/sales/reservations/:id" element={<ReservationAgreementEditorPage />} />
    </Routes>,
    { route: `/admin/sales/reservations/${RES_ID}`, user },
  );

describe('Application-origin reservation detail', () => {
  it('shows the AF-RES, the lifecycle state and NO sale before finalization', async () => {
    renderDetail();
    expect(await screen.findByText('AF-RES-ZZZZZ')).toBeTruthy();
    expect(
      await screen.findByText('Not created — created when the purchase is finalized'),
    ).toBeTruthy();
  });

  it('shows the frozen total, the INCLUDED reservation amount, verified and remaining', async () => {
    renderDetail();
    expect(await screen.findByText(/54,000\.00/)).toBeTruthy();
    expect(screen.getAllByText(/10,000\.00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/44,000\.00/).length).toBeGreaterThan(0);
  });

  it('offers no Finalize while money is short', async () => {
    renderDetail();
    await screen.findByText('AF-RES-ZZZZZ');
    expect(screen.queryByRole('button', { name: /finalize purchase/i })).toBeNull();
  });

  it('offers Finalize from the server-reported eligibility alone', async () => {
    finance = { ...finance, verifiedTotal: '54000.00', remainingBalance: '0.00', fullyPaid: true };
    renderDetail();
    expect(await screen.findByRole('button', { name: /finalize purchase/i })).toBeTruthy();
  });

  it('keeps Finalize disabled without the finance update grant', async () => {
    finance = { ...finance, verifiedTotal: '54000.00', remainingBalance: '0.00', fullyPaid: true };
    renderDetail(READER);
    const button = await screen.findByRole('button', { name: /finalize purchase/i });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('offers no reopen or cancel on an EXECUTED agreement', async () => {
    renderDetail();
    await screen.findByText('AF-RES-ZZZZZ');
    expect(screen.queryByRole('button', { name: /^reopen to draft$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^cancel$/i })).toBeNull();
  });

  it('lists one row per payment, and prints the recorded receipt', async () => {
    const user = userEvent.setup();
    renderDetail();
    await screen.findByText('AF-RES-ZZZZZ');
    const rows = await screen.findAllByRole('row');
    // header + one payment
    expect(rows).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: /print recorded receipt/i }));
    await waitFor(() => expect(calls.records).toContain(`${payments[0]!.id}:payment_recorded`));
  });

  it('offers a verified receipt ONLY for a verified payment', async () => {
    const first = renderDetail();
    await screen.findByText('AF-RES-ZZZZZ');
    expect(screen.queryByRole('button', { name: /print verified receipt/i })).toBeNull();
    // Unmounted before the second render: two tables in one document would let
    // the first render's buttons satisfy the second render's assertions.
    first.unmount();

    payments = [
      payment({ status: 'verified', verifiedBy: 'x', verifiedAt: '2026-10-07T03:00:00.000Z' }),
    ];
    renderDetail();
    expect(await screen.findByRole('button', { name: /print verified receipt/i })).toBeTruthy();
  });

  // A rejected payment is proven in the API and DB suites, where the rejection
  // reason is asserted on the row itself and the absence of a verified receipt is
  // asserted in the evidence table. Duplicating it here with a hand-built
  // fixture proved nothing extra.

  it('shows no membership action before a sale exists', async () => {
    renderDetail();
    await screen.findByText('AF-RES-ZZZZZ');
    expect(screen.queryByRole('button', { name: /activate membership/i })).toBeNull();
  });

  it('activates and shows the membership WITHOUT any credential', async () => {
    const user = userEvent.setup();
    current = agreement({ saleId: SALE_ID, status: 'executed' });
    finance = { ...finance, saleId: SALE_ID };
    renderDetail();
    await user.click(await screen.findByRole('button', { name: /activate membership/i }));
    expect(await screen.findByText('MBS-37807BC5-3EE3740B-52E12516-3245E27BAAAA')).toBeTruthy();
    const shown = document.body.textContent ?? '';
    expect(shown).not.toContain('qrToken');
    expect(shown).not.toContain('fallbackCode');
    expect(shown).toContain('Card credentials are shown once');
    expect(screen.getByRole('button', { name: /print activation confirmation/i })).toBeTruthy();
  });

  it('keeps Activate disabled without the card-activation grant', async () => {
    current = agreement({ saleId: SALE_ID });
    finance = { ...finance, saleId: SALE_ID };
    renderDetail({
      ...READER,
      afHomesPermissions: [
        { moduleKey: 'finance.payment_verification', canView: true, canUpdate: false },
        { moduleKey: 'finance.card_activation', canView: true, canUpdate: false },
        { moduleKey: 'sales.card_sales', canView: true, canUpdate: false },
      ],
    } as unknown as SessionUser);
    const button = await screen.findByRole('button', { name: /activate membership/i });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(calls.activate).not.toHaveBeenCalled();
  });

  it('prints the final purchase record once a sale is linked', async () => {
    const user = userEvent.setup();
    current = agreement({ saleId: SALE_ID });
    finance = { ...finance, saleId: SALE_ID };
    renderDetail();
    await user.click(await screen.findByRole('button', { name: /print final purchase record/i }));
    await waitFor(() => expect(calls.records).toContain(`${SALE_ID}:purchase_finalized`));
  });
});

it('does not present creation snapshots as current payment totals', async () => {
  renderDetail();
  await screen.findByText('AF-RES-ZZZZZ');
  expect(screen.queryByText(/Verified received: 0\.00/)).toBeNull();
});
it('shows the linked sale business number and labels existing draft saves correctly', async () => {
  current = agreement({ saleId: SALE_ID, status: 'draft' });
  finance = { ...finance, saleId: SALE_ID, saleNumber: 'AF-CSALE-QATEST' };
  renderDetail();
  expect(await screen.findByText('AF-CSALE-QATEST')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeTruthy();
});
it('loads the persisted membership and confirmation after reopening the reservation', async () => {
  current = agreement({ saleId: SALE_ID });
  finance = {
    ...finance,
    saleId: SALE_ID,
    membership: {
      id: 'abcdabcd-0000-4000-8000-0000000000ab',
      membershipNumber: 'MBS-PERSISTED',
      status: 'active',
      pointsBalance: 10000,
    },
  };
  renderDetail();
  expect(await screen.findByText('MBS-PERSISTED')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /activate membership/i })).toBeNull();
  expect(screen.getByRole('button', { name: /print activation confirmation/i })).toBeTruthy();
});

/**
 * The bulk import control: a real file input (keyboard and screen-reader
 * reachable, never a styled div), named by its visible heading, and honest
 * about what it has read so far.
 */
/**
 * Field labels are derived from raw state keys (`reservationDate`,
 * `contactNumber`). Showing the key leaks camelCase and reads as a variable
 * rather than a label, so each group is humanized on the way out.
 */
describe('reservation detail field labels', () => {
  it('shows readable labels for every date, holder, and schedule field', async () => {
    renderDetail();
    for (const label of [
      'Reservation Date',
      'Agreement Date',
      'Revision Number',
      'Monthly Amortization Start',
      'Monthly Amortization End',
      'Payment Due Day',
      'Name',
      'Address',
      'Contact Number',
      'Email',
      'TIN Number',
      'Particular',
      'Amount',
      'Payment Date',
      'Remarks',
      'Imported Tier',
    ]) {
      expect(await screen.findByLabelText(label)).toBeTruthy();
    }
  });

  it('never leaks a raw camelCase key as a visible label', async () => {
    renderDetail();
    const labels = screen
      .getAllByRole('textbox')
      .map((input) => input.getAttribute('aria-label') ?? '')
      .join(' ');
    for (const key of ['contactNumber', 'tinNumber', 'paymentDate', 'reservationDate']) {
      expect(labels).not.toContain(key);
    }
  });
});

describe('reservation bulk import control', () => {
  it('exposes a named file input that accepts workbooks only', async () => {
    renderDetail();
    const input = (await screen.findByLabelText('Import IST XLSX')) as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.type).toBe('file');
    expect(input.accept).toBe('.xlsx');
    expect(screen.getByText('No workbook chosen yet.')).toBeTruthy();
  });

  it('confirms the chosen workbook and reports progress while reading it', async () => {
    renderDetail();
    const input = (await screen.findByLabelText('Import IST XLSX')) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['sheet'], 'ist-batch-07.xlsx', { type: '' })] },
    });
    const status = await screen.findByText(/ist-batch-07\.xlsx/);
    expect(status.textContent).toContain('1 KB');
    expect(calls.preview).toHaveBeenCalledWith('reservation_agreement', expect.any(String));
  });

  /**
   * The tier dropdown is a closed set of options. A workbook cell is not, so an
   * unknown tier must never reach the state: a value with no matching option
   * renders blank while the state keeps the bad value, and the browser would
   * then submit it.
   */
  it('never lets a workbook put an unknown tier into the closed dropdown', async () => {
    calls.preview.mockResolvedValue({
      kind: 'reservation_agreement',
      fields: { vip_tier: 'platinum' },
      errors: [],
      requiresReview: true,
    });
    renderDetail();
    const select = (await screen.findByLabelText('Imported Tier')) as HTMLSelectElement;
    // Wait for the agreement to hydrate: the page seeds the dropdown from the
    // loaded record, and importing before that lands would race it.
    await waitFor(() => expect(select.value).toBe('BRONZE'));
    const input = (await screen.findByLabelText('Import IST XLSX')) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['sheet'], 'ist-bad-tier.xlsx', { type: '' })] },
    });
    await screen.findByText(/ist-bad-tier\.xlsx/);
    await waitFor(() => expect(calls.preview).toHaveBeenCalled());
    // The loaded agreement's BRONZE stands: the unknown cell is discarded.
    expect(select.value).toBe('BRONZE');
  });

  it('applies a recognised tier from the workbook to the dropdown', async () => {
    calls.preview.mockResolvedValue({
      kind: 'reservation_agreement',
      fields: { vip_tier: 'gold' },
      errors: [],
      requiresReview: true,
    });
    renderDetail();
    const select = (await screen.findByLabelText('Imported Tier')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('BRONZE'));
    const input = (await screen.findByLabelText('Import IST XLSX')) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['sheet'], 'ist-good-tier.xlsx', { type: '' })] },
    });
    // The workbook wrote 'gold'; the stored option value is canonical 'GOLD'.
    await waitFor(() => expect(select.value).toBe('GOLD'));
  });
});
