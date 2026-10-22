import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';

/**
 * The reservation SOURCE panel, redesigned.
 *
 * The section carries two ALTERNATIVE origins of the same slot (a card sale,
 * or a customer application) and one piece of imported context (the tier).
 * These tests pin that structure, because the structure is the point:
 *
 *  - the two pickers belong to one group, so they read as alternatives;
 *  - the auto-fill action belongs to the sale control it acts on, so it is
 *    not mistaken for a third field;
 *  - the tier is context, not a source;
 *  - once an application is attached, the panel NAMES it.
 *
 * The last one is why the copy feedback is a strip rather than a sentence: the
 * operator must be able to see which application the agreement is being built
 * from, and that the copy still needs checking.
 */

const APPLICATION_ID = '00000000-0000-4000-8000-000000000003';
const SALE_ID = '00000000-0000-4000-8000-000000000002';
const SALE_NUMBER = 'QA-SALE-0001';
const APPLICATION_NUMBER = 'QA-APP-0001';

const holder = {
  holderType: 'PRIMARY' as const,
  firstName: 'Ana',
  middleName: 'Reyes',
  lastName: 'Santos',
  suffix: null,
};

vi.mock('./services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services')>();
  return {
    ...actual,
    getReservationAgreement: async () => null,
    getReservationFinance: async () => null,
    getReservationPayments: async () => [],
    getSales: async () => [{ id: SALE_ID, saleNumber: SALE_NUMBER, customerName: 'QA HOLDER' }],
    getCardProducts: async () => [],
    getCustomerApplications: async () => [
      {
        id: APPLICATION_ID,
        status: 'submitted',
        applicationNumber: APPLICATION_NUMBER,
        applicantName: 'QA HOLDER',
        tier: 'GOLD',
        createdBy: null,
        createdAt: '2026-09-01T00:00:00.000Z',
        submittedAt: '2026-09-01T00:00:00.000Z',
      },
    ],
    getCustomerApplication: async () => ({
      id: APPLICATION_ID,
      status: 'approved',
      applicationNumber: APPLICATION_NUMBER,
      applicantName: 'QA HOLDER',
      tier: 'GOLD',
      saleId: null,
      purchaseTermsId: '00000000-0000-4000-8000-000000000009',
      primary: holder,
      secondary: undefined,
      vipAmount: '100000.00',
      discountPercent: 0,
      validityYears: 7,
      yearlyPoints: 10000,
      annualPointsTranches: 5,
      holderLimit: 1,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      submittedAt: '2026-09-01T00:00:00.000Z',
      approvedAt: '2026-09-02T00:00:00.000Z',
      rejectedAt: null,
    }),
    getPurchaseTermsProposal: async () => ({
      applicationId: APPLICATION_ID,
      expectedProposalHash: 'a'.repeat(64),
      asOf: '2026-09-02T00:00:00.000Z',
      offerKind: 'newly_confirmed_offer',
      sellerName: 'QA SELLER NAME',
      terms: {
        customerId: '00000000-0000-4000-8000-000000000004',
        planId: '00000000-0000-4000-8000-000000000001',
        sellerStaffId: '00000000-0000-4000-8000-000000000005',
        captureKind: 'review',
        reason: 'Reviewed in the QA fixture.',
        tier: 'GOLD',
        paymentScheme: 'spot_cash',
        totalPrice: '100000.00',
        reservationFee: '10000.00',
        minimumDownPayment: '20000.00',
        requiredInitial: '20000.00',
        installmentMonths: null,
        monthlyAmount: null,
        spotCashDays: 7,
        validityMonths: 84,
        discountPercent: 0,
        yearlyPoints: 10000,
        annualPointsTranches: 5,
        holderLimit: 1,
        inclusions: ['QA benefit'],
        commissionRuleId: null,
        commissionRate: '0.04',
        commissionBase: '100000.00',
        expectedCommission: '4000.00',
      },
    }),
  };
});

const { ReservationAgreementEditorPage } = await import('./OfficialFormsPages');

const NEW_ROUTE = '/admin/sales/reservations/new';
const APPLICATION_ROUTE = `${NEW_ROUTE}?application=${APPLICATION_ID}`;

function renderNew(route: string) {
  return renderWithProviders(<ReservationAgreementEditorPage />, { route });
}

describe('reservation source panel', () => {
  it('groups the two alternative origins under one source group', async () => {
    renderNew(NEW_ROUTE);

    const source = await screen.findByRole('group', { name: 'Source' });
    expect(within(source).getByRole('combobox', { name: 'Card sale' })).toBeInTheDocument();
    expect(
      within(source).getByRole('combobox', { name: 'Source Customer Application' }),
    ).toBeInTheDocument();
  });

  it('keeps the auto-fill action with the sale control instead of beside it as a third field', async () => {
    renderNew(NEW_ROUTE);

    const source = await screen.findByRole('group', { name: 'Source' });
    // The action travels inside the source group, so it cannot be read as a
    // peer input, and the group holds exactly the two pickers.
    expect(within(source).getByRole('button', { name: 'Auto-fill from sale' })).toBeInTheDocument();
    expect(within(source).getAllByRole('combobox')).toHaveLength(2);
  });

  it('auto-fills the holder from the selected sale through the moved action', async () => {
    renderNew(NEW_ROUTE);
    const user = userEvent.setup();

    // The sale list loads on its own; the option has to exist before the
    // control can be driven.
    await screen.findByRole('option', { name: `${SALE_NUMBER} — QA HOLDER` });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Card sale' }), SALE_ID);
    await user.click(screen.getByRole('button', { name: 'Auto-fill from sale' }));

    expect(screen.getByLabelText('Name')).toHaveValue('QA HOLDER');
  });

  it('holds the imported tier apart from the sources, not inside them', async () => {
    renderNew(NEW_ROUTE);

    const source = await screen.findByRole('group', { name: 'Source' });
    // The tier is not a source: it stays out of the source group, so it can
    // never read as a third way to attach an agreement.
    expect(
      within(source).queryByRole('combobox', { name: 'Imported Tier' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Imported Tier' })).toBeInTheDocument();
  });

  it('names the attached application once it is linked', async () => {
    renderNew(APPLICATION_ROUTE);

    expect(await screen.findByText('Linked source')).toBeInTheDocument();
    expect(screen.getByText(APPLICATION_NUMBER)).toBeInTheDocument();
    expect(screen.getByText('Ana Reyes Santos')).toBeInTheDocument();
    expect(screen.getByText('approved')).toBeInTheDocument();
    expect(
      screen.getByText('Copied holder, tier and sale. Verify before saving.'),
    ).toBeInTheDocument();
  });

  it('keeps the sale picker out of an application-origin agreement', async () => {
    renderNew(APPLICATION_ROUTE);

    await screen.findByText('Linked source');
    expect(screen.queryByRole('combobox', { name: 'Card sale' })).not.toBeInTheDocument();
  });
});
