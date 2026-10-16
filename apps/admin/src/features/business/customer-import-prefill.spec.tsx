import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { renderWithProviders } from '../../test/utils';
import { CustomerApplicationEditorPage } from './OfficialFormsPages';
import { getCustomerImportPrefill, getCustomerById } from './services';

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
  vi.mocked(getCustomerById).mockClear();
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
