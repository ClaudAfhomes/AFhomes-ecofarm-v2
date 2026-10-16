import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MembersPage } from './MembersPage';
import { renderWithProviders } from '../../test/utils';

vi.mock('./services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services')>();
  // Network calls are fakes; pure helpers (AA prefix lock, key builders)
  // stay real so the dialog exercises the shipped logic.
  return {
    ...actual,
    getMembers: vi.fn(),
    getMember: vi.fn(),
    getMemberUplines: vi.fn(),
    getMemberOstReferrers: vi.fn(),
    createMember: vi.fn(),
    updateMember: vi.fn(),
    issueMemberAccreditation: vi.fn(),
    getMemberDepartments: vi.fn(),
    networkMemberKeys: {
      scope: ['network', 'members'],
      list: (search: string, position: string) => ['network', 'members', search, position],
      detail: (id: string) => ['network', 'members', 'detail', id],
    },
  };
});

vi.mock('../afhomes/services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../afhomes/services')>();
  return { ...actual, deleteAfHomesStaff: vi.fn() };
});

vi.mock('../address/services', () => ({
  getAddressProvinces: vi.fn().mockResolvedValue([{ code: '0403400000', name: 'Laguna' }]),
  getAddressLocalities: vi.fn().mockImplementation(async (code: string) =>
    code === '0403400000'
      ? [
          {
            code: '0403406000',
            name: 'Calauan',
            type: 'municipality',
            provinceCode: '0403400000',
            postalCode: '4012',
          },
          {
            code: '0403401000',
            name: 'Nozip Town',
            type: 'municipality',
            provinceCode: '0403400000',
          },
        ]
      : [],
  ),
  getAddressBarangays: vi.fn().mockResolvedValue([]),
}));

const {
  getMembers,
  getMember,
  getMemberUplines,
  getMemberOstReferrers,
  createMember,
  getMemberDepartments,
} = await import('./services');

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

/** The single-member read adds the identification fields in clear. */
const DETAIL = { ...ROW, tin: '123456789', governmentIdNumber: 'D7654321' };

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
  fireEvent.change(screen.getByLabelText('Mobile No.'), { target: { value: '09173333333' } });
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

/** Province and city come from the reference lists; the ZIP follows the city. */
const chooseFromList = async (boxName: RegExp, optionName: string | RegExp) => {
  // The combobox commits on pointerdown (a plain click races its blur
  // revert), so this helper drives real pointer events like the address
  // block's own specs do.
  const user = userEvent.setup();
  const box = screen.getByRole('combobox', { name: boxName });
  await waitFor(() => expect(box).toBeEnabled());
  await user.click(box);
  await user.click(await screen.findByRole('option', { name: optionName }));
};

const fillAddress = async () => {
  await chooseFromList(/^Province/, 'Laguna');
  await chooseFromList(/City \/ Municipality/, /^Calauan/);
};

describe('Members page', () => {
  beforeEach(() => {
    vi.mocked(getMember).mockResolvedValue(DETAIL as never);
  });

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
    await fillAddress();
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
          provinceCode: '0403400000',
          cityMunicipalityCode: '0403406000',
          zipCode: '4012',
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

  it('offers hierarchy positions only, never OST', async () => {
    showCreate();
    await screen.findByText('No members');
    await openCreate();
    const options = within(screen.getByLabelText('Position'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(
      expect.arrayContaining(['Sales Vice Director', 'Senior Sales Manager', 'Sales Manager']),
    );
    expect(options).not.toContain('OST');
  });

  it('explains an empty head picker', async () => {
    showCreate();
    await screen.findByText('No members');
    vi.mocked(getMemberUplines).mockResolvedValue([]);
    await openCreate();
    expect(await screen.findByText('No heads found')).toBeInTheDocument();
  });

  it('says why Create stays disabled', async () => {
    showCreate();
    await screen.findByText('No members');
    await openCreate();
    // Nothing filled yet: the first unmet requirement reads as guidance.
    expect(await screen.findByText('Enter the full name.')).toBeInTheDocument();
  });

  it('names the invalid field before the request leaves', async () => {
    showCreate();
    await screen.findByText('No members');
    vi.mocked(createMember).mockReset();
    await openCreate();
    fillRequired();
    await fillAddress();
    // Live filtering strips letters, so a lone digit reaches the contract,
    // which refuses it as too short for a phone number.
    fireEvent.change(screen.getByLabelText('Mobile No.'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Head'), {
      target: { value: '33333333-3333-4333-8333-333333333333' },
    });
    const create = screen.getByRole('button', { name: 'Create' });
    await waitFor(() => expect(create).not.toBeDisabled());
    fireEvent.click(create);
    // The client contract names the field; no request ever fires.
    expect(await screen.findByText(/mobileNo/)).toBeInTheDocument();
    expect(createMember).not.toHaveBeenCalled();
  });

  it('offers Automatic or Manual AA numbers, Manual reveals the input', async () => {
    showCreate();
    await screen.findByText('No members');
    await openCreate();
    expect(screen.getByLabelText('AA Number Source')).toHaveValue('auto');
    expect(screen.queryByLabelText('AA Number')).toBeNull();
    fireEvent.change(screen.getByLabelText('AA Number Source'), { target: { value: 'manual' } });
    expect(await screen.findByLabelText('AA Number')).toBeInTheDocument();
  });

  it('sends a typed MANUAL AA number uppercased', async () => {
    showCreate();
    await screen.findByText('No members');
    vi.mocked(createMember).mockResolvedValue(ROW as never);
    await openCreate();
    fillRequired();
    await fillAddress();
    fireEvent.change(screen.getByLabelText('AA Number Source'), { target: { value: 'manual' } });
    fireEvent.change(await screen.findByLabelText('AA Number'), {
      target: { value: 'aaabc123def4' },
    });
    fireEvent.change(screen.getByLabelText('Head'), {
      target: { value: '33333333-3333-4333-8333-333333333333' },
    });
    const create = screen.getByRole('button', { name: 'Create' });
    await waitFor(() => expect(create).not.toBeDisabled());
    fireEvent.click(create);
    await waitFor(() =>
      expect(createMember).toHaveBeenCalledWith(
        expect.objectContaining({ aaNumberMode: 'manual', aaNumber: 'AAABC123DEF4' }),
      ),
    );
  });

  it('offers to issue a missing AA number from the record', async () => {
    vi.mocked(getMembers).mockResolvedValue([{ ...ROW, aaNumber: null }] as never);
    const { issueMemberAccreditation } = await import('./services');
    vi.mocked(issueMemberAccreditation).mockResolvedValue(ROW as never);
    renderWithProviders(<MembersPage />);
    fireEvent.click(await screen.findByText('SALES MANAGER'));
    expect(await screen.findByLabelText('AA Number Source')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Issue' }));
    await waitFor(() =>
      expect(issueMemberAccreditation).toHaveBeenCalledWith(
        ROW.id,
        expect.objectContaining({ aaNumberMode: 'auto' }),
      ),
    );
  });

  it('blocks invalid keystrokes live and title-cases names', async () => {
    showCreate();
    await screen.findByText('No members');
    await openCreate();
    fireEvent.change(screen.getByLabelText('Full Name'), {
      target: { value: 'juan2 dela-cruz!' },
    });
    expect(screen.getByLabelText('Full Name')).toHaveValue('Juan Dela-cruz');
    fireEvent.change(screen.getByLabelText('No. / Street'), {
      target: { value: '123 mango st' },
    });
    expect(screen.getByLabelText('No. / Street')).toHaveValue('123 Mango St');
    fireEvent.change(screen.getByLabelText('Mobile No.'), {
      target: { value: 'abc0917123456789' },
    });
    expect(screen.getByLabelText('Mobile No.')).toHaveValue('09171234567');
    fireEvent.change(screen.getByLabelText(/Tel No\./), { target: { value: 'abc123' } });
    expect(screen.getByLabelText(/Tel No\./)).toHaveValue('123');
    fireEvent.change(screen.getByLabelText('Government ID Number'), {
      target: { value: 'ab!@#123456789012345678' },
    });
    expect(screen.getByLabelText('Government ID Number')).toHaveValue('ab12345678901234');
    fireEvent.change(screen.getByLabelText(/^TIN/), { target: { value: '12a345678901' } });
    expect(screen.getByLabelText(/^TIN/)).toHaveValue('123456789');
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: '  JOHN@Example.COM ' },
    });
    expect(screen.getByLabelText('Email')).toHaveValue('john@example.com');
  });

  it('fills the ZIP from the chosen city and locks it', async () => {
    showCreate();
    await screen.findByText('No members');
    await openCreate();
    await chooseFromList(/^Province/, 'Laguna');
    await chooseFromList(/City \/ Municipality/, /^Calauan/);
    expect(screen.getByLabelText('ZIP Code')).toHaveValue('4012');
    // A locked ZIP ignores typing: the reference owns it.
    fireEvent.change(screen.getByLabelText('ZIP Code'), { target: { value: '9999' } });
    expect(screen.getByLabelText('ZIP Code')).toHaveValue('4012');
  });

  it('leaves the ZIP hand-typed when the source publishes none', async () => {
    showCreate();
    await screen.findByText('No members');
    await openCreate();
    await chooseFromList(/^Province/, 'Laguna');
    await chooseFromList(/City \/ Municipality/, /^Nozip Town/);
    expect(screen.getByText('No published ZIP. Type one.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('ZIP Code'), { target: { value: '4020' } });
    expect(screen.getByLabelText('ZIP Code')).toHaveValue('4020');
  });

  it('reads legacy uppercase addresses as entered with clean ID labels', async () => {
    vi.mocked(getMembers).mockResolvedValue([
      {
        ...ROW,
        streetNo: '2 MAIN ST',
        cityMunicipality: 'QUEZON CITY',
        province: 'METRO MANILA',
        employerAddress: 'ECOFARM',
        governmentIdType: 'philippine_id',
        fbMessenger: null,
        referrerName: null,
      },
    ] as never);
    renderWithProviders(<MembersPage />);
    fireEvent.click(await screen.findByText('SALES MANAGER'));
    const dialog = within(screen.getByRole('dialog'));
    expect(await dialog.findByText('2 Main St')).toBeInTheDocument();
    expect(dialog.getByText('Quezon City')).toBeInTheDocument();
    expect(dialog.getByText('Metro Manila')).toBeInTheDocument();
    expect(dialog.getByText('Ecofarm')).toBeInTheDocument();
    expect(dialog.getByText('Philippine ID')).toBeInTheDocument();
    expect(dialog.queryByText('philippine_id')).toBeNull();
    expect(dialog.getAllByText('No Data').length).toBeGreaterThanOrEqual(1);
    // The single read replaces the masks with the recorded values.
    expect(await dialog.findByText('D7654321')).toBeInTheDocument();
    expect(dialog.getByText('123456789')).toBeInTheDocument();
    expect(dialog.queryByText('•••4321')).toBeNull();
  });

  it('edits identity, demographics and secrets with blank-kept secrets', async () => {
    vi.mocked(getMembers).mockResolvedValue([ROW] as never);
    const { updateMember } = await import('./services');
    vi.mocked(updateMember).mockResolvedValue(ROW as never);
    renderWithProviders(<MembersPage />);
    fireEvent.click(await screen.findByText('SALES MANAGER'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    // New fields mirror creation, prefilled from the record.
    expect(screen.getByLabelText('Full Name')).toHaveValue('SALES MANAGER');
    expect(screen.getByLabelText('Date of Birth')).toHaveValue('1990-02-02');
    expect(screen.getByLabelText('Sex')).toHaveValue('Female');
    expect(screen.getByLabelText('Civil Status')).toHaveValue('Single');
    expect(screen.getByLabelText('Government ID Type')).toHaveValue('drivers_license');
    // Secrets start blank: typing replaces, leaving keeps.
    expect(screen.getByLabelText(/Government ID Number/)).toHaveValue('');
    expect(screen.getByLabelText(/^TIN/)).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Full Name'), {
      target: { value: 'Renamed Seller' },
    });
    fireEvent.change(screen.getByLabelText(/^TIN/), { target: { value: '999888777' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(updateMember).toHaveBeenCalledWith(
        ROW.id,
        expect.objectContaining({ fullName: 'Renamed Seller', tin: '999888777' }),
      ),
    );
    // An untouched secret is omitted, never nulled.
    const sent = vi.mocked(updateMember).mock.calls[0]?.[1];
    expect(sent).not.toHaveProperty('governmentIdNumber');
  });
});
