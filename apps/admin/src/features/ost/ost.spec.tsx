import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('../../../../../packages/ui/src/components/compress-profile-photo.js', () => ({
  profilePhotoBase64: vi.fn(async () => 'cGhvdG8='),
}));
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OstApplication, OstMember, OstReferralCodeRecord } from '@afhomes/contracts';
import { Route, Routes } from 'react-router';

import { renderWithProviders } from '../../test/utils';
import type { SessionUser } from '../../lib/session';
import { OstApplicationDetailPage } from './OstApplicationDetailPage';
import { OstApplicationsPage } from './OstApplicationsPage';
import { OstReferralCodesPage } from './OstReferralCodesPage';
import { OstAccreditationHistoryPage } from './OstAccreditationPages';
import {
  approveOstApplication,
  createReferralCode,
  getMyReferralCodes,
  getOstApplication,
  getOstApplications,
  getOstMembers,
  getOstSponsors,
  rejectOstApplication,
  requestOstApplicationChanges,
  getAccreditation,
  submitRenewal,
  updateOstApplicant,
} from './services';

vi.mock('./services', () => ({
  submitRenewal: vi.fn(),
  reviseRenewal: vi.fn(),
  decideRenewal: vi.fn(),
  registerOfficialOst: vi.fn(),
  parseOstImport: vi.fn(),
  confirmOstImport: vi.fn(),
  downloadOstFile: vi.fn(),
  getOstSponsors: vi.fn().mockResolvedValue([]),
  getAccreditation: vi
    .fn()
    .mockResolvedValue({ registration: null, currentApplicant: null, terms: [], renewals: [] }),
  getOstApplications: vi.fn(),
  getOstApplication: vi.fn(),
  approveOstApplication: vi.fn(),
  rejectOstApplication: vi.fn(),
  requestOstApplicationChanges: vi.fn(),
  getOstMembers: vi.fn(),
  getMyReferralCodes: vi.fn(),
  createReferralCode: vi.fn(),
  updateOstApplicant: vi.fn(),
}));

vi.mock('../documents/services', () => ({
  ACCEPTED_MIME: ['image/jpeg'],
  MAX_BYTES: 1,
  getDocuments: vi.fn().mockResolvedValue([]),
  putUploadBytes: vi.fn(),
  requestUploadGrant: vi.fn(),
}));

const mockedGetOstApplications = vi.mocked(getOstApplications);
const mockedGetOstApplication = vi.mocked(getOstApplication);
const mockedApprove = vi.mocked(approveOstApplication);
const mockedReject = vi.mocked(rejectOstApplication);
const mockedRequestChanges = vi.mocked(requestOstApplicationChanges);
const mockedGetOstMembers = vi.mocked(getOstMembers);
const mockedGetCodes = vi.mocked(getMyReferralCodes);
const mockedCreateCode = vi.mocked(createReferralCode);
const mockedUpdateApplicant = vi.mocked(updateOstApplicant);

const STAFF: SessionUser = {
  id: 'staff-id',
  name: 'Sam Manager',
  email: 'sm@example.com',
  roleId: 'role-id',
  roleName: 'Sales Manager',
  status: 'active',
  afHomesPermissions: [
    {
      moduleKey: 'network.ost_registrations',
      canView: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    },
    {
      moduleKey: 'network.ost_members',
      canView: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    },
    {
      moduleKey: 'network.referrals',
      canView: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    },
  ],
};

const APP_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

it('derives the annual renewal end from the management-selected start', async () => {
  vi.mocked(getAccreditation).mockResolvedValueOnce({
    registration: null,
    currentApplicant: null,
    renewals: [],
    terms: [
      {
        id: APP_ID,
        starts_on: '2025-01-01',
        expires_on: '2026-01-01',
        displayStatus: 'expired',
        approved_at: '2025-01-01',
      },
    ],
  });
  mockedGetOstMembers.mockResolvedValueOnce([MEMBER]);
  renderWithProviders(
    <Routes>
      <Route path="/members/:id" element={<OstAccreditationHistoryPage />} />
    </Routes>,
    { user: STAFF, route: `/members/${MEMBER.id}` },
  );
  await screen.findByRole('button', { name: 'Submit renewal' });
  fireEvent.change(screen.getByLabelText('Date of renewal'), { target: { value: '2026-01-01' } });
  fireEvent.change(screen.getByLabelText('Requested start'), { target: { value: '2026-02-01' } });
  const end = screen.getByLabelText('Requested end') as HTMLInputElement;
  expect(end.value).toBe('2027-02-01');
  expect(end.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Submit renewal' }));
  await waitFor(() => expect(vi.mocked(submitRenewal)).toHaveBeenCalled());
  expect(vi.mocked(submitRenewal).mock.calls[0]?.[1]).toMatchObject({
    requestedStart: '2026-02-01',
    requestedEnd: '2027-02-01',
  });
});

it('sends the OST details page back to the network members list', async () => {
  mockedGetOstMembers.mockResolvedValueOnce([MEMBER]);
  renderWithProviders(
    <Routes>
      <Route path="/members/:id" element={<OstAccreditationHistoryPage />} />
      <Route path="/admin/network/members" element={<p>Members hub</p>} />
    </Routes>,
    { user: STAFF, route: `/members/${MEMBER.id}` },
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Back to members' }));
  expect(await screen.findByText('Members hub')).toBeInTheDocument();
});

const APP: OstApplication = {
  id: APP_ID,
  applicantName: 'Oscar Trainee',
  email: 'oscar@example.invalid',
  phone: '+639171234567',
  birthDate: '1995-06-15',
  address: null,
  sponsorStaffId: '22222222-2222-4222-8222-222222222222',
  sponsorName: 'Sam Manager',
  referralCodeHint: 'OST-…-3456',
  status: 'submitted',
  reviewNotes: null,
  reviewedBy: null,
  submittedAt: '2026-09-28T00:00:00.000Z',
  reviewedAt: null,
};

const MEMBER: OstMember = {
  id: '66666666-6666-4666-8666-666666666666',
  applicationId: APP_ID,
  sponsorStaffId: '22222222-2222-4222-8222-222222222222',
  sponsorName: 'Sam Manager',
  ostNumber: 'OST-000001',
  aaNumber: 'AAO26100002',
  fullName: 'Oscar Trainee',
  email: 'oscar@example.invalid',
  phone: '+639171234567',
  status: 'active',
  approvedBy: '11111111-1111-4111-8111-111111111111',
  approvedAt: '2026-09-28T01:00:00.000Z',
  createdAt: '2026-09-28T01:00:00.000Z',
};

const CODE: OstReferralCodeRecord = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  codeHint: 'OST-…-3456',
  useCount: 2,
  maxUses: 10,
  expiresAt: '2099-10-28T00:00:00.000Z',
  isActive: true,
  createdAt: '2026-09-28T00:00:00.000Z',
};

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('SM referral codes', () => {
  it.each(['expired', 'revoked', 'exhausted'])(
    'shows %s credentials as unusable and offers ordinary issuance',
    async (state) => {
      mockedGetCodes.mockResolvedValue([
        {
          ...CODE,
          isActive: state !== 'revoked',
          expiresAt: state === 'expired' ? '2020-01-01T00:00:00Z' : '2099-01-01T00:00:00Z',
          useCount: state === 'exhausted' ? CODE.maxUses : 0,
        },
      ]);
      renderWithProviders(<OstReferralCodesPage />, { user: STAFF });
      await screen.findByText(state);
      expect(screen.getByRole('button', { name: 'Issue new code' })).toBeEnabled();
    },
  );
  it('refreshes code state after an issuance error instead of repeating the mutation', async () => {
    mockedCreateCode.mockRejectedValueOnce(new Error('An active referral code already exists.'));
    mockedGetCodes.mockResolvedValue([]);
    renderWithProviders(<OstReferralCodesPage />, { user: STAFF });
    await screen.findByText('No referral codes');
    fireEvent.click(screen.getByRole('button', { name: 'Issue new code' }));
    await screen.findByRole('alert');
    mockedGetCodes.mockResolvedValue([CODE]);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await screen.findByText(CODE.codeHint);
    expect(mockedCreateCode).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Rotate and revoke previous codes' })).toBeEnabled();
  });
  it('allows dismissing the plaintext and does not recover it on remount', async () => {
    mockedCreateCode.mockResolvedValue({
      code: 'OST-ABCDEF-123456',
      codeHint: 'OST-?-3456',
      expiresAt: CODE.expiresAt,
      maxUses: 10,
    });
    const view = renderWithProviders(<OstReferralCodesPage />, { user: STAFF });
    await screen.findByText(CODE.codeHint);
    fireEvent.click(screen.getByRole('button', { name: 'Rotate and revoke previous codes' }));
    await screen.findByText('New code issued (shown once)');
    expect(screen.getByText('Save this code now. It cannot be viewed again.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss code' }));
    expect(screen.queryByText('OST-ABCDEF-123456')).not.toBeInTheDocument();
    view.unmount();
    renderWithProviders(<OstReferralCodesPage />, { user: STAFF });
    await screen.findByText(CODE.codeHint);
    expect(screen.queryByText('OST-ABCDEF-123456')).not.toBeInTheDocument();
    expect(mockedCreateCode).toHaveBeenCalledTimes(1);
  });
  it('Admin queries and issues against the selected Sales Manager', async () => {
    const sponsor = '22222222-2222-4222-8222-222222222222';
    vi.mocked(getOstSponsors).mockResolvedValue([{ id: sponsor, name: 'Juan QA Manager' }]);
    mockedGetCodes.mockResolvedValue([]);
    mockedCreateCode.mockResolvedValue({
      code: 'OST-QA-ONCE',
      codeHint: 'QA hint',
      expiresAt: '2027-10-01T00:00:00Z',
      maxUses: 10,
    });
    renderWithProviders(<OstReferralCodesPage />, { user: { ...STAFF, roleSlug: 'super_admin' } });
    expect(screen.getByRole('button', { name: 'Issue new code' })).toBeDisabled();
    await screen.findByText('Juan QA Manager');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: sponsor } });
    await waitFor(() => expect(mockedGetCodes).toHaveBeenCalledWith(sponsor));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Issue new code' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Issue new code' }));
    await screen.findByText('OST-QA-ONCE');
    expect(mockedCreateCode).toHaveBeenCalledWith({
      maxUses: 10,
      expiresInHours: 168,
      sponsorStaffId: sponsor,
      rotate: false,
    });
  });
  beforeEach(() => {
    mockedGetCodes.mockResolvedValue([CODE]);
    mockedGetOstApplications.mockResolvedValue([]);
  });

  it('renders code hints, usage, statuses and applications under me', async () => {
    mockedGetOstApplications.mockResolvedValue([{ ...APP, status: 'approved' }]);
    renderWithProviders(<OstReferralCodesPage />, { user: STAFF });
    expect(await screen.findByText('OST-…-3456')).toBeInTheDocument();
    expect(screen.getByText('2/10')).toBeInTheDocument();
    expect(await screen.findByText('Applications under me')).toBeInTheDocument();
    expect(screen.getByText('Oscar Trainee')).toBeInTheDocument();
    expect(screen.getByText('approved')).toBeInTheDocument();
  });

  it('issues a code once with its QR and link, never refetching it', async () => {
    mockedCreateCode.mockResolvedValue({
      code: 'OST-ABCDEF-123456',
      codeHint: 'OST-…-3456',
      expiresAt: '2026-10-28T00:00:00.000Z',
      maxUses: 10,
    });
    renderWithProviders(<OstReferralCodesPage />, { user: STAFF });
    await screen.findByText('OST-…-3456');
    fireEvent.click(screen.getByRole('button', { name: 'Rotate and revoke previous codes' }));
    expect(await screen.findByText('New code issued (shown once)')).toBeInTheDocument();
    expect(screen.getByText('OST-ABCDEF-123456')).toBeInTheDocument();
    expect(
      screen.getByText('/ost/register?code=OST-ABCDEF-123456', { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByAltText('OST registration QR for OST-ABCDEF-123456')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy code and link' })).toBeInTheDocument();
    expect(mockedCreateCode).toHaveBeenCalledWith({
      maxUses: 10,
      expiresInHours: 168,
      rotate: true,
    });
  });

  it('shows empty states for codes and applications', async () => {
    mockedGetCodes.mockResolvedValue([]);
    mockedGetOstApplications.mockResolvedValue([]);
    renderWithProviders(<OstReferralCodesPage />, { user: STAFF });
    expect(await screen.findByText('No referral codes')).toBeInTheDocument();
    expect(screen.getByText('No applications yet')).toBeInTheDocument();
  });

  it('shows loading and error states', async () => {
    mockedGetCodes.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<OstReferralCodesPage />, { user: STAFF });
    expect(await screen.findByText('Loading codes…')).toBeInTheDocument();
  });
});

describe('OST applications queue', () => {
  it('renders rows with sponsor and status filter', async () => {
    mockedGetOstApplications.mockResolvedValue([APP]);
    renderWithProviders(<OstApplicationsPage />, { user: STAFF });
    expect(await screen.findByText('Oscar Trainee')).toBeInTheDocument();
    expect(screen.getByText('Sam Manager')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute(
      'href',
      `/admin/ost/applications/${APP_ID}`,
    );
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    mockedGetOstApplications.mockResolvedValue([]);
    renderWithProviders(<OstApplicationsPage />, { user: STAFF });
    expect(await screen.findByText('No OST applications')).toBeInTheDocument();
  });
});

describe('OST application review', () => {
  function renderDetail() {
    return renderWithProviders(
      <Routes>
        <Route path="/admin/ost/applications/:id" element={<OstApplicationDetailPage />} />
      </Routes>,
      { route: `/admin/ost/applications/${APP_ID}`, user: STAFF },
    );
  }

  beforeEach(() => {
    mockedGetOstApplication.mockResolvedValue(APP);
  });

  it('shows the frozen sponsor with no way to change it', async () => {
    renderDetail();
    expect(await screen.findByText('Sam Manager')).toBeInTheDocument();
    expect(screen.getByText('OST-…-3456')).toBeInTheDocument();
    expect(screen.queryByLabelText(/sponsor/i)).toBeNull();
  });

  it('approves and reports the new member number', async () => {
    mockedApprove.mockResolvedValue(MEMBER);
    renderDetail();
    await screen.findByText('Oscar Trainee');
    expect(screen.getByRole('button', { name: 'Approve as OST' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Temporary password'), {
      target: { value: 'TempPass123' },
    });
    fireEvent.change(screen.getByLabelText('Confirm temporary password'), {
      target: { value: 'TempPass123' },
    });
    expect(screen.getByRole('button', { name: 'Approve as OST' })).toBeDisabled();
    await userEvent.upload(screen.getByLabelText('Choose profile photo'), new File(['photo'], 'profile.jpg', { type: 'image/jpeg' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve as OST' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/Approved\. OST member OST-000001/)).toBeInTheDocument();
    expect(mockedApprove).toHaveBeenCalledWith(APP_ID, 'TempPass123', 'cGhvdG8=');
  });

  it('requires a reason before rejecting', async () => {
    mockedReject.mockResolvedValue({ ...APP, status: 'rejected' });
    renderDetail();
    await screen.findByText('Oscar Trainee');
    expect(screen.getByRole('button', { name: 'Reject application' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Review notes/), { target: { value: 'Not eligible.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject application' }));
    expect(await screen.findByText('Rejected.')).toBeInTheDocument();
    expect(mockedReject).toHaveBeenCalledWith(APP_ID, 'Not eligible.');
  });

  it('requests changes with mandatory review notes', async () => {
    mockedRequestChanges.mockResolvedValue({ ...APP, status: 'changes_requested' });
    renderDetail();
    await screen.findByText('Oscar Trainee');
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Review notes/), {
      target: { value: 'Please provide a clearer identity scan.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    expect(await screen.findByText('Changes requested.')).toBeInTheDocument();
    expect(mockedRequestChanges).toHaveBeenCalledWith(
      APP_ID,
      'Please provide a clearer identity scan.',
    );
  });

  it('says a terminal application can no longer be reviewed', async () => {
    mockedGetOstApplication.mockResolvedValue({ ...APP, status: 'approved' });
    renderDetail();
    expect(await screen.findByText(/can no longer be reviewed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve as OST' })).toBeNull();
  });
});

describe('live OST search', () => {
  it('debounces applications, preserves status, and clears to defaults', async () => {
    mockedGetOstApplications.mockResolvedValue([APP]);
    renderWithProviders(<OstApplicationsPage />, { user: STAFF });
    await screen.findByText(APP.applicantName);
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'submitted' } });
    await waitFor(() => expect(mockedGetOstApplications).toHaveBeenLastCalledWith('submitted'));
    const input = screen.getByLabelText('Search OST applications');
    const count = mockedGetOstApplications.mock.calls.length;
    fireEvent.change(input, { target: { value: 'o' } });
    fireEvent.change(input, { target: { value: 'os' } });
    fireEvent.change(input, { target: { value: 'oscar' } });
    expect(mockedGetOstApplications.mock.calls.length).toBe(count);
    await waitFor(() =>
      expect(mockedGetOstApplications).toHaveBeenLastCalledWith('submitted', 'oscar'),
    );
    expect(mockedGetOstApplications.mock.calls.length).toBe(count + 1);
    fireEvent.change(input, { target: { value: '' } });
    await waitFor(() => expect(mockedGetOstApplications).toHaveBeenLastCalledWith('submitted'));
  });
  it('isolates a late previous application response from the current query', async () => {
    let finish: (rows: OstApplication[]) => void = () => {};
    mockedGetOstApplications.mockImplementation((_status, search) =>
      search === 'old'
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(search === 'new' ? [] : [APP]),
    );
    renderWithProviders(<OstApplicationsPage />, { user: STAFF });
    await screen.findByText(APP.applicantName);
    const input = screen.getByLabelText('Search OST applications');
    fireEvent.change(input, { target: { value: 'old' } });
    await waitFor(() => expect(mockedGetOstApplications).toHaveBeenLastCalledWith('', 'old'));
    fireEvent.change(input, { target: { value: 'new' } });
    await screen.findByText('No matching records.');
    finish([APP]);
    await waitFor(() => expect(screen.queryByText(APP.applicantName)).not.toBeInTheDocument());
    expect(screen.getByText('No matching records.')).toBeInTheDocument();
  });
});

const CURRENT_APPLICANT = {
  fullName: 'Oscar Trainee',
  birthDate: '1995-06-15',
  email: 'oscar@example.invalid',
  phone: '+639171234567',
  sex: 'male',
  civilStatus: 'single',
  address: {
    line1: 'SYNTHETIC',
    barangay: 'QA VILLAGE',
    city: 'QA CITY',
    province: 'QA',
    postalCode: '1000',
    countryCode: 'PH',
  },
  messenger: null,
  employerName: null,
  jobPosition: null,
  tinMasked: null,
  programCategory: 'non_vip' as const,
  vipCardType: null,
};

const ADMIN: SessionUser = {
  ...STAFF,
  roleSlug: 'super_admin',
  afHomesPermissions: [
    ...(STAFF.afHomesPermissions ?? []),
    {
      moduleKey: 'network.members',
      canView: true,
      canCreate: false,
      canUpdate: true,
      canDelete: false,
    },
  ],
};

describe('OST applicant information', () => {
  function renderPage(user: SessionUser) {
    vi.mocked(getAccreditation).mockResolvedValue({
      registration: null,
      currentApplicant: CURRENT_APPLICANT,
      terms: [],
      renewals: [],
    });
    mockedGetOstMembers.mockResolvedValue([MEMBER]);
    return renderWithProviders(
      <Routes>
        <Route path="/members/:id" element={<OstAccreditationHistoryPage />} />
      </Routes>,
      { user, route: `/members/${MEMBER.id}` },
    );
  }

  it('shows the registered applicant read-only without update permission', async () => {
    renderPage(STAFF);
    expect(await screen.findByText('Registered applicant')).toBeInTheDocument();
    expect(screen.getByText('+639171234567')).toBeInTheDocument();
    expect(screen.getByText('Non-VIP')).toBeInTheDocument();
    expect(screen.getByText('oscar@example.invalid', { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update information' })).toBeNull();
    expect(screen.getByText(/Member-profile update permission required/)).toBeInTheDocument();
  });

  it('records a controlled mobile-number change and refreshes the panel', async () => {
    renderPage(ADMIN);
    fireEvent.click(await screen.findByRole('button', { name: 'Update information' }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '09987654321' } });
    expect(
      await screen.findByText('Mobile number: +639171234567 → +639987654321'),
    ).toBeInTheDocument();
    mockedUpdateApplicant.mockResolvedValue({ id: MEMBER.id });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockedUpdateApplicant).toHaveBeenCalledTimes(1));
    expect(mockedUpdateApplicant.mock.calls[0]?.[0]).toBe(MEMBER.id);
    expect(mockedUpdateApplicant.mock.calls[0]?.[1]).toMatchObject({
      fullName: 'Oscar Trainee',
      phone: '+639987654321',
      sex: 'male',
      civilStatus: 'single',
      reason: '',
      requestId: expect.any(String),
    });
    expect(await screen.findByText(/Recorded in the audit trail/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('requires a reason before an identity change is submitted', async () => {
    renderPage(ADMIN);
    fireEvent.click(await screen.findByRole('button', { name: 'Update information' }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Full name'), {
      target: { value: 'Oscar Trainee-Reyes' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/Reason needs five characters/)).toBeInTheDocument();
    expect(mockedUpdateApplicant).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Change reason/), {
      target: { value: 'Marriage certificate on file.' },
    });
    mockedUpdateApplicant.mockResolvedValue({ id: MEMBER.id });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockedUpdateApplicant).toHaveBeenCalledTimes(1));
    expect(mockedUpdateApplicant.mock.calls[0]?.[1]).toMatchObject({
      fullName: 'Oscar Trainee-Reyes',
      reason: 'Marriage certificate on file.',
    });
  });
});
