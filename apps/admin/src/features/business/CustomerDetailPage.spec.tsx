import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AfHomesPermission, Customer, IdentityDocument, Sale } from '@afhomes/contracts';

import { CustomerDetailPage } from './CustomerDetailPage';
import { renderWithProviders } from '../../test/utils';
import type { SessionUser } from '../../lib/session';
import { ApiError } from '../../lib/api/errors';
import { getCustomerById, getSalePayments, getSales } from './services';
import { getCurrentDocument, getDocumentAccessUrl } from '../documents/services';

vi.mock('./services', () => ({
  getCustomerById: vi.fn(),
  getSales: vi.fn(),
  getSalePayments: vi.fn(async () => []),
  getSaleSummary: vi.fn(),
  getCustomerApplications: vi.fn(),
  cancelSale: vi.fn(),
}));

// The ID image comes from the documents API, not the customers one.
vi.mock('../documents/services', () => ({
  getCurrentDocument: vi.fn(),
  getDocumentAccessUrl: vi.fn(),
}));

const grant = (
  moduleKey: AfHomesPermission['moduleKey'],
  extra: Partial<AfHomesPermission> = {},
): AfHomesPermission => ({
  moduleKey,
  canView: true,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
  ...extra,
});

const STAFF: SessionUser = {
  id: 'u-staff',
  name: 'Staff User',
  email: 'staff@afhomes.test',
  roleId: 'r-staff',
  roleSlug: 'admin',
  roleName: 'Admin',
  status: 'active',
  afHomesPermissions: [grant('sales.customers', { canCreate: true, canUpdate: true })],
};

const FULLSTAFF: SessionUser = {
  ...STAFF,
  afHomesPermissions: [
    grant('sales.customers', { canCreate: true, canUpdate: true }),
    grant('sales.card_sales', { canCreate: true, canUpdate: true }),
    grant('finance.payment_verification', { canUpdate: true }),
  ],
};

const RECORD = {
  id: 'c-1',
  customerNumber: 'CUS-000001',
  raNumber: 'AF-CUS-2026-000001',
  customerCode: 'AF-CC-1A2B3C4D',
  fullName: 'MARIA SANTOS',
  email: 'maria@example.com',
  phone: '+639171234567',
  dateOfBirth: '1990-05-05',
  gender: 'female',
  governmentIdType: 'passport',
  governmentIdMasked: '••••1234',
  status: 'active',
  derivedCategory: 'ACTIVE_VIP',
  hasActiveMembership: true,
  tier: 'GOLD',
  membershipStatus: 'active',
  membershipExpiresAt: '2027-05-05T00:00:00.000Z',
  portalAccountActivated: false,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
} as unknown as Customer;

const SALE = {
  id: 's-1',
  saleNumber: 'SALE-000001',
  customerId: 'c-1',
  customerName: 'MARIA SANTOS',
  productId: 'p-1',
  productName: 'Gold',
  productCode: 'GOLD',
  status: 'payment_in_progress',
  sellerStaffId: null,
  sellerName: 'Sam Seller',
  cashPrice: '60000.00',
  minimumDownPayment: '20000.00',
  paymentScheme: 'spot_cash',
  reservationFee: '0.00',
  requiredInitial: '20000.00',
  installmentMonths: null,
  monthlyAmount: null,
  validityMonths: null,
  yearlyPoints: 60000,
  commissionRate: '0.04',
  expectedCommission: '2400.00',
  paidAmount: '15000.00',
  balance: '45000.00',
  spotCashDeadline: null,
  submittedAt: '2026-09-28T00:00:00.000Z',
  paymentVerifiedAt: null,
  activatedAt: null,
  createdAt: '2026-09-28T00:00:00.000Z',
} as unknown as Sale;

function renderDetail(user: SessionUser = STAFF, tab = 'overview') {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/customers" element={<p>directory</p>} />
      <Route path="/admin/customers/:id" element={<CustomerDetailPage />} />
      <Route path="/admin/customers/applications/:id" element={<p>application editor</p>} />
    </Routes>,
    { user, route: `/admin/customers/c-1?tab=${tab}` },
  );
}

const ID_SCAN_STAFF: SessionUser = {
  ...STAFF,
  afHomesPermissions: [grant('sales.customers'), grant('sales.id_documents')],
};

const ID_DOCUMENT = {
  id: 'd-1',
  subjectType: 'customer',
  subjectId: 'c-1',
  originalFilename: 'philippine-id.jpg',
  mime: 'image/jpeg',
  sizeBytes: 2048,
  hasFile: true,
  ocrStatus: 'not_requested',
  ocrProvider: null,
  verificationStatus: 'pending_review',
  isCurrent: true,
  extractedFields: {},
  warnings: [],
  reviewedFields: null,
  possibleDuplicate: null,
  uploadedAt: '2026-10-01T09:00:00.000Z',
  reviewedAt: null,
} as unknown as IdentityDocument;

beforeEach(() => {
  vi.mocked(getSales).mockResolvedValue([]);
  // No global `clearMocks` here, so the documents mocks start each test with
  // an empty call history: the "never asked" assertion must see this test only.
  vi.mocked(getCurrentDocument).mockReset();
  vi.mocked(getDocumentAccessUrl).mockReset();
  vi.mocked(getCurrentDocument).mockResolvedValue(null);
  vi.mocked(getDocumentAccessUrl).mockResolvedValue({
    url: 'https://signed.test/id.jpg',
    expiresAt: '2026-10-20T00:00:00.000Z',
  });
});

describe('CustomerDetailPage', () => {
  it('renders the full record, including fields the table no longer shows', async () => {
    vi.mocked(getCustomerById).mockResolvedValue(RECORD);
    renderDetail();
    expect(await screen.findByRole('heading', { name: 'MARIA SANTOS' })).toBeInTheDocument();
    for (const value of ['AF-CUS-2026-000001', 'CUS-000001', 'AF-CC-1A2B3C4D', '••••1234']) {
      expect(screen.getByText(value)).toBeInTheDocument();
    }
    // The tier leads the header and repeats in the membership card.
    expect(screen.getAllByText('GOLD').length).toBeGreaterThanOrEqual(1);
    // Contact facts appear once on this tab. The company form transcribes them
    // again, on its own tab, which is asserted there.
    expect(screen.getAllByText('maria@example.com')).toHaveLength(1);
    expect(screen.getAllByText('+639171234567')).toHaveLength(1);
    // Lookup-mirrored membership facts: status chip, tier, formatted expiry.
    // The header and the membership card both humanise the raw status code.
    expect(screen.getAllByText('Active').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/May.*2027/)).toBeInTheDocument();
    // No back link: the directory row is the way back.
    expect(screen.queryByRole('link', { name: 'Back to customers' })).not.toBeInTheDocument();
    // State and identifiers lead the page, inside the header card, before any
    // other card.
    expect(screen.getByText('Not activated')).toBeInTheDocument();
    expect(screen.getByText('Active VIP')).toBeInTheDocument();
    // The header is a card; the state and identifier groups keep their labels.
    const state = screen.getByText('Portal account:').closest('dl');
    expect(Array.from(state?.querySelectorAll('dt') ?? []).map((dt) => dt.textContent)).toEqual([
      'Status:',
      'Tier:',
      'Category:',
      'Portal account:',
    ]);
    const masthead = screen.getByText('Customer ID (RA No.):').closest('dl');
    expect(Array.from(masthead?.querySelectorAll('dt') ?? []).map((dt) => dt.textContent)).toEqual([
      'Customer ID (RA No.):',
      'Internal system reference:',
      'Customer code:',
      'Registered:',
    ]);
  });

  it('renders a monogram and the "No Tier" badge when the customer has no tier', async () => {
    vi.mocked(getCustomerById).mockResolvedValue({ ...RECORD, tier: null });
    renderDetail();
    expect(await screen.findByRole('heading', { name: 'MARIA SANTOS' })).toBeInTheDocument();
    // The monogram is derived from the first and last name.
    expect(screen.getByText('MS')).toBeInTheDocument();
    // A missing tier renders the shared "No Tier" badge in the header.
    expect(screen.getAllByText('No Tier').length).toBeGreaterThanOrEqual(1);
  });

  it('reports fetch errors with a retry', async () => {
    vi.mocked(getCustomerById).mockRejectedValue(new Error('boom'));
    renderDetail();
    // ErrorState never renders raw internals; it shows canonical copy + retry.
    expect(await screen.findByText(/couldn’t load this information/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('renders the four company-stated sections with exact labels and formatted TIN', async () => {
    vi.mocked(getCustomerById).mockResolvedValue({
      ...RECORD,
      firstName: 'MARIA',
      lastName: 'SANTOS',
      middleName: 'DELA',
      suffix: 'Jr.',
      landline: '(049) 555-1234',
      address: {
        line1: '1 SSOT Street',
        line2: 'Unit 7',
        province: 'Laguna',
        city: 'Calamba',
        barangay: 'Parian',
        postalCode: '4027',
        countryCode: 'PH',
      },
      raNumber: 'RA-2026-0001',
      companyStatus: 'FULLY PAID',
      citizenship: 'Filipino',
      civilStatus: 'Single',
      tinNumber: '123456789',
      tinNumberMasked: '********9012',
      occupationBusinessName: 'Engineer',
      officeBusinessAddress: 'Makati HQ',
      employedPosition: 'Engineer II',
      supplementaryFullName: 'JUAN CRUZ',
      supplementaryAddress: '1 Side St, Biñan',
      supplementaryBirthday: '1992-08-10',
      supplementaryGender: 'male',
      supplementaryMobile: '+639181234567',
      supplementaryEmail: 'juan@example.com',
      supplementaryLandline: '(02) 8999-0000',
      supplementaryTinNumber: '987654321',
      supplementaryTinNumberMasked: '********7001',

      svdName: 'SVD Santos',
      referrerName: 'Ref Reyes',
      relatedEmail: 'related@example.com',
      statedVipPackage: 'GOLD VIP',
      statedPaymentTerms: 'spot_cash',
      statedRegularPrice: '60000.00',
      statedRf: 'RF-001',
      statedPaymentDate: '2026-01-01',
    } as unknown as Customer);
    renderDetail(STAFF, 'company');
    for (const title of [
      'Primary Member',
      'Supplementary Member',
      'Related Persons and Referral',
      'Package and Payment (company stated)',
    ]) {
      expect(await screen.findByText(title)).toBeInTheDocument();
    }
    // Company identifiers remain visible in the header on every tab; TINs display formatted.
    for (const value of [
      'RA-2026-0001',
      'FULLY PAID',
      '123-456-789',
      '987-654-321',
      'JUAN CRUZ',
      'SVD Santos',
      'GOLD VIP',
      'Spot Cash',
      '60,000.00',
      'RF-001',
      '(049) 555-1234',
      'Parian',
      '4027',
      '(02) 8999-0000',
    ]) {
      expect(screen.getByText(value)).toBeInTheDocument();
    }
    // Genders read Title Case, not the stored lowercase enum.
    expect(screen.getByText('Female')).toBeInTheDocument();
    expect(screen.getByText('Male')).toBeInTheDocument();
    expect(screen.queryByText('123456789')).not.toBeInTheDocument();
    // The company form transcribes the contact facts. Each copy now lives on its
    // own tab, so no panel shows the same field twice.
    expect(screen.getAllByText('maria@example.com')).toHaveLength(1);
    expect(screen.getAllByText('+639171234567')).toHaveLength(1);
    // Primary Member follows the SSOT order exactly: split names, split
    // address parts, one landline, one email, one mobile number.
    const primaryGrid = screen.getByText('FIRST NAME').closest('dl');
    expect(
      Array.from(primaryGrid?.querySelectorAll('dt') ?? []).map((dt) => dt.textContent),
    ).toEqual([
      'PAYMENT STATUS',
      'FIRST NAME',
      'LAST NAME',
      'MIDDLE NAME',
      'SUFFIX',
      'BIRTHDAY',
      'GENDER',
      'AGE',
      'CITIZENSHIP',
      'CIVIL STATUS',
      'PERMANENT ADDRESS LINE 1',
      'PERMANENT ADDRESS LINE 2',
      'PROVINCE',
      'CITY',
      'BARANGGAY',
      'POSTAL CODE',
      'LANDLINE',
      'EMAIL',
      'TIN NO.',
      'MOBILE NO.',
      'OCCUPATION / BUSINESS NAME',
      'OFFICE / BUSINESS ADDRESS',
      'EMPLOYED POSITION',
    ]);
    // Supplementary block: joined name/address, SSOT singles, one landline.
    const supplementaryGrid = screen.getByText('SUPPLEMENTARY FULL NAME').closest('dl');
    expect(
      Array.from(supplementaryGrid?.querySelectorAll('dt') ?? []).map((dt) => dt.textContent),
    ).toEqual([
      'SUPPLEMENTARY FULL NAME',
      'SUPPLEMENTARY ADDRESS',
      'BIRTHDAY',
      'GENDER',
      'AGE',
      'CITIZENSHIP',
      'CIVIL STATUS',
      'TIN NO.',
      'LANDLINE',
      'MOBILE NO.',
      'EMAIL',
      'OCCUPATION / BUSINESS NAME',
      'OFFICE / BUSINESS ADDRESS',
      'EMPLOYED POSITION',
    ]);
    // Related block carries the verbatim (NAME) headers.
    for (const label of [
      'SVD (NAME)',
      'SSM (NAME)',
      'SM (NAME)',
      'REFERRER (NAME)',
      'VIP RECOMMENDER (NAME)',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});

describe('CustomerDetailPage card sales', () => {
  it('shows verified reservation payments and the remaining balance before a sale exists', async () => {
    vi.mocked(getCustomerById).mockResolvedValue({
      ...RECORD,
      tier: 'GOLD',
      frozenTotal: '312000.00',
      verifiedPaid: '90000.00',
      openReservationTotal: '312000.00',
      openReservationPaid: '90000.00',
    } as Customer);
    renderDetail(FULLSTAFF);
    const strip = await screen.findByLabelText('Outstanding balance');
    expect(strip).toHaveTextContent('Open reservations');
    expect(strip).toHaveTextContent('₱222,000.00');
    expect(strip).toHaveTextContent('₱90,000.00');
    expect(
      screen.queryByText('Nothing outstanding for this customer yet.'),
    ).not.toBeInTheDocument();
  });

  it('does not treat a failed sales request as proof that nothing is outstanding', async () => {
    vi.mocked(getCustomerById).mockResolvedValue(RECORD);
    vi.mocked(getSales).mockRejectedValue(new Error('sales unavailable'));
    renderDetail(FULLSTAFF);
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(
      screen.queryByText('Nothing outstanding for this customer yet.'),
    ).not.toBeInTheDocument();
  });

  it('keeps open reservation balances alongside existing sale balances', async () => {
    vi.mocked(getCustomerById).mockResolvedValue({
      ...RECORD,
      openReservationTotal: '312000.00',
      openReservationPaid: '10000.00',
    } as Customer);
    vi.mocked(getSales).mockResolvedValue([SALE]);
    renderDetail(FULLSTAFF);
    const strip = await screen.findByLabelText('Outstanding balance');
    expect(strip).toHaveTextContent('Open reservations');
    expect(strip).toHaveTextContent('₱302,000.00');
    expect(strip).toHaveTextContent('Balance on SALE-000001');
    expect(strip).toHaveTextContent('₱45,000.00');
  });

  it('excludes cancelled sales from the outstanding balance', async () => {
    vi.mocked(getCustomerById).mockResolvedValue(RECORD);
    vi.mocked(getSales).mockResolvedValue([{ ...SALE, status: 'cancelled' }]);
    renderDetail(FULLSTAFF);
    expect(
      await screen.findByText('No committed reservation or sale to summarize.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('₱45,000.00')).not.toBeInTheDocument();
  });

  it('renders each sale as a facts card with inline payment history', async () => {
    vi.mocked(getCustomerById).mockResolvedValue(RECORD);
    vi.mocked(getSales).mockResolvedValue([SALE]);
    vi.mocked(getSalePayments).mockResolvedValue([
      {
        id: 'pay-1',
        paymentNumber: 'AF-PAY-ABC123',
        amount: '15000.00',
        paymentType: 'installment',
        method: 'bank_transfer',
        reference: 'TRF-0001',
        status: 'verified',
        rejectionReason: null,
        recordedBy: 'c9165fee-635b-4486-9d96-bd79f8858dd2',
        verifiedBy: 'd9165fee-635b-4486-9d96-bd79f8858dd3',
        recordedByName: 'Sam Seller',
        verifiedByName: 'Fin User',
        recordedAt: '2026-09-28T00:00:00.000Z',
        verifiedAt: '2026-09-29T00:00:00.000Z',
      },
    ] as never);
    renderDetail(STAFF, 'sales');
    await screen.findByRole('heading', { name: 'Sale SALE-000001' });
    expect(vi.mocked(getSales)).toHaveBeenCalledWith({ customerId: 'c-1' });
    // The sale card is facts plus a ledger. The money figures live once, on
    // Overview, so nothing here can disagree with the settlement strip.
    const saleGrid = screen.getByText('Sam Seller').closest('dl');
    expect(saleGrid?.className).toMatch(/fields/);
    expect(Array.from(saleGrid?.querySelectorAll('dt') ?? []).map((dt) => dt.textContent)).toEqual([
      'Card',
      'Scheme',
      'Seller',
      'Activation status',
      'Created',
    ]);
    // History hides behind a disclosure until opened.
    expect(screen.queryByText('AF-PAY-ABC123')).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByText('View Payment History'));
    // Reference shows the system payment number with the stored value on hover.
    const reference = await screen.findByText('AF-PAY-ABC123');
    expect(reference).toBeInTheDocument();
    expect(reference).toHaveAttribute('title', 'TRF-0001');
    // Codes render humanized; actor names render, never UUIDs.
    expect(screen.getByText('Installment')).toBeInTheDocument();
    expect(screen.getByText('Bank Transfer')).toBeInTheDocument();
    // Once as the sale's seller, once as the recording staff member.
    expect(screen.getAllByText('Sam Seller')).toHaveLength(2);
    expect(screen.getByText('Fin User')).toBeInTheDocument();
    expect(screen.queryByText('c9165fee-635b-4486-9d96-bd79f8858dd2')).not.toBeInTheDocument();
  });

  it('leads the Overview with what the customer still owes', async () => {
    // The screen's question. Money is the biggest block and appears once.
    vi.mocked(getCustomerById).mockResolvedValue(RECORD);
    vi.mocked(getSales).mockResolvedValue([SALE]);
    renderDetail(FULLSTAFF, 'overview');
    const strip = await screen.findByLabelText('Outstanding balance');
    expect(strip).toHaveTextContent('Balance on SALE-000001');
    expect(strip).toHaveTextContent('₱45,000.00');
    expect(strip).toHaveTextContent('₱60,000.00');
    expect(strip).toHaveTextContent('₱15,000.00');
    // Paid trails Total with a remaining balance: Unsettled, not Fully Paid.
    expect(screen.getByText('Unsettled')).toBeInTheDocument();
    expect(screen.queryByText('Fully Paid')).not.toBeInTheDocument();
    // The tab bar carries all three panels, one of them current.
    const tabs = screen.getByLabelText('Customer record sections');
    expect(tabs).toHaveTextContent('Overview');
    expect(tabs).toHaveTextContent('Sales and payments');
    expect(tabs).toHaveTextContent('Stated record');
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows an empty state when the customer holds no sales', async () => {
    vi.mocked(getCustomerById).mockResolvedValue(RECORD);
    vi.mocked(getSales).mockResolvedValue([]);
    renderDetail(STAFF, 'sales');
    expect(await screen.findByText('No card sales yet.')).toBeInTheDocument();
  });

  it('hides sales entirely when the viewer lacks the card-sales scope', async () => {
    vi.mocked(getCustomerById).mockResolvedValue(RECORD);
    vi.mocked(getSales).mockRejectedValue(
      new ApiError({ code: 'FORBIDDEN', message: 'Denied', status: 403 }),
    );
    renderDetail(STAFF);
    await screen.findByRole('heading', { name: 'MARIA SANTOS' });
    expect(screen.queryByRole('link', { name: 'Sales and payments' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Outstanding balance')).not.toBeInTheDocument();
  });

  it('reports sales fetch errors with a retry', async () => {
    vi.mocked(getCustomerById).mockResolvedValue(RECORD);
    vi.mocked(getSales).mockRejectedValue(new Error('sales down'));
    renderDetail(STAFF, 'sales');
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('CustomerDetailPage merged actions', () => {
  it('renders record and sale workflows in one Actions card', async () => {
    vi.mocked(getCustomerById).mockResolvedValue(RECORD);
    vi.mocked(getSales).mockResolvedValue([SALE]);
    renderDetail(FULLSTAFF);
    await screen.findByRole('heading', { name: 'Actions' });
    // Record-level workflows …
    expect(screen.getByRole('button', { name: 'Deactivate account' })).toBeInTheDocument();
    // … beside the per-sale payment actions and the status dropdown.
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify payment' })).toBeInTheDocument();
    expect(screen.getByLabelText('Membership status')).toBeInTheDocument();
    // … and the removed sale buttons stay gone.
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    // … and neither of the old split cards remains.
    expect(screen.queryByRole('heading', { name: 'Customer Actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Action' })).not.toBeInTheDocument();
  });

  it('hides sale actions without any action grant, keeping record actions', async () => {
    vi.mocked(getCustomerById).mockResolvedValue(RECORD);
    vi.mocked(getSales).mockResolvedValue([SALE]);
    renderWithProviders(
      <Routes>
        <Route path="/admin/customers/:id" element={<CustomerDetailPage />} />
      </Routes>,
      {
        user: { ...STAFF, afHomesPermissions: [grant('sales.customers', {})] },
        route: '/admin/customers/c-1',
      },
    );
    await screen.findByRole('heading', { name: 'Actions' });
    // No sale-level actions without grants …
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    // … but the record-level workflows stay.
    expect(screen.getByRole('button', { name: 'Deactivate account' })).toBeInTheDocument();
  });

  it('renders one sale card per sale, titled by its own number', async () => {
    vi.mocked(getCustomerById).mockResolvedValue(RECORD);
    vi.mocked(getSales).mockResolvedValue([
      SALE,
      { ...SALE, id: 's-2', saleNumber: 'SALE-000002' },
    ]);
    renderDetail(FULLSTAFF, 'sales');
    expect(await screen.findByRole('heading', { name: 'Sale SALE-000001' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sale SALE-000002' })).toBeInTheDocument();
  });

  it('settles each sale once, on the Overview', async () => {
    vi.mocked(getCustomerById).mockResolvedValue(RECORD);
    vi.mocked(getSales).mockResolvedValue([
      SALE,
      { ...SALE, id: 's-2', saleNumber: 'SALE-000002', balance: '0.00' },
    ]);
    renderDetail(FULLSTAFF, 'sales');
    expect(await screen.findByRole('heading', { name: 'Sale SALE-000001' })).toBeInTheDocument();
    // The figures live on the Overview and are not repeated in the sale cards.
    expect(screen.queryByText('₱45,000.00')).not.toBeInTheDocument();
    expect(screen.queryByText('₱60,000.00')).not.toBeInTheDocument();
  });

  it('shows the current ID image to staff who may view ID scans', async () => {
    vi.mocked(getCustomerById).mockResolvedValue({
      ...RECORD,
      governmentIdMasked: null,
    } as unknown as Customer);
    vi.mocked(getCurrentDocument).mockResolvedValue(ID_DOCUMENT);
    renderDetail(ID_SCAN_STAFF);
    const image = await screen.findByAltText('Scan of philippine-id.jpg');
    expect(image).toHaveAttribute('src', 'https://signed.test/id.jpg');
    // The server decides which document is current; the page only asks for it.
    expect(vi.mocked(getCurrentDocument)).toHaveBeenCalledWith({
      subjectType: 'customer',
      subjectId: 'c-1',
    });
    // The scan is never shown without a grant, so the request is never sent.
    expect(vi.mocked(getDocumentAccessUrl)).toHaveBeenCalledWith('d-1');
  });

  it('never asks for the ID image without the ID-scan grant', async () => {
    vi.mocked(getCustomerById).mockResolvedValue(RECORD);
    renderDetail();
    await screen.findByRole('heading', { name: 'MARIA SANTOS' });
    expect(vi.mocked(getCurrentDocument)).not.toHaveBeenCalled();
    expect(screen.queryByAltText(/Scan of/)).not.toBeInTheDocument();
  });

  it('links a PDF scan out instead of inlining it', async () => {
    vi.mocked(getCustomerById).mockResolvedValue({
      ...RECORD,
      governmentIdMasked: null,
    } as unknown as Customer);
    vi.mocked(getCurrentDocument).mockResolvedValue({
      ...ID_DOCUMENT,
      mime: 'application/pdf',
      originalFilename: 'philippine-id.pdf',
    });
    vi.mocked(getDocumentAccessUrl).mockResolvedValue({
      url: 'https://signed.test/id.pdf',
      expiresAt: '2026-10-20T00:00:00.000Z',
    });
    renderDetail(ID_SCAN_STAFF);
    const link = await screen.findByRole('link', { name: /Open the PDF/ });
    expect(link).toHaveAttribute('href', 'https://signed.test/id.pdf');
    expect(screen.queryByAltText(/Scan of/)).not.toBeInTheDocument();
  });

  it('says so when the customer has no ID image on file', async () => {
    vi.mocked(getCustomerById).mockResolvedValue({
      ...RECORD,
      governmentIdMasked: null,
    } as unknown as Customer);
    renderDetail(ID_SCAN_STAFF);
    expect(await screen.findByText('Not Recorded')).toBeInTheDocument();
  });
});
