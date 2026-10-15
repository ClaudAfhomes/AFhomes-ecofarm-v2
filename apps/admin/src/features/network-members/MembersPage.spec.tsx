import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MembersPage } from './MembersPage';
import { renderWithProviders } from '../../test/utils';

vi.mock('./services', () => ({
  getMembers: vi.fn(),
  getMember: vi.fn(),
  getMemberUplines: vi.fn(),
  getMemberOstReferrers: vi.fn(),
  createMember: vi.fn(),
  updateMember: vi.fn(),
  getMemberDepartments: vi.fn(),
  networkMemberKeys: {
    scope: ['network', 'members'],
    list: (search: string, position: string) => ['network', 'members', search, position],
  },
}));

vi.mock('../afhomes/services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../afhomes/services')>();
  return { ...actual, deleteAfHomesStaff: vi.fn() };
});

const { getMembers, getMemberUplines, getMemberOstReferrers, createMember, getMemberDepartments } =
  await import('./services');

const ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  employeeNumber: 'AF-EMP-00010',
  fullName: 'SALES MANAGER',
  email: 'sm@afhomes.test',
  position: 'sales_manager',
  positionLabel: 'Sales Manager',
  departmentName: 'Sales',
  status: 'active',
  referrerName: 'SENIOR MANAGER',
  ostReferrerName: null,
  aaNumber: 'AA-ABC123',
  dateOfBirth: '1990-02-02',
  sex: 'Female',
  civilStatus: 'Single',
  streetNo: '2 Main St',
  cityMunicipality: 'Quezon City',
  province: 'Metro Manila',
  zipCode: '1100',
  telNo: null,
  mobileNo: '+639172222222',
  fbMessenger: null,
  employerName: 'AF Homes',
  employerAddress: 'Ecofarm',
  jobPosition: 'Sales Manager',
  governmentIdType: 'drivers_license',
  tinMasked: '•••-•••-789',
  governmentIdMasked: '•••4321',
  createdAt: '2026-09-01T00:00:00.000Z',
};

const SALES_DEPT = {
  id: '22222222-2222-4222-8222-222222222222',
  code: 'SALES',
  name: 'Sales',
  isActive: true,
  staffCount: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

function showList() {
  vi.mocked(getMembers).mockResolvedValue([ROW] as never);
  renderWithProviders(<MembersPage />);
}

function showCreate() {
  vi.mocked(getMembers).mockResolvedValue([]);
  vi.mocked(getMemberDepartments).mockResolvedValue([SALES_DEPT] as never);
  vi.mocked(getMemberUplines).mockResolvedValue([
    {
      id: '33333333-3333-4333-8333-333333333333',
      fullName: 'SENIOR MANAGER',
      employeeNumber: null,
      positionLabel: 'Senior Sales Manager',
    },
  ] as never);
  vi.mocked(getMemberOstReferrers).mockResolvedValue([] as never);
  vi.mocked(createMember).mockReset();
  renderWithProviders(<MembersPage />);
}

const openCreate = async () => {
  fireEvent.click(screen.getAllByRole('button', { name: 'Create Member' })[0]!);
  await screen.findByLabelText('Full Name');
  await screen.findByRole('option', { name: 'Sales' });
};

const fillRequired = () => {
  fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'New Member' } });
  fireEvent.change(screen.getByLabelText('Date of Birth'), { target: { value: '1992-05-06' } });
  fireEvent.change(screen.getByLabelText('Sex'), { target: { value: 'Male' } });
  fireEvent.change(screen.getByLabelText('Civil Status'), { target: { value: 'Single' } });
  fireEvent.change(screen.getByLabelText('No. / Street'), { target: { value: '123 Mango St' } });
  fireEvent.change(screen.getByLabelText('City / Municipality'), { target: { value: 'Makati' } });
  fireEvent.change(screen.getByLabelText('Province'), { target: { value: 'Metro Manila' } });
  fireEvent.change(screen.getByLabelText('ZIP Code'), { target: { value: '1200' } });
  fireEvent.change(screen.getByLabelText('Mobile No.'), { target: { value: '+639173333333' } });
  fireEvent.change(screen.getByLabelText('Business / Employer Name'), {
    target: { value: 'AF Homes' },
  });
  fireEvent.change(screen.getByLabelText('Business / Employer Address'), {
    target: { value: 'Ecofarm' },
  });
  fireEvent.change(screen.getByLabelText('Job Position'), { target: { value: 'Seller' } });
  fireEvent.change(screen.getByLabelText('Government ID Type'), {
    target: { value: 'passport' },
  });
  fireEvent.change(screen.getByLabelText('Government ID Number'), {
    target: { value: 'P9998888' },
  });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@afhomes.test' } });
  fireEvent.change(screen.getByLabelText('Temporary password'), {
    target: { value: 'TempPass123' },
  });
  fireEvent.change(screen.getByLabelText('Confirm password'), {
    target: { value: 'TempPass123' },
  });
};

describe('Members page', () => {
  it('lists Code, Name, Position, AA Number, Status and Added', async () => {
    showList();
    const table = await screen.findByRole('table');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual(['Code', 'Name', 'Position', 'AA Number', 'Status', 'Added']);
    expect(await screen.findByText('SALES MANAGER')).toBeInTheDocument();
    expect(screen.getByText('AF-EMP-00010')).toBeInTheDocument();
    expect(screen.getByText('AA-ABC123')).toBeInTheDocument();
    expect(screen.queryByText('SENIOR MANAGER')).toBeNull();
  });

  it('opens the full record on row click with Edit and Delete', async () => {
    showList();
    await screen.findByText('SALES MANAGER');
    fireEvent.click(screen.getByText('SALES MANAGER'));
    const dialog = within(screen.getByRole('dialog'));
    expect(await dialog.findByText('SALES MANAGER')).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('fixes the department in Sales and requires the head', async () => {
    showCreate();
    await screen.findByText('No members');
    vi.mocked(createMember).mockResolvedValue(ROW as never);
    await openCreate();
    expect(screen.getByLabelText('Department')).toBeDisabled();
    expect(screen.getByLabelText('Department')).toHaveValue(SALES_DEPT.id);
    fillRequired();
    // Head is required: the save stays disabled until one is picked.
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Head'), {
      target: { value: '33333333-3333-4333-8333-333333333333' },
    });
    const create = screen.getByRole('button', { name: 'Create' });
    await waitFor(() => expect(create).not.toBeDisabled());
    fireEvent.click(create);
    await waitFor(() =>
      expect(createMember).toHaveBeenCalledWith(
        expect.objectContaining({
          position: 'sales_manager',
          departmentId: SALES_DEPT.id,
          referrerStaffId: '33333333-3333-4333-8333-333333333333',
        }),
      ),
    );
  });

  it('shows Referrer Details only for Sales Managers', async () => {
    showCreate();
    await screen.findByText('No members');
    await openCreate();
    expect(await screen.findByLabelText('OST Referrer')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Position'), { target: { value: 'ost' } });
    await waitFor(() => expect(screen.queryByLabelText('OST Referrer')).toBeNull());
    fireEvent.change(screen.getByLabelText('Position'), { target: { value: 'vice_director' } });
    expect(await screen.findByText('A Vice Director has no head.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Head')).toBeNull();
  });
});
