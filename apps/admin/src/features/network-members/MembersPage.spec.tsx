import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Swal from 'sweetalert2';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MembersPage } from './MembersPage';
import { renderWithProviders } from '../../test/utils';
import { ApiError } from '../../lib/api/errors';
vi.mock('../../../../../packages/ui/src/components/compress-profile-photo.js', () => ({
  profilePhotoBase64: vi.fn(async () => 'cGhvdG8='),
}));

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
    transferMember: vi.fn(),
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

vi.mock('../ost/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ost/services')>()),
  getAccreditation: vi.fn(),
}));

const {
  getMembers,
  getMember,
  getMemberUplines,
  getMemberOstReferrers,
  createMember,
  getMemberDepartments,
  transferMember,
} = await import('./services');
const { getAccreditation } = await import('../ost/services');

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
  referrerStaffId: '33333333-3333-4333-8333-333333333333',
  ostReferrerStaffId: null,
  aaNumber: 'AA-ABC123',
  dateOfBirth: '1990-02-02',
  sex: 'Female',
  civilStatus: 'Single',
  streetNo: '2 Main St',
  cityMunicipality: 'Quezon City',
  province: 'Metro Manila',
  provinceCode: null,
  cityMunicipalityCode: null,
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
  detailAuthorized: true,
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

/** The Senior Sales Manager every head picker resolves for a Sales Manager. */
const SSM_UPLINE = {
  id: '33333333-3333-4333-8333-333333333333',
  fullName: 'SENIOR MANAGER',
  employeeNumber: null,
  positionLabel: 'Senior Sales Manager',
};

/** A Sales Vice Director: the head a Senior Sales Manager serves under. */
const VD_UPLINE = {
  id: '66666666-6666-4666-8666-666666666666',
  fullName: 'VICE DIRECTOR',
  employeeNumber: 'AF-EMP-00001',
  positionLabel: 'Sales Vice Director',
};

/** An OST member awaiting expiry before the IST conversion. */
const OST_ROW = {
  ...ROW,
  id: '44444444-4444-4444-8444-444444444444',
  employeeNumber: 'AF-EMP-00011',
  fullName: 'OST MEMBER',
  email: 'ost@afhomes.test',
  position: 'ost',
  positionLabel: 'OST',
  referrerName: 'SM ONE',
  aaNumber: 'AAO20010001',
  detailAuthorized: true,
};

function showList() {
  vi.mocked(getMembers).mockResolvedValue([ROW] as never);
  renderWithProviders(<MembersPage />);
}

async function openMemberEdit() {
  const edit = await screen.findByRole('button', { name: 'Edit' });
  await waitFor(() => expect(edit).toBeEnabled());
  fireEvent.click(edit);
}

function showCreate() {
  vi.mocked(getMembers).mockResolvedValue([]);
  vi.mocked(getMemberDepartments).mockResolvedValue([SALES_DEPT] as never);
  vi.mocked(getMemberUplines).mockResolvedValue([SSM_UPLINE] as never);
  vi.mocked(getMemberOstReferrers).mockResolvedValue([] as never);
  vi.mocked(createMember).mockReset();
  renderWithProviders(<MembersPage />);
}

const openCreate = async () => {
  fireEvent.click(screen.getAllByRole('button', { name: 'Create IST' })[0]!);
  await screen.findByLabelText('Full Name');
  await screen.findByRole('option', { name: 'Sales' });
};

const fillRequired = () => {
  fireEvent.change(screen.getByLabelText('Choose profile photo'), { target: { files: [new File(['photo'], 'profile.jpg', { type: 'image/jpeg' })] } });
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
    // The success state names its own range, as the departments console does.
    expect(screen.getByText('Showing 1-1 of 1')).toBeInTheDocument();
  });

  it('shows a loading skeleton shaped like the page before the list arrives', () => {
    vi.mocked(getMembers).mockImplementation(() => new Promise(() => {}) as never);
    renderWithProviders(<MembersPage />);
    expect(screen.getByRole('status', { name: 'Loading members' })).toBeInTheDocument();
    expect(screen.getByText('Loading members…')).toBeInTheDocument();
  });

  it('offers a retry when the list fails to load', async () => {
    vi.mocked(getMembers)
      .mockRejectedValueOnce(new ApiError({ code: 'INTERNAL', message: 'boom', status: 500 }))
      .mockResolvedValueOnce([ROW] as never);
    renderWithProviders(<MembersPage />);
    expect(await screen.findByText('Members could not be loaded')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('SALES MANAGER')).toBeInTheDocument();
  });

  it('shows an updating indicator while a background refetch runs', async () => {
    vi.mocked(getMembers).mockResolvedValueOnce([ROW] as never);
    renderWithProviders(<MembersPage />);
    await screen.findByText('SALES MANAGER');
    // The next request never settles: the rows stay (keepPreviousData) and the
    // page says it is refreshing instead of blanking or lying.
    vi.mocked(getMembers).mockImplementation(() => new Promise(() => {}) as never);
    fireEvent.change(screen.getByLabelText('Search members'), { target: { value: 'zz' } });
    expect(await screen.findByText('Updating…')).toBeInTheDocument();
    expect(screen.getByText('SALES MANAGER')).toBeInTheDocument();
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
    expect(await screen.findByText('Vice Directors have no head.')).toBeInTheDocument();
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
      target: { value: 'aai26090007' },
    });
    fireEvent.change(screen.getByLabelText('Head'), {
      target: { value: '33333333-3333-4333-8333-333333333333' },
    });
    const create = screen.getByRole('button', { name: 'Create' });
    await waitFor(() => expect(create).not.toBeDisabled());
    fireEvent.click(create);
    await waitFor(() =>
      expect(createMember).toHaveBeenCalledWith(
        expect.objectContaining({ aaNumberMode: 'manual', aaNumber: 'AAI26090007' }),
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

  it('prefills the ZIP from the chosen city without locking it', async () => {
    showCreate();
    await screen.findByText('No members');
    await openCreate();
    await chooseFromList(/^Province/, 'Laguna');
    await chooseFromList(/City \/ Municipality/, /^Calauan/);
    expect(screen.getByLabelText('ZIP Code')).toHaveValue('4012');
    // The reference only suggests it: PSGC answers 4018 for Victoria, Laguna,
    // whose ZIP is 4011, so the operator has to be able to correct it.
    fireEvent.change(screen.getByLabelText('ZIP Code'), { target: { value: '4011' } });
    expect(screen.getByLabelText('ZIP Code')).toHaveValue('4011');
  });

  it('leaves the ZIP hand-typed when the source publishes none', async () => {
    showCreate();
    await screen.findByText('No members');
    await openCreate();
    await chooseFromList(/^Province/, 'Laguna');
    await chooseFromList(/City \/ Municipality/, /^Nozip Town/);
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
    await openMemberEdit();
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

  it('renders the same form as Create in Edit, with the issued AA locked', async () => {
    showList();
    vi.mocked(getMemberUplines).mockResolvedValue([SSM_UPLINE] as never);
    await screen.findByText('SALES MANAGER');
    fireEvent.click(screen.getByText('SALES MANAGER'));
    await openMemberEdit();
    // The same sections creation renders, in the same order.
    for (const section of [
      'Assignment',
      'Identity',
      'Home Address',
      'Contact',
      'Work',
      'Government IDs',
      'Account',
      'Head',
      'Referrer Details',
    ])
      expect(screen.getByText(section)).toBeInTheDocument();
    // The same controls, prefilled from the record.
    expect(screen.getByLabelText('Department')).toBeDisabled();
    expect(screen.getByLabelText('Position')).toHaveValue('sales_manager');
    expect(screen.getByLabelText('Email')).toHaveValue('sm@afhomes.test');
    expect(screen.getByLabelText('Temporary password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm password')).toHaveValue('');
    await screen.findByRole('option', { name: /SENIOR MANAGER/ });
    expect(screen.getByLabelText('Head')).toHaveValue(SSM_UPLINE.id);
    expect(screen.getByRole('combobox', { name: /^Province/ })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /City \/ Municipality/ })).toBeInTheDocument();
    // The issued AA reads as issued; it can never be re-numbered.
    expect(screen.getByLabelText('AA Number(Optional)')).toHaveValue('AA-ABC123');
    expect(screen.getByLabelText('AA Number(Optional)')).toHaveAttribute('readonly');
    expect(screen.queryByLabelText('AA Number Source')).toBeNull();
    // An unmoved head needs no reason, and Save is live.
    expect(screen.queryByLabelText('Reason for head change')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('saves a position move with its head reason, the email and a temporary password', async () => {
    vi.mocked(getMembers).mockResolvedValue([ROW] as never);
    vi.mocked(getMemberUplines).mockResolvedValue([VD_UPLINE] as never);
    const { updateMember } = await import('./services');
    vi.mocked(updateMember).mockResolvedValue(ROW as never);
    renderWithProviders(<MembersPage />);
    fireEvent.click(await screen.findByText('SALES MANAGER'));
    await openMemberEdit();
    // Moving the position clears the head; the new level asks for its own.
    fireEvent.change(screen.getByLabelText('Position'), {
      target: { value: 'senior_sales_manager' },
    });
    expect(screen.getByLabelText('Head')).toHaveValue('');
    await screen.findByRole('option', { name: /VICE DIRECTOR/ });
    fireEvent.change(screen.getByLabelText('Head'), { target: { value: VD_UPLINE.id } });
    // The move is explained, and Save refuses until it is.
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    expect(screen.getByText('Explain the head change.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Reason for head change'), {
      target: { value: 'Promoted to Senior Sales Manager' },
    });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'New.SM@Afhomes.test' } });
    fireEvent.change(screen.getByLabelText('Temporary password'), {
      target: { value: 'TempPass456' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'TempPass456' },
    });
    await waitFor(() => expect(save).not.toBeDisabled());
    fireEvent.click(save);
    await waitFor(() =>
      expect(updateMember).toHaveBeenCalledWith(
        ROW.id,
        expect.objectContaining({
          position: 'senior_sales_manager',
          referrerStaffId: VD_UPLINE.id,
          headChangeReason: 'Promoted to Senior Sales Manager',
          ostReferrerStaffId: null,
          email: 'new.sm@afhomes.test',
          temporaryPassword: 'TempPass456',
        }),
      ),
    );
    // Unchanged facts stay home: no address codes, no untouched secrets.
    const sent = vi.mocked(updateMember).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('provinceCode');
    expect(sent).not.toHaveProperty('governmentIdNumber');
  });

  it('issues a missing AA number from the Edit form too', async () => {
    vi.mocked(getMembers).mockResolvedValue([{ ...ROW, aaNumber: null }] as never);
    vi.mocked(getMember).mockResolvedValue({ ...DETAIL, aaNumber: null } as never);
    const { issueMemberAccreditation } = await import('./services');
    vi.mocked(issueMemberAccreditation).mockResolvedValue(ROW as never);
    renderWithProviders(<MembersPage />);
    fireEvent.click(await screen.findByText('SALES MANAGER'));
    await openMemberEdit();
    expect(await screen.findByLabelText('AA Number Source')).toHaveValue('auto');
    fireEvent.click(screen.getByRole('button', { name: 'Issue' }));
    await waitFor(() =>
      expect(issueMemberAccreditation).toHaveBeenCalledWith(
        ROW.id,
        expect.objectContaining({ aaNumberMode: 'auto' }),
      ),
    );
  });

  it('surfaces a failed save as a popup and an inline alert', async () => {
    showList();
    vi.mocked(getMemberUplines).mockResolvedValue([SSM_UPLINE] as never);
    const { updateMember } = await import('./services');
    vi.mocked(updateMember).mockRejectedValue(
      new ApiError({
        code: 'CONFLICT',
        message: 'A staff member with this email already exists',
        status: 409,
      }),
    );
    await screen.findByText('SALES MANAGER');
    fireEvent.click(screen.getByText('SALES MANAGER'));
    await openMemberEdit();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'taken@afhomes.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    // Impossible to miss: a centered modal plus the inline alert. While the
    // modal is up SweetAlert marks the rest of the page inert, so the form's
    // own alert is reachable after dismissing it.
    expect(await screen.findByText('Member not saved')).toBeInTheDocument();
    Swal.close();
    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByText('A staff member with this email already exists'),
    ).toBeInTheDocument();
  });

  it('keeps the dialog open, and Cancel disabled, while a save is in flight', async () => {
    showCreate();
    await screen.findByText('No members');
    let release: (value: unknown) => void = () => {};
    vi.mocked(createMember).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }) as never,
    );
    await openCreate();
    fillRequired();
    await fillAddress();
    fireEvent.change(screen.getByLabelText('Head'), {
      target: { value: '33333333-3333-4333-8333-333333333333' },
    });
    const create = screen.getByRole('button', { name: 'Create' });
    await waitFor(() => expect(create).not.toBeDisabled());
    fireEvent.click(create);
    // In flight: the button owns an accessible busy state and the dialog cannot
    // be dismissed, so a create can never land after the operator "cancelled".
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled());
    expect(create).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByLabelText('Full Name')).toBeInTheDocument();
    release(ROW);
    await waitFor(() => expect(createMember).toHaveBeenCalled());
    Swal.close();
  });

  it('offers a Retry when the head list fails to load', async () => {
    showCreate();
    await screen.findByText('No members');
    vi.mocked(getMemberUplines).mockRejectedValue(
      new ApiError({ code: 'INTERNAL', message: 'boom', status: 500 }),
    );
    await openCreate();
    expect(await screen.findByText('Heads failed to load')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('offers a Retry when the OST referrer list fails to load', async () => {
    showCreate();
    await screen.findByText('No members');
    vi.mocked(getMemberOstReferrers).mockRejectedValue(
      new ApiError({ code: 'INTERNAL', message: 'boom', status: 500 }),
    );
    await openCreate();
    expect(await screen.findByText('OST referrers failed to load')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('does not offer Create when a filter found nothing', async () => {
    vi.mocked(getMembers).mockResolvedValue([] as never);
    renderWithProviders(<MembersPage />);
    await screen.findByText('No members');
    fireEvent.change(screen.getByLabelText('Search members'), { target: { value: 'zzz' } });
    expect(screen.getByText('No members match these filters.')).toBeInTheDocument();
    // The header keeps both actions; the empty state drops its own.
    expect(screen.getAllByRole('button', { name: 'Create IST' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Create OST' })).toHaveLength(1);
  });

  it('surfaces a refused delete as a popup and inline blockers', async () => {
    vi.mocked(getMembers).mockResolvedValue([ROW] as never);
    const { deleteAfHomesStaff } = await import('../afhomes/services');
    vi.mocked(deleteAfHomesStaff).mockRejectedValue(
      new ApiError({
        code: 'PROTECTED_HISTORY',
        message: 'This member cannot be deleted',
        status: 409,
        details: { blockers: ['Has an active sale'] },
      }),
    );
    renderWithProviders(<MembersPage />, {
      user: {
        id: '99999999-9999-4999-8999-999999999999',
        name: 'Super Admin',
        email: 'super@afhomes.test',
        roleId: 'role-super',
        roleSlug: 'super_admin',
        roleName: 'Super Admin',
        afHomesPermissions: [],
        status: 'active',
      },
    });
    fireEvent.click(await screen.findByText('SALES MANAGER'));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), {
      target: { value: 'DELETE' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Member not deleted')).toBeInTheDocument();
    Swal.close();
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Has an active sale')).toBeInTheDocument();
  });

  it('shows a deleting state while the request runs', async () => {
    vi.mocked(getMembers).mockResolvedValue([ROW] as never);
    const { deleteAfHomesStaff } = await import('../afhomes/services');
    vi.mocked(deleteAfHomesStaff).mockImplementation(() => new Promise(() => {}) as never);
    renderWithProviders(<MembersPage />, {
      user: {
        id: '99999999-9999-4999-8999-999999999999',
        name: 'Super Admin',
        email: 'super@afhomes.test',
        roleId: 'role-super',
        roleSlug: 'super_admin',
        roleName: 'Super Admin',
        afHomesPermissions: [],
        status: 'active',
      },
    });
    fireEvent.click(await screen.findByText('SALES MANAGER'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), {
      target: { value: 'DELETE' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    // The irreversible action owns a labeled in-flight state; Cancel locks so
    // the dialog cannot be dismissed mid-request.
    expect(await screen.findByText('Deleting…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('converts an expired OST to IST and refreshes the list', async () => {
    vi.mocked(getMembers).mockResolvedValue([OST_ROW] as never);
    vi.mocked(getAccreditation).mockResolvedValue({
      registration: null,
      currentApplicant: null,
      renewals: [],
      terms: [
        {
          id: '44444444-4444-4444-8444-444444444444',
          starts_on: '2020-01-01',
          expires_on: '2021-01-01',
          displayStatus: 'expired',
          approved_at: '2020-01-01',
        },
      ],
    } as never);
    vi.mocked(getMemberUplines).mockResolvedValue([SSM_UPLINE] as never);
    vi.mocked(transferMember).mockResolvedValue(OST_ROW as never);
    renderWithProviders(<MembersPage />, {
      user: {
        id: '99999999-9999-4999-8999-999999999999',
        name: 'Admin',
        email: 'admin@afhomes.test',
        roleId: 'role-admin',
        roleSlug: 'admin',
        roleName: 'Admin',
        afHomesPermissions: [
          {
            moduleKey: 'network.members',
            canView: true,
            canCreate: false,
            canUpdate: true,
            canDelete: false,
          },
        ],
        status: 'active',
      },
    });
    fireEvent.click(await screen.findByText('OST MEMBER'));
    fireEvent.click(screen.getByRole('button', { name: 'Transfer to IST' }));
    const position = await screen.findByLabelText('Position');
    await waitFor(() => expect(position).toBeEnabled());
    fireEvent.change(position, { target: { value: 'sales_manager' } });
    const head = await screen.findByLabelText('Senior Sales Manager');
    await waitFor(() => expect(head).toBeEnabled());
    fireEvent.change(head, { target: { value: SSM_UPLINE.id } });
    fireEvent.change(screen.getByLabelText(/^Reason for transfer/), {
      target: { value: 'Returns to the selling hierarchy' },
    });
    // Call history accumulates across this file's tests; assert a fresh list read.
    const listsRead = vi.mocked(getMembers).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Transfer to IST' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(transferMember).toHaveBeenCalledOnce();
    await waitFor(() => expect(vi.mocked(getMembers).mock.calls.length).toBeGreaterThan(listsRead));
  });
});
