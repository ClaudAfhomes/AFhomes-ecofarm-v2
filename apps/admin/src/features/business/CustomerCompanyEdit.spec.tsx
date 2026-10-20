import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Customer } from '@afhomes/contracts';

import { CustomerCompanyEditDialog } from './CustomerCompanyEditDialog';
import { CustomerDetailPage } from './CustomerDetailPage';
import { renderWithProviders } from '../../test/utils';
import type { SessionUser } from '../../lib/session';
import { getCustomerById, getSales } from './services';
import { updateCustomer } from './services-customers';

vi.mock('./services', () => ({
  getCustomerById: vi.fn(),
  getSales: vi.fn(),
  getSalePayments: vi.fn(async () => []),
  getSaleSummary: vi.fn(),
  getCustomerApplications: vi.fn(),
  cancelSale: vi.fn(),
  updateCustomer: vi.fn(),
}));

vi.mock('./services-customers', () => ({
  updateCustomer: vi.fn(async (_id: string, input: unknown) => ({ id: _id, ...(input as object) })),
}));

const STAFF: SessionUser = {
  id: 'u-staff',
  name: 'Staff User',
  email: 'staff@afhomes.test',
  roleId: 'r-staff',
  roleSlug: 'admin',
  roleName: 'Admin',
  status: 'active',
  afHomesPermissions: [
    {
      moduleKey: 'sales.customers',
      canView: true,
      canCreate: true,
      canUpdate: true,
      canDelete: false,
    },
  ],
};

const VIEWER: SessionUser = {
  ...STAFF,
  afHomesPermissions: [
    {
      moduleKey: 'sales.customers',
      canView: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    },
  ],
};

const RECORD = {
  id: 'c-1',
  customerNumber: 'CUS-000001',
  fullName: 'MARIA SANTOS',
  email: 'maria@example.com',
  phone: '+639171234567',
  dateOfBirth: '1990-05-05',
  gender: 'female',
  status: 'active',
  raNumber: 'RA-1',
  tinNumber: '123456789',
  tinNumberMasked: '********9012',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
} as unknown as Customer;

const WITH_SUPPLEMENTARY = {
  ...RECORD,
  supplementaryFullName: 'JUAN CRUZ',
  supplementaryGender: 'male',
  supplementaryMobile: '+639181234567',
  supplementaryEmail: 'juan@example.com',
  supplementaryLandline: '(02) 8999-0000',
  supplementaryTinNumber: '987654321',
} as unknown as Customer;

function renderDetail(user: SessionUser = STAFF) {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/customers/:id" element={<CustomerDetailPage />} />
    </Routes>,
    { user, route: '/admin/customers/c-1' },
  );
}

beforeEach(() => {
  vi.mocked(getSales).mockResolvedValue([]);
  vi.mocked(getCustomerById).mockResolvedValue(RECORD);
  vi.mocked(updateCustomer).mockClear();
});

describe('Customer company edit', () => {
  it('offers Edit stated record only with update grant', async () => {
    renderDetail(VIEWER);
    await screen.findByRole('heading', { name: 'MARIA SANTOS' });
    expect(screen.queryByRole('button', { name: 'Edit stated record' })).not.toBeInTheDocument();
  });

  it('renders the verbatim form with prefilled locked TINs', async () => {
    renderWithProviders(
      <CustomerCompanyEditDialog
        customer={WITH_SUPPLEMENTARY}
        open
        onClose={() => {}}
        onSaved={() => {}}
      />,
      { user: STAFF, route: '/admin/customers/c-1' },
    );
    // Four sections are tabs; the primary member opens first.
    for (const tab of ['Primary', 'Supplementary', 'Related', 'Package']) {
      expect(await screen.findByRole('tab', { name: tab })).toBeInTheDocument();
    }
    // Both TINs show the current value, formatted, and start locked. The
    // supplementary panel stays mounted while hidden.
    const tins = await screen.findAllByLabelText('Tin');
    expect(tins).toHaveLength(2);
    expect((tins[0] as HTMLInputElement).value).toBe('123-456-789');
    expect((tins[1] as HTMLInputElement).value).toBe('987-654-321');
    for (const tin of tins) expect(tin).toHaveAttribute('readonly');
    expect(screen.getByRole('checkbox', { name: 'Edit TIN' })).not.toBeChecked();
    // The supplementary panel is hidden, so query its label directly.
    expect(screen.getByLabelText('Edit Supplementary TIN')).not.toBeChecked();
    expect(screen.getByText('TINs are locked. Check to edit.')).toBeInTheDocument();
    // Stored lowercase enums display Title Case, never "female (retired)".
    const sex = screen.getByLabelText('Sex') as HTMLSelectElement;
    expect(sex.value).toBe('female');
    expect(sex.selectedOptions[0]?.textContent).toBe('Female');
    const supplementaryGender = screen.getByLabelText('Gender') as HTMLSelectElement;
    expect(supplementaryGender.value).toBe('male');
    expect(supplementaryGender.selectedOptions[0]?.textContent).toBe('Male');
    // Stated section present, verbatim, no money math.
    expect(screen.getByLabelText('VIP Package')).toBeInTheDocument();
    expect(screen.getByLabelText('Ref No')).toBeInTheDocument();
    // SSOT address parts and related names stay editable.
    for (const label of [
      'Permanent Address Line 1',
      'Permanent Address Line 2',
      'SVD (Name)',
      'SSM (Name)',
      'SM (Name)',
      'Referrer (Name)',
      'VIP Recommender (Name)',
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    // Every panel stays mounted, so both member blocks keep their fields.
    expect(screen.getAllByLabelText('Landline')).toHaveLength(2);
    // One Email per member block (the related block uses Email Address).
    expect(screen.getAllByLabelText('Email')).toHaveLength(2);
    // Mobile No. exists only on the supplementary block (primary is Mobile).
    expect(screen.getAllByLabelText('Mobile No.')).toHaveLength(1);
  });

  it('reveals the supplementary form only after the toggle is switched on', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <CustomerCompanyEditDialog customer={RECORD} open onClose={() => {}} onSaved={() => {}} />,
      { user: STAFF, route: '/admin/customers/c-1' },
    );
    await user.click(await screen.findByRole('tab', { name: 'Supplementary' }));
    const toggle = screen.getByLabelText('Supplementary Member');
    expect(toggle).not.toBeChecked();
    expect(screen.getByText('No supplementary member.')).toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toBeChecked();
    expect(screen.getByLabelText('Supplementary Full Name')).toBeInTheDocument();
    expect(screen.queryByText('No supplementary member.')).not.toBeInTheDocument();
  });

  it('keeps a locked TIN and sends an edited one once unlocked', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <CustomerCompanyEditDialog customer={RECORD} open onClose={() => {}} onSaved={() => {}} />,
      { user: STAFF, route: '/admin/customers/c-1' },
    );
    const [tin] = screen.getAllByLabelText('Tin') as HTMLInputElement[];
    expect(tin).toHaveAttribute('readonly');
    expect(screen.getByRole('checkbox', { name: 'Edit TIN' })).not.toBeChecked();

    // Locked: saving keeps the stored value, so the payload omits it.
    await user.click(screen.getByRole('button', { name: 'Save company record' }));
    await waitFor(() => expect(vi.mocked(updateCustomer)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateCustomer).mock.calls[0]![1]).not.toHaveProperty('tinNumber');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save company record' })).toBeEnabled(),
    );

    // Unlocked: the formatted edit is sent.
    await user.click(screen.getByRole('checkbox', { name: 'Edit TIN' }));
    expect(tin).not.toHaveAttribute('readonly');
    await user.clear(tin!);
    await user.type(tin!, '987654321');
    expect(tin!.value).toBe('987-654-321');
    await user.click(screen.getByRole('button', { name: 'Save company record' }));
    await waitFor(() => expect(vi.mocked(updateCustomer)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(updateCustomer).mock.calls[1]![1]).toMatchObject({
      tinNumber: '987-654-321',
    });
  });
});
