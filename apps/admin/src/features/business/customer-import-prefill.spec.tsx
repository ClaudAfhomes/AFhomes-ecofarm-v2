import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { renderWithProviders } from '../../test/utils';
import { CustomerApplicationEditorPage } from './OfficialFormsPages';
import { getCustomerImportPrefill, getCustomerById } from './services';

vi.mock('./services', async (original) => ({
  ...(await original()),
  getCardProducts: async () => [],
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
  await waitFor(() => expect(screen.getByLabelText('First name')).toHaveValue('Imported'));
  fireEvent.change(screen.getByLabelText('Customer'), { target: { value: second } });
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
