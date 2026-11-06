import { fireEvent, screen, waitFor } from '@testing-library/react';
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
import {
  completeDocumentUpload,
  getCurrentDocument,
  getDocumentAccessUrl,
  putUploadBytes,
  requestUploadGrant,
} from '../documents/services';

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

// The ID image/upload lives on the documents API, not the customers one.
vi.mock('../documents/services', () => ({
  getCurrentDocument: vi.fn(async () => null),
  getDocumentAccessUrl: vi.fn(),
  requestUploadGrant: vi.fn(),
  putUploadBytes: vi.fn(),
  completeDocumentUpload: vi.fn(),
  ACCEPTED_MIME: ['image/jpeg', 'image/png', 'application/pdf'],
  MAX_BYTES: 10 * 1024 * 1024,
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
  governmentIdType: 'passport',
  governmentIdMasked: '****4321',
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
  vi.mocked(getCurrentDocument).mockReset().mockResolvedValue(null);
  vi.mocked(getDocumentAccessUrl).mockReset();
  vi.mocked(requestUploadGrant).mockReset();
  vi.mocked(putUploadBytes).mockReset();
  vi.mocked(completeDocumentUpload).mockReset();
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
    expect(screen.getByLabelText('VIP Card Number')).toHaveAttribute('readonly');
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
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(vi.mocked(updateCustomer)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateCustomer).mock.calls[0]![1]).not.toHaveProperty('tinNumber');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );

    // Unlocked: the formatted edit is sent.
    await user.click(screen.getByRole('checkbox', { name: 'Edit TIN' }));
    expect(tin).not.toHaveAttribute('readonly');
    await user.clear(tin!);
    await user.type(tin!, '987654321');
    expect(tin!.value).toBe('987-654-321');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(vi.mocked(updateCustomer)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(updateCustomer).mock.calls[1]![1]).toMatchObject({
      tinNumber: '987-654-321',
    });
  });

  it('prefills the ID type but never the stored government ID number', async () => {
    renderWithProviders(
      <CustomerCompanyEditDialog customer={RECORD} open onClose={() => {}} onSaved={() => {}} />,
      { user: STAFF, route: '/admin/customers/c-1' },
    );
    const idType = await screen.findByLabelText('ID Type') as HTMLSelectElement;
    expect(idType.value).toBe('passport');
    const idNumber = screen.getByLabelText('Government ID Number') as HTMLInputElement;
    expect(idNumber.value).toBe('');
    expect(idNumber).toHaveAttribute('readonly');
    expect(idNumber).toHaveAttribute('placeholder', 'Current: ****4321');
    expect(screen.getByRole('checkbox', { name: 'Edit Government ID Number' })).not.toBeChecked();
  });

  it('keeps the government ID number unless unlocked and typed, and always sends the ID type', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <CustomerCompanyEditDialog customer={RECORD} open onClose={() => {}} onSaved={() => {}} />,
      { user: STAFF, route: '/admin/customers/c-1' },
    );

    // Locked: saving omits the number but still sends the (unchanged) type.
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(vi.mocked(updateCustomer)).toHaveBeenCalledTimes(1));
    const firstPayload = vi.mocked(updateCustomer).mock.calls[0]![1] as Record<string, unknown>;
    expect(firstPayload).not.toHaveProperty('governmentIdNumber');
    expect(firstPayload).toMatchObject({ governmentIdType: 'passport' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());

    // Unlocked and typed: the new number is sent write-only.
    await user.click(screen.getByRole('checkbox', { name: 'Edit Government ID Number' }));
    const idNumber = screen.getByLabelText('Government ID Number') as HTMLInputElement;
    await user.type(idNumber, 'P7654321');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(vi.mocked(updateCustomer)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(updateCustomer).mock.calls[1]![1]).toMatchObject({
      governmentIdNumber: 'P7654321',
    });
  });

  it('shows Not Recorded in VIP Package and Payment Terms when nothing is stored', () => {
    renderWithProviders(
      <CustomerCompanyEditDialog customer={RECORD} open onClose={() => {}} onSaved={() => {}} />,
      { user: STAFF, route: '/admin/customers/c-1' },
    );
    const vip = screen.getByLabelText('VIP Package') as HTMLSelectElement;
    expect(vip.selectedOptions[0]?.textContent).toBe('Not Recorded');
    const terms = screen.getByLabelText('Payment Terms') as HTMLSelectElement;
    expect(terms.selectedOptions[0]?.textContent).toBe('Not Recorded');
  });

  describe('Government ID image replacement', () => {
    it('hides the image block without the separate id_documents grant', () => {
      renderWithProviders(
        <CustomerCompanyEditDialog customer={RECORD} open onClose={() => {}} onSaved={() => {}} />,
        { user: STAFF, route: '/admin/customers/c-1' },
      );
      expect(screen.queryByLabelText(/Replace Government ID image/)).not.toBeInTheDocument();
    });

    it('shows the current scan and uploads a replacement through the existing document pipeline', async () => {
      vi.mocked(requestUploadGrant).mockResolvedValue({
        documentId: 'd-99',
        uploadUrl: 'https://storage.test/upload/d-99',
      } as never);
      vi.mocked(putUploadBytes).mockResolvedValue(undefined);
      vi.mocked(completeDocumentUpload).mockResolvedValue({
        id: 'd-99',
        hasFile: true,
      } as never);

      renderWithProviders(
        <CustomerCompanyEditDialog
          customer={RECORD}
          open
          onClose={() => {}}
          onSaved={() => {}}
          canViewIdDocuments
        />,
        { user: STAFF, route: '/admin/customers/c-1' },
      );

      const picker = await screen.findByLabelText(/Replace Government ID image/);
      const uploadButton = screen.getByRole('button', { name: 'Upload replacement' });
      expect(uploadButton).toBeDisabled();

      const file = new File(['scan'], 'new-id.png', { type: 'image/png' });
      fireEvent.change(picker, { target: { files: [file] } });
      expect(uploadButton).toBeEnabled();

      const user = userEvent.setup();
      await user.click(uploadButton);

      await waitFor(() => expect(completeDocumentUpload).toHaveBeenCalledWith('d-99'));
      expect(requestUploadGrant).toHaveBeenCalledWith(
        expect.objectContaining({
          subjectType: 'customer',
          subjectId: 'c-1',
          idType: 'passport',
          mime: 'image/png',
          originalFilename: 'new-id.png',
        }),
      );
      expect(putUploadBytes).toHaveBeenCalledWith('https://storage.test/upload/d-99', file);
      await screen.findByText('Government ID image updated.');
      // The replacement never touches the Save payload for the stated record.
      expect(updateCustomer).not.toHaveBeenCalled();
    });

    it('reports an upload failure without clearing the selection', async () => {
      vi.mocked(requestUploadGrant).mockRejectedValue(new Error('Network down'));
      renderWithProviders(
        <CustomerCompanyEditDialog
          customer={RECORD}
          open
          onClose={() => {}}
          onSaved={() => {}}
          canViewIdDocuments
        />,
        { user: STAFF, route: '/admin/customers/c-1' },
      );
      const picker = await screen.findByLabelText(/Replace Government ID image/);
      const file = new File(['scan'], 'new-id.png', { type: 'image/png' });
      fireEvent.change(picker, { target: { files: [file] } });
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Upload replacement' }));
      await screen.findByText('Network down');
      expect(putUploadBytes).not.toHaveBeenCalled();
    });
  });
});
