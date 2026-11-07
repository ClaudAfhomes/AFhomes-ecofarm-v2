import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { renderWithProviders } from '../../test/utils';
import { CustomerApplicationEditorPage, humanizeApplicationIssues } from './OfficialFormsPages';
import { getCustomerImportPrefill, getCustomerById } from './services';
import { ApiError } from '../../lib/api/errors';

vi.mock('./services', async (original) => ({
  ...(await original()),
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
  ],
  getCustomersPage: async () => ({
    data: [
      {
        id: 'aaaaaaaa-0000-4000-8000-000000000001',
        fullName: 'Customer Alpha',
        customerNumber: 'AF-CUS-AAAAA',
      },
      {
        id: 'aaaaaaaa-0000-4000-8000-000000000002',
        fullName: 'Customer Beta',
        customerNumber: 'AF-CUS-BBBBB',
      },
    ],
    meta: { total: 2 },
  }),
  getCustomerById: vi.fn(async (id: string) => ({ id, fullName: 'Synthetic customer' })),
  getCustomerImportPrefill: vi.fn(),
}));
vi.mock('../documents/services', async (original) => ({
  ...(await original()),
  getDocuments: async () => [],
  getCurrentDocument: async () => null,
}));
vi.mock('../../lib/api/client', () => ({
  requestList: async () => [],
  setApiAccessTokenForTests: vi.fn(),
}));

const first = 'aaaaaaaa-0000-4000-8000-000000000001';
const second = 'aaaaaaaa-0000-4000-8000-000000000002';
const GOLD_PLAN_ID = '00000000-0000-4000-8000-000000000001';
/**
 * Walk the new-application wizard to the Holders step: pick Gold on
 * Application, then satisfy Identity with a picked (not yet uploaded) ID.
 * Upload happens on Save, so no server upload runs during navigation.
 */
async function goToHolders() {
  await screen.findByRole('option', { name: 'Gold' });
  await userEvent.selectOptions(await screen.findByLabelText('VIP plan'), GOLD_PLAN_ID);
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.change(await screen.findByLabelText('ID Type'), { target: { value: 'passport' } });
  fireEvent.change(screen.getByLabelText('Upload ID'), {
    target: { files: [new File(['x'], 'x.png', { type: 'image/png' })] },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByLabelText('First name');
}
const prefill: Awaited<ReturnType<typeof getCustomerImportPrefill>> = {
  primary: { firstName: 'Imported', lastName: 'Applicant' },
  secondary: null,
  recommenderName: '',
  recommenderContact: '',
  recommenderEmail: '',
  salesManagerName: '',
  referrerName: '',
  missingFields: ['Customer consent'],
};
beforeEach(() => {
  vi.mocked(getCustomerImportPrefill).mockReset();
  // A full reset (not just mockClear) so a queued mockResolvedValueOnce from a
  // test that never consumed it cannot leak into the next test's first call.
  vi.mocked(getCustomerById).mockReset();
  vi.mocked(getCustomerById).mockImplementation(
    async (id: string) =>
      ({ id, fullName: 'Synthetic customer' }) as Awaited<ReturnType<typeof getCustomerById>>,
  );
});
function show() {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/customers/applications/new" element={<CustomerApplicationEditorPage />} />
    </Routes>,
    {
      route: '/admin/customers/applications/new',
      user: {
        id: first,
        name: 'Synthetic importer',
        email: 'synthetic@example.invalid',
        roleId: first,
        roleSlug: 'admin',
        roleName: 'Admin',
        status: 'active',
        afHomesPermissions: [
          {
            moduleKey: 'governance.customer_import',
            canView: true,
            canCreate: true,
            canUpdate: true,
            canDelete: false,
          },
        ],
      },
    },
  );
}
it('clears imported holder details when a different customer is selected', async () => {
  vi.mocked(getCustomerImportPrefill).mockResolvedValue(prefill);
  show();
  await screen.findByRole('option', { name: /Customer Alpha/ });
  fireEvent.change(screen.getByLabelText('Customer'), { target: { value: first } });
  await userEvent.click(
    await screen.findByRole('button', { name: 'Load imported customer details' }),
  );
  // Success raises the subfile's "Attention" modal; dismiss it before walking
  // the wizard, then holder fields live on the Holders step.
  fireEvent.click(await screen.findByRole('button', { name: 'OK' }));
  await goToHolders();
  await waitFor(() => expect(screen.getByLabelText('First name')).toHaveValue('Imported'));
  // Back to Application, switch customer, walk forward again: the imported
  // details must not survive the switch.
  await userEvent.click(screen.getByRole('button', { name: 'Back' }));
  await userEvent.click(screen.getByRole('button', { name: 'Back' }));
  fireEvent.change(screen.getByLabelText('Customer'), { target: { value: second } });
  await goToHolders();
  expect(screen.getByLabelText('First name')).toHaveValue('');
});
it.each([false, true])('uses the contract-required address for imported holder completion (address supplied: %s)', async (addressSupplied) => {
  vi.mocked(getCustomerImportPrefill).mockResolvedValue({
    ...prefill,
    primary: {
      firstName: 'Imported', lastName: 'Applicant', birthDate: '1990-01-01',
      mobile: '+639170000201', email: 'applicant@example.invalid', printedName: 'Imported Applicant',
      ...(addressSupplied ? { permanentAddressLine1: 'Synthetic QA address', province: 'Laguna', cityMunicipality: 'Alaminos' } : {}),
    },
  });
  show();
  await screen.findByRole('option', { name: /Customer Alpha/ });
  fireEvent.change(screen.getByLabelText('Customer'), { target: { value: first } });
  await userEvent.click(await screen.findByRole('button', { name: 'Load imported customer details' }));
  fireEvent.click(await screen.findByRole('button', { name: 'OK' }));
  await goToHolders();
  if (addressSupplied) expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  else {
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByText('Complete primary holder fields.')).toBeInTheDocument();
  }
});
it('summarizes holder validation without raw schema details or repeated messages', () => {
  expect(humanizeApplicationIssues([
    { path: ['primary', 'permanentAddressLine1'], message: 'Too small: expected string to have >=1 characters' },
    { path: ['primary', 'province'], message: 'Too small: expected string to have >=1 characters' },
  ])).toBe("Review the primary holder's identity, address and contact fields.");
});
it('ignores a late import-prefill response for a customer that is no longer selected', async () => {
  let finish!: (value: typeof prefill) => void;
  vi.mocked(getCustomerImportPrefill).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  show();
  await screen.findByRole('option', { name: /Customer Alpha/ });
  fireEvent.change(screen.getByLabelText('Customer'), { target: { value: first } });
  await userEvent.click(
    await screen.findByRole('button', { name: 'Load imported customer details' }),
  );
  fireEvent.change(screen.getByLabelText('Customer'), { target: { value: second } });
  await act(async () => finish(prefill));
  await goToHolders();
  expect(screen.getByLabelText('First name')).toHaveValue('');
});
it('shows a friendly empty-state message (not a warning) when the customer has no committed workbook import', async () => {
  vi.mocked(getCustomerImportPrefill).mockRejectedValueOnce(
    new ApiError({
      code: 'NOT_FOUND',
      message: 'No committed company workbook details for this customer',
      status: 404,
    }),
  );
  show();
  await screen.findByRole('option', { name: /Customer Alpha/ });
  fireEvent.change(screen.getByLabelText('Customer'), { target: { value: first } });
  await userEvent.click(
    await screen.findByRole('button', { name: 'Load imported customer details' }),
  );
  await screen.findByText('No workbook import found');
  await screen.findByText(
    'This customer has no committed workbook import on file. Their existing profile details are already filled in - continue the application by hand.',
  );
  // The raw server message must not be shown verbatim, and this is not an "Attention" warning.
  expect(
    screen.queryByText('No committed company workbook details for this customer'),
  ).not.toBeInTheDocument();
  expect(screen.queryByText('Attention')).not.toBeInTheDocument();
});
it('merges committed workbook details on top of the customer profile, not in place of it', async () => {
  vi.mocked(getCustomerById).mockResolvedValueOnce({
    id: first,
    fullName: 'Customer Alpha',
    firstName: 'Customer',
    lastName: 'Alpha',
    email: 'alpha@example.invalid',
    phone: '+639171234567',
    dateOfBirth: '1990-01-01',
    address: { line1: '1 Test St', city: 'Quezon City', province: 'Metro Manila' },
  } as Awaited<ReturnType<typeof getCustomerById>>);
  vi.mocked(getCustomerImportPrefill).mockResolvedValueOnce({
    ...prefill,
    // The workbook supplies a corrected last name and a field the base
    // customer profile never carries (citizenship).
    primary: { lastName: 'Alpha-Corrected', citizenship: 'Filipino' },
  });
  show();
  await screen.findByRole('option', { name: /Customer Alpha/ });
  fireEvent.change(screen.getByLabelText('Customer'), { target: { value: first } });
  await userEvent.click(
    await screen.findByRole('button', { name: 'Load imported customer details' }),
  );
  // Success raises the "Attention" modal; dismiss it before walking the wizard.
  fireEvent.click(await screen.findByRole('button', { name: 'OK' }));
  await goToHolders();
  // Workbook value wins where both sources have one.
  expect(screen.getByLabelText('Last name')).toHaveValue('Alpha-Corrected');
  // Profile value survives where the workbook doesn't supply its own.
  expect(screen.getByLabelText('First name')).toHaveValue('Customer');
});
it('leaves every unavailable field blank and editable for a customer profile with only a name on file', async () => {
  // Default mock already returns a bare { id, fullName } with no other
  // fields - the realistic shape for a customer record with no address,
  // phone, birth date, etc. captured yet.
  show();
  await screen.findByRole('option', { name: /Customer Alpha/ });
  fireEvent.change(screen.getByLabelText('Customer'), { target: { value: first } });
  await goToHolders();
  expect(screen.getByLabelText('First name')).toHaveValue('');
  expect(screen.getByLabelText('Last name')).toHaveValue('');
});
it('shows the actual failure as a warning, distinct from the normal no-import case', async () => {
  vi.mocked(getCustomerImportPrefill).mockRejectedValueOnce(
    new ApiError({ code: 'INTERNAL', message: 'Import service is unavailable', status: 500 }),
  );
  show();
  await screen.findByRole('option', { name: /Customer Alpha/ });
  fireEvent.change(screen.getByLabelText('Customer'), { target: { value: first } });
  await userEvent.click(
    await screen.findByRole('button', { name: 'Load imported customer details' }),
  );
  await screen.findByText('Attention');
  await screen.findByText('Import service is unavailable');
  expect(screen.queryByText('No workbook import found')).not.toBeInTheDocument();
});
it('prefills the primary holder from the customer profile as soon as a manually created customer is selected, with no import needed', async () => {
  vi.mocked(getCustomerById).mockResolvedValueOnce({
    id: first,
    fullName: 'Customer Alpha',
    firstName: 'Customer',
    lastName: 'Alpha',
    email: 'alpha@example.invalid',
    phone: '+639171234567',
    dateOfBirth: '1990-01-01',
    address: { line1: '1 Test St', city: 'Quezon City', province: 'Metro Manila' },
  } as Awaited<ReturnType<typeof getCustomerById>>);
  show();
  await screen.findByRole('option', { name: /Customer Alpha/ });
  fireEvent.change(screen.getByLabelText('Customer'), { target: { value: first } });
  await goToHolders();
  expect(screen.getByLabelText('First name')).toHaveValue('Customer');
  expect(screen.getByLabelText('Last name')).toHaveValue('Alpha');
  expect(getCustomerImportPrefill).not.toHaveBeenCalled();
});
it('shows a retryable customer lookup error instead of indefinite loading', async () => {
  vi.mocked(getCustomerById).mockRejectedValueOnce(new Error('Synthetic lookup failure'));
  show();
  await screen.findByRole('option', { name: /Customer Alpha/ });
  fireEvent.change(screen.getByLabelText('Customer'), { target: { value: first } });
  await userEvent.click(await screen.findByRole('button', { name: 'Retry customer details' }));
  await waitFor(() => expect(getCustomerById).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Retry customer details' }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.queryByText('Loading customer…')).not.toBeInTheDocument();
});
