import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { purchaseReservationCreateSchema } from '@afhomes/contracts';
import type {
  CreateCustomerApplicationRequest,
  CreateReservationAgreementRequest,
} from '@afhomes/contracts';
import {
  CustomerApplicationEditorPage,
  ReservationAgreementEditorPage,
} from './OfficialFormsPages';
vi.mock('../../lib/session', () => ({ useSession: () => ({ user: null }) }));
const calls = vi.hoisted(() => ({
  application: vi.fn<(input: CreateCustomerApplicationRequest) => Promise<never>>(),
  reservation: vi.fn<(input: CreateReservationAgreementRequest) => Promise<never>>(),
}));
vi.mock('./services', async (original) => ({
  ...(await original()),
  getCustomers: async () => [],
  getCustomerApplications: async () => [
    {
      id: '00000000-0000-4000-8000-000000000003',
      status: 'submitted',
      applicationNumber: 'QA-APP',
      applicantName: 'QA HOLDER',
    },
  ],
  getCustomerApplication: async () => ({
    id: '00000000-0000-4000-8000-000000000003',
    status: 'approved',
    applicationNumber: 'QA-APP',
    applicantName: 'QA HOLDER',
    vipAmount: '100000.00',
    discountPercent: 0,
    validityYears: 7,
    yearlyPoints: 10000,
    annualPointsTranches: 5,
    holderLimit: 1,
    // An application-origin reservation names its frozen terms record. Without
    // one the UI refuses to create, which is the honest review-required state.
    purchaseTermsId: '00000000-0000-4000-8000-000000000009',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    submittedAt: '2026-09-01T00:00:00.000Z',
    approvedAt: '2026-09-02T00:00:00.000Z',
    rejectedAt: null,
  }),
  getSales: async () => [
    {
      id: '00000000-0000-4000-8000-000000000002',
      saleNumber: 'QA-SALE',
      customerName: 'QA HOLDER',
    },
  ],
  getCardProducts: async () => [
    {
      id: '00000000-0000-4000-8000-000000000001',
      code: 'GOLD',
      name: 'Gold',
      isActive: true,
      categoryIsActive: true,
      discountPercent: 25,
      cardholderLimit: 2,
      yearlyPoints: 25000,
      annualPointsTranches: 20,
      baseValidityYears: 20,
      validityExtensionYears: 2,
      totalLoyaltyValue: '500000.00',
    },
    {
      id: '00000000-0000-4000-8000-000000000006',
      code: 'SILVER',
      name: 'Silver',
      isActive: true,
      categoryIsActive: true,
      discountPercent: 15,
      cardholderLimit: 1,
      yearlyPoints: 10000,
      annualPointsTranches: 10,
      baseValidityYears: 10,
      validityExtensionYears: 1,
      totalLoyaltyValue: '192000.00',
    },
    {
      id: '00000000-0000-4000-8000-000000000007',
      code: 'BRONZE',
      name: 'Bronze',
      isActive: true,
      categoryIsActive: true,
      discountPercent: 5,
      cardholderLimit: 1,
      yearlyPoints: 5000,
      annualPointsTranches: 5,
      baseValidityYears: 5,
      validityExtensionYears: 0,
      totalLoyaltyValue: '54000.00',
    },
  ],
  createCustomerApplication: calls.application,
  createReservationAgreement: calls.reservation,
  // Application-origin creation reads the server-authoritative offer first; the
  // page refuses to create without it, so it is part of the happy path.
  getPurchaseTermsProposal: async () => ({
    applicationId: '00000000-0000-4000-8000-000000000003',
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
}));
vi.mock('../genealogy/services', () => ({
  getGenealogy: async () => [],
  getGenealogyNode: async () => null,
  getGenealogyUpline: async () => [],
  getGenealogyDownline: async () => [],
  getGenealogySummary: async () => null,
}));
const clients: QueryClient[] = [];
beforeEach(() => {
  calls.application.mockReset().mockRejectedValue(new Error('QA save capture'));
  calls.reservation.mockReset().mockRejectedValue(new Error('QA save capture'));
});
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
});
function mount(application = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {application ? <CustomerApplicationEditorPage /> : <ReservationAgreementEditorPage />}
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, user: userEvent.setup() };
}
type QAUser = ReturnType<typeof userEvent.setup>;
const GOLD_PLAN_ID = '00000000-0000-4000-8000-000000000001';
/**
 * Walk the new-application wizard to the Holders step: pick Gold on
 * Application, then satisfy Identity with a picked (not yet uploaded) ID.
 * Upload happens on Save, so no server upload runs during navigation.
 */
async function goToHolders(user: QAUser) {
  await screen.findByRole('option', { name: 'Gold' });
  await user.selectOptions(await screen.findByLabelText('VIP plan'), GOLD_PLAN_ID);
  await user.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.change(await screen.findByLabelText('ID Type'), { target: { value: 'passport' } });
  fireEvent.change(screen.getByLabelText('Upload ID'), {
    target: { files: [new File(['x'], 'x.png', { type: 'image/png' })] },
  });
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByLabelText('First name');
}
/** Fill the required primary fields so Holders Next unlocks. */
function fillPrimaryHolders() {
  fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Ana' } });
  fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Santos' } });
  fireEvent.change(screen.getByLabelText('Birth date'), { target: { value: '1990-01-01' } });
  fireEvent.change(screen.getByLabelText('Mobile'), { target: { value: '+639171234567' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@example.com' } });
  fireEvent.change(screen.getByLabelText('Printed name'), { target: { value: 'Ana Santos' } });
}
/**
 * Uppercase-with-live-caret behaviour, exercised through the holder ADDRESS.
 *
 * This used to ride on "Imported Tier", which is now a closed dropdown and
 * therefore cannot be typed into. `Address` is the right vehicle instead:
 * `normalizeLiveHumanField` still uppercases it live on this very screen, so
 * the caret/IME/Unicode contract stays covered by a field that still exists.
 */
async function typedField(initial = '') {
  const view = mount();
  const input = screen.getByLabelText<HTMLInputElement>('Address');
  if (initial) await view.user.type(input, initial);
  input.focus();
  return { ...view, input };
}
it('actual IST address end typing uppercases', async () => {
  const { input, user } = await typedField();
  await user.type(input, 'silver');
  expect(input.value).toBe('SILVER');
  expect(input.selectionStart).toBe(6);
});
it('actual IST address mid-string insertion restores both selection endpoints', async () => {
  const { input, user } = await typedField('SILVER MEMBER');
  input.setSelectionRange(2, 2);
  await user.keyboard('x');
  expect(input.value).toBe('SIXLVER MEMBER');
  expect(input.selectionStart).toBe(3);
  expect(input.selectionEnd).toBe(3);
});
it('actual IST address second insertion stays in place after rerender', async () => {
  const { input, user } = await typedField('SILVER MEMBER');
  input.setSelectionRange(2, 2);
  await user.keyboard('x');
  expect(input.selectionStart).toBe(3);
  await user.keyboard('y');
  expect(input.value).toBe('SIXYLVER MEMBER');
  expect(input.selectionStart).toBe(4);
  expect(input.selectionEnd).toBe(4);
});
it('actual IST address selection replacement', async () => {
  const { input, user } = await typedField('SILVER MEMBER');
  input.setSelectionRange(0, 6);
  await user.keyboard('gold');
  expect(input.value).toBe('GOLD MEMBER');
  expect(input.selectionStart).toBe(4);
});
it('actual IST address backspace', async () => {
  const { input, user } = await typedField('SILVER MEMBER');
  input.setSelectionRange(3, 3);
  await user.keyboard('{Backspace}');
  expect(input.value).toBe('SIVER MEMBER');
  expect(input.selectionStart).toBe(2);
});
it('actual IST address Delete', async () => {
  const { input, user } = await typedField('SILVER MEMBER');
  input.setSelectionRange(2, 2);
  await user.keyboard('{Delete}');
  expect(input.value).toBe('SIVER MEMBER');
  expect(input.selectionStart).toBe(2);
});
it('actual IST address paste uppercases and retains middle caret', async () => {
  const { input, user } = await typedField('SILVER MEMBER');
  input.setSelectionRange(2, 2);
  await user.paste('xy');
  expect(input.value).toBe('SIXYLVER MEMBER');
  expect(input.selectionStart).toBe(4);
});
it('actual IST address Unicode expansion uses the shared prefix mapping', async () => {
  const { input, user } = await typedField('SILVER');
  input.setSelectionRange(2, 2);
  await user.paste('ß');
  expect(input.value).toBe('SISSLVER');
  expect(input.selectionStart).toBe(4);
});
it('actual IST tier is a closed dropdown, not a free-text box', async () => {
  const view = mount();
  const select = screen.getByLabelText<HTMLSelectElement>('Imported Tier');
  expect(select.tagName).toBe('SELECT');
  expect([...select.options].map((option) => option.value)).toEqual([
    '',
    'BRONZE',
    'SILVER',
    'GOLD',
  ]);
  await view.user.selectOptions(select, 'GOLD');
  expect(select.value).toBe('GOLD');
});
it('actual IST tier retains the existing canonical enum payload behavior', async () => {
  const view = mount();
  const select = screen.getByLabelText<HTMLSelectElement>('Imported Tier');
  await view.user.selectOptions(select, 'GOLD');
  const { user } = view;
  // The save now validates the whole official form. A tier assertion needs a
  // valid holder fixture; an empty form must not reach a creation API.
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Source Customer Application' }),
    '00000000-0000-4000-8000-000000000003',
  );
  // Application-origin mode: there is NO Card sale to pick. A first-time
  // purchase creates the agreement first and the sale only at finalization, so
  // the selector is removed rather than merely ignored.
  expect(screen.queryByRole('combobox', { name: 'Card sale' })).not.toBeInTheDocument();
  expect(await screen.findByText('QA SELLER NAME')).toBeInTheDocument();
  await user.type(screen.getByLabelText('Name'), 'QA HOLDER');
  await user.type(screen.getByLabelText('Address'), '1 QA STREET');
  await user.type(screen.getByLabelText('Contact Number'), '09171234567');
  await user.type(screen.getByLabelText('Email'), 'qa@example.com');
  await user.click(screen.getByRole('button', { name: 'Create Reservation Agreement' }));
  await waitFor(() => expect(calls.reservation).toHaveBeenCalled());
  // Application-origin carries the frozen terms reference and no sale id.
  expect(calls.reservation.mock.calls[0]?.[0]).toMatchObject({ origin: 'application' });
  expect(calls.reservation.mock.calls[0]?.[0]).not.toHaveProperty('saleId');
  expect(
    purchaseReservationCreateSchema.safeParse(calls.reservation.mock.calls[0]?.[0]).error,
  ).toBeUndefined();
  await user.click(await screen.findByRole('button', { name: 'OK' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  // SweetAlert removes the dialog before its delayed focus restoration completes.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Create Reservation Agreement' })).toHaveFocus(),
  );
  // An application-origin payload carries no vipTier by design, so this asserts
  // the stronger, real property: a tier can only ever be a value the schema
  // accepts, and clearing it never emits an empty or invented tier.
  await user.selectOptions(select, '');
  await user.click(await screen.findByRole('button', { name: 'Create Reservation Agreement' }));
  await waitFor(() => expect(calls.reservation).toHaveBeenCalledTimes(2));
  expect(calls.reservation.mock.calls[1]?.[0]).not.toHaveProperty('vipTier');
});
it('actual IST address IME preserves the draft and commits once complete', async () => {
  const { input } = await typedField('AB');
  input.setSelectionRange(1, 1);
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: 'AßB', selectionStart: 2, selectionEnd: 2 } });
  expect(input.value).toBe('AßB');
  fireEvent.compositionEnd(input, { data: 'ß' });
  expect(input.value).toBe('ASSB');
  expect(input.selectionStart).toBe(3);
});
/**
 * The single save-and-submit action renders its blockers as one visible list.
 * Its text is read through the title paragraph's container.
 */
const blockersText = () =>
  screen.queryByText('Cannot save and submit yet:')?.parentElement?.textContent ?? '';
it('primary landline refuses letters and blocks save while the number is invalid', async () => {
  const { user } = mount(true);
  await goToHolders(user);
  const input = screen.getByLabelText<HTMLInputElement>('Landline');
  await user.type(input, '09ABC123456');
  // Letters are refused at the keystroke: a landline can never hold them. The
  // attempt still flags the field until a deliberate correction, so the
  // operator knows a keystroke was rejected rather than silently dropped.
  expect(input.value).toBe('09123456');
  expect(input).toHaveAttribute('aria-invalid', 'true');
  await user.clear(input);
  expect(screen.queryByText('Enter a valid contact number.')).not.toBeInTheDocument();
  await user.type(input, '123');
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid contact number.');
  expect(blockersText()).toContain('Correct the recommender contact or landline number.');
  // Submit lives in the sticky footer only; it shares state with the removed header action.
  expect(screen.getAllByRole('button', { name: 'Submit' })).toHaveLength(1);
  for (const save of screen.getAllByRole('button', { name: 'Submit' }))
    expect(save).toBeDisabled();
  expect(calls.application).not.toHaveBeenCalled();
  await user.clear(input);
  expect(screen.queryByText('Enter a valid contact number.')).not.toBeInTheDocument();
  // Clearing the field removes its blocker; the remaining blockers are other,
  // unrelated requirements.
  expect(blockersText()).not.toContain('Correct the recommender contact or landline number.');
});
it('supplementary landline gets its own frontend error', async () => {
  const { user } = mount(true);
  await goToHolders(user);
  await user.click(screen.getByLabelText(/Add optional Gold secondary/));
  const input = screen.getAllByLabelText<HTMLInputElement>('Landline')[1]!;
  await user.type(input, 'PHONE123');
  // The letters never land; the surviving digits are too short to be a number.
  expect(input.value).toBe('123');
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(blockersText()).toContain('Correct the recommender contact or landline number.');
  for (const save of screen.getAllByRole('button', { name: 'Submit' }))
    expect(save).toBeDisabled();
  expect(calls.application).not.toHaveBeenCalled();
});
it('recommender contact gets its own frontend error and valid formatting is allowed', async () => {
  const { user } = mount(true);
  await goToHolders(user);
  fillPrimaryHolders();
  await user.click(screen.getByRole('button', { name: 'Next' }));
  const input = await screen.findByLabelText('Recommender Contact');
  await user.type(input, '0917TEST');
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(blockersText()).toContain('Correct the recommender contact or landline number.');
  for (const save of screen.getAllByRole('button', { name: 'Submit' }))
    expect(save).toBeDisabled();
  await user.clear(input);
  await user.type(input, '0917-123-4567');
  expect(input).not.toHaveAttribute('aria-invalid');
  expect(blockersText()).not.toContain('Correct the recommender contact or landline number.');
});

it.each(['Silver', 'Bronze', 'Select plan'])(
  'clears Gold secondary holder when changing to %s',
  async (label) => {
    const { user } = mount(true);
    await goToHolders(user);
    await user.click(screen.getByLabelText(/Add optional Gold secondary/));
    expect(screen.getByRole('group', { name: /Secondary holder/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.selectOptions(
      screen.getByLabelText('VIP plan'),
      screen.getByRole('option', { name: label }),
    );
    // Clearing the plan locks step 0 (nothing to proceed with), so re-pick
    // Gold to observe the cleared secondary state on the Holders step. A
    // stale secondary would still render its group there.
    const reselected = label === 'Select plan';
    if (reselected) {
      await user.selectOptions(
        screen.getByLabelText('VIP plan'),
        screen.getByRole('option', { name: 'Gold' }),
      );
    }
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByLabelText(/Add optional Gold secondary/);
    expect(screen.getByLabelText(/Add optional Gold secondary/)).not.toBeChecked();
    if (reselected) {
      expect(screen.getByLabelText(/Add optional Gold secondary/)).toBeEnabled();
    } else {
      expect(screen.getByLabelText(/Add optional Gold secondary/)).toBeDisabled();
    }
    expect(screen.queryByRole('group', { name: /Secondary holder/ })).not.toBeInTheDocument();
  },
);
