import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OstApplication, OstMember, OstReferralCodeRecord } from '@afhomes/contracts';
import { Route, Routes } from 'react-router';

import { renderWithProviders } from '../../test/utils';
import type { SessionUser } from '../../lib/session';
import { OstApplicationDetailPage } from './OstApplicationDetailPage';
import { OstApplicationsPage } from './OstApplicationsPage';
import { OstMembersPage } from './OstMembersPage';
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
  getAccreditation: vi.fn().mockResolvedValue({ registration: null, terms: [], renewals: [] }),
  getOstApplications: vi.fn(),
  getOstApplication: vi.fn(),
  approveOstApplication: vi.fn(),
  rejectOstApplication: vi.fn(),
  requestOstApplicationChanges: vi.fn(),
  getOstMembers: vi.fn(),
  getMyReferralCodes: vi.fn(),
  createReferralCode: vi.fn(),
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

it('shows a readable renewal date error without sending a mutation', async () => {
  vi.mocked(getAccreditation).mockResolvedValueOnce({
    registration: null,
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
  fireEvent.change(screen.getByLabelText('date Of Renewal'), { target: { value: '2026-01-01' } });
  fireEvent.change(screen.getByLabelText('requested Start'), { target: { value: '2026-02-01' } });
  fireEvent.change(screen.getByLabelText('requested End'), { target: { value: '2026-01-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit renewal' }));
  expect((await screen.findByRole('alert')).textContent).toBe(
    'Expiry must be on or after the start',
  );
  expect(submitRenewal).not.toHaveBeenCalled();
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
  expiresAt: '2026-10-28T00:00:00.000Z',
  isActive: true,
  createdAt: '2026-09-28T00:00:00.000Z',
};

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('SM referral codes', () => {
  it('Admin queries and issues against the selected Sales Manager',async()=>{
    const sponsor='22222222-2222-4222-8222-222222222222';
    vi.mocked(getOstSponsors).mockResolvedValue([{id:sponsor,name:'Juan QA Manager'}]);
    mockedGetCodes.mockResolvedValue([]);
    mockedCreateCode.mockResolvedValue({code:'OST-QA-ONCE',codeHint:'QA hint',expiresAt:'2027-10-01T00:00:00Z',maxUses:10});
    renderWithProviders(<OstReferralCodesPage />,{user:{...STAFF,roleSlug:'super_admin'}});
    expect(screen.getByRole('button',{name:'Issue new code'})).toBeDisabled();
    await screen.findByText('Juan QA Manager');
    fireEvent.change(screen.getByRole('combobox'),{target:{value:sponsor}});
    await waitFor(()=>expect(mockedGetCodes).toHaveBeenCalledWith(sponsor));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Issue new code'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button',{name:'Issue new code'}));
    await screen.findByText('OST-QA-ONCE');
    expect(mockedCreateCode).toHaveBeenCalledWith({maxUses:10,expiresInHours:168,sponsorStaffId:sponsor,rotate:false});
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
    expect(mockedCreateCode).toHaveBeenCalledWith({ maxUses: 10, expiresInHours: 168, rotate: true });
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
    fireEvent.click(screen.getByRole('button', { name: 'Approve as OST' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/Approved\. OST member OST-000001/)).toBeInTheDocument();
    expect(mockedApprove).toHaveBeenCalledWith(APP_ID);
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

describe('OST members', () => {
  it('renders members with numbers, sponsors and genealogy links', async () => {
    mockedGetOstMembers.mockResolvedValue([MEMBER]);
    renderWithProviders(<OstMembersPage />, { user: STAFF });
    expect(await screen.findByText('OST-000001')).toBeInTheDocument();
    expect(screen.getByText('Oscar Trainee')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Genealogy' })).toHaveAttribute(
      'href',
      `/admin/genealogy/${MEMBER.id}`,
    );
  });

  it('shows an empty state', async () => {
    mockedGetOstMembers.mockResolvedValue([]);
    renderWithProviders(<OstMembersPage />, { user: STAFF });
    expect(await screen.findByText('No OST members')).toBeInTheDocument();
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
  it('searches members live and restores defaults when cleared', async () => {
    mockedGetOstMembers.mockImplementation((search) => Promise.resolve(search ? [] : [MEMBER]));
    renderWithProviders(<OstMembersPage />, { user: STAFF });
    await screen.findByText(MEMBER.fullName);
    const input = screen.getByLabelText('Search OST members');
    fireEvent.change(input, { target: { value: 'missing' } });
    await screen.findByText('No matching records.');
    expect(mockedGetOstMembers).toHaveBeenLastCalledWith('missing');
    fireEvent.change(input, { target: { value: '' } });
    await screen.findByText(MEMBER.fullName);
  });
});
