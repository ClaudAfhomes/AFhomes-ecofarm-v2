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
async function tier(initial = '') {
  const view = mount();
  const input = screen.getByLabelText<HTMLInputElement>(/Imported tier context/);
  await view.user.type(input, initial || 'silver');
  if (!initial) await view.user.clear(input);
  input.focus();
  return { ...view, input };
}
it('actual IST tier end typing uppercases', async () => {
  const { input, user } = await tier();
  await user.type(input, 'silver');
  expect(input.value).toBe('SILVER');
  expect(input.selectionStart).toBe(6);
});
it('actual IST tier mid-string insertion restores both selection endpoints', async () => {
  const { input, user } = await tier('SILVER MEMBER');
  input.setSelectionRange(2, 2);
  await user.keyboard('x');
  expect(input.value).toBe('SIXLVER MEMBER');
  expect(input.selectionStart).toBe(3);
  expect(input.selectionEnd).toBe(3);
});
it('actual IST tier second insertion stays in place after rerender', async () => {
  const { input, user } = await tier('SILVER MEMBER');
  input.setSelectionRange(2, 2);
  await user.keyboard('x');
  expect(input.selectionStart).toBe(3);
  await user.keyboard('y');
  expect(input.value).toBe('SIXYLVER MEMBER');
  expect(input.selectionStart).toBe(4);
  expect(input.selectionEnd).toBe(4);
});
it('actual IST tier selection replacement', async () => {
  const { input, user } = await tier('SILVER MEMBER');
  input.setSelectionRange(0, 6);
  await user.keyboard('gold');
  expect(input.value).toBe('GOLD MEMBER');
  expect(input.selectionStart).toBe(4);
});
it('actual IST tier backspace', async () => {
  const { input, user } = await tier('SILVER MEMBER');
  input.setSelectionRange(3, 3);
  await user.keyboard('{Backspace}');
  expect(input.value).toBe('SIVER MEMBER');
  expect(input.selectionStart).toBe(2);
});
it('actual IST tier Delete', async () => {
  const { input, user } = await tier('SILVER MEMBER');
  input.setSelectionRange(2, 2);
  await user.keyboard('{Delete}');
  expect(input.value).toBe('SIVER MEMBER');
  expect(input.selectionStart).toBe(2);
});
it('actual IST tier paste uppercases and retains middle caret', async () => {
  const { input, user } = await tier('SILVER MEMBER');
  input.setSelectionRange(2, 2);
  await user.paste('xy');
  expect(input.value).toBe('SIXYLVER MEMBER');
  expect(input.selectionStart).toBe(4);
});
it('actual IST tier Unicode expansion uses the shared prefix mapping', async () => {
  const { input, user } = await tier('SILVER');
  input.setSelectionRange(2, 2);
  await user.paste('ß');
  expect(input.value).toBe('SISSLVER');
  expect(input.selectionStart).toBe(4);
});
it('actual IST tier retains the existing canonical enum payload behavior', async () => {
  const { input, user } = await tier('gold');
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
  expect(await screen.findByText('00000000-0000-4000-8000-000000000005')).toBeInTheDocument();
  await user.type(screen.getByLabelText('name'), 'QA HOLDER');
  await user.type(screen.getByLabelText('address'), '1 QA STREET');
  await user.type(screen.getByLabelText('contactNumber'), '09171234567');
  await user.type(screen.getByLabelText('email'), 'qa@example.com');
  await user.click(screen.getByRole('button', { name: 'Create Reservation Agreement' }));
  await waitFor(() => expect(calls.reservation).toHaveBeenCalled());
  // Application-origin carries the frozen terms reference and no sale id.
  expect(calls.reservation.mock.calls[0]?.[0]).toMatchObject({ origin: 'application' });
  expect(calls.reservation.mock.calls[0]?.[0]).not.toHaveProperty('saleId');
  expect(
    purchaseReservationCreateSchema.safeParse(calls.reservation.mock.calls[0]?.[0]).error,
  ).toBeUndefined();
  await user.clear(input);
  await user.type(input, 'silver member');
  await user.click(screen.getByRole('button', { name: 'Create Reservation Agreement' }));
  await waitFor(() => expect(calls.reservation).toHaveBeenCalledTimes(2));
  expect(calls.reservation.mock.calls[1]?.[0]).not.toHaveProperty('vipTier');
});
it('actual IST tier IME preserves the draft and commits once complete', async () => {
  const { input } = await tier('AB');
  input.setSelectionRange(1, 1);
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: 'AßB', selectionStart: 2, selectionEnd: 2 } });
  expect(input.value).toBe('AßB');
  fireEvent.compositionEnd(input, { data: 'ß' });
  expect(input.value).toBe('ASSB');
  expect(input.selectionStart).toBe(3);
});
it('primary landline shows a field error and prevents save; empty clears the error', async () => {
  const { user } = mount(true);
  const input = screen.getByLabelText('Landline');
  await user.type(input, '09ABC123456');
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid contact number.');
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  expect(calls.application).not.toHaveBeenCalled();
  await user.clear(input);
  expect(screen.queryByText('Enter a valid contact number.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
});
it('supplementary landline gets its own frontend error', async () => {
  const { user } = mount(true);
  await screen.findByRole('option', { name: 'Gold' });
  await user.selectOptions(
    await screen.findByLabelText('VIP plan'),
    '00000000-0000-4000-8000-000000000001',
  );
  await user.click(screen.getByLabelText(/Add optional Gold secondary/));
  const input = screen.getAllByLabelText('Landline')[1]!;
  await user.type(input, 'PHONE123');
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  expect(calls.application).not.toHaveBeenCalled();
});
it('recommender contact gets its own frontend error and valid formatting is allowed', async () => {
  const { user } = mount(true);
  const input = screen.getByLabelText('Recommender Contact');
  await user.type(input, '0917TEST');
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  await user.clear(input);
  await user.type(input, '0917-123-4567');
  expect(input).not.toHaveAttribute('aria-invalid');
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
});
