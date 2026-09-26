import { screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MOCK_STAFF_ADMIN, MOCK_SUPER_ADMIN } from '@jad/mock';

import type { SessionUser } from '../../../lib/session';
import { renderWithProviders } from '../../../test/utils';
import { MemberDetailPage } from './MemberDetailPage';

const { mockUseMember, mockUseMemberRegistration, mockGetGovernmentIdUrl } = vi.hoisted(() => ({
  mockUseMember: vi.fn(),
  mockUseMemberRegistration: vi.fn(),
  mockGetGovernmentIdUrl: vi.fn(),
}));

const { mockArchiveMember, mockDeleteMemberPermanently } = vi.hoisted(() => ({
  mockArchiveMember: vi.fn(),
  mockDeleteMemberPermanently: vi.fn(),
}));

vi.mock('../hooks/useMember', () => ({
  useMember: (...args: unknown[]) => mockUseMember(...args),
}));

vi.mock('../hooks/useMemberRegistration', () => ({
  useMemberRegistration: (...args: unknown[]) => mockUseMemberRegistration(...args),
}));

vi.mock('../../registrations/repositories/registrationRepository', () => ({
  getGovernmentIdUrl: (...args: unknown[]) => mockGetGovernmentIdUrl(...args),
}));

vi.mock('../repositories/memberRepository', () => ({
  updateMember: vi.fn(),
  deactivateMember: vi.fn(),
  activateMember: vi.fn(),
  archiveMember: (...args: unknown[]) => mockArchiveMember(...args),
  deleteMemberPermanently: (...args: unknown[]) => mockDeleteMemberPermanently(...args),
  setMemberQualified: vi.fn(),
}));

const MEMBER = {
  id: 'mem-uuid-1',
  firstName: 'Juan',
  lastName: 'Dela Cruz',
  email: 'juan@example.com',
  phone: '+639171234567',
  gender: 'Male',
  address: 'Manila',
  countryCode: 'PH',
  countryName: 'Philippines',
  program: { id: 'prg-domestic', code: 'DOMESTIC', name: 'Domestic Program' },
  referralCode: 'JD-2026-001',
  status: 'APPROVED_ACTIVE',
  isQualified: true,
  accountStatus: 'ACTIVE',
  registeredAt: '2026-08-01T00:00:00.000Z',
  registrationId: 'reg-001',
};

const APPLICATION = {
  id: 'reg-001',
  status: 'APPROVED_ACTIVE',
  programId: 'prg-domestic',
  programCode: 'DOMESTIC',
  referralCode: 'JD-2026-001',
  submittedAt: '2026-08-01T00:00:00.000Z',
  reviewedAt: '2026-08-02T00:00:00.000Z',
  reviewedBy: 'staff-uuid-1',
  qualificationAnswers: [{ questionId: 'q-001', answer: 'Yes' }],
  governmentId: {
    fileName: 'id.png',
    mimeType: 'image/png',
    sizeBytes: 70,
    storagePath: 'reg-001/id.png',
  },
};

function renderDetail() {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/members/:id" element={<MemberDetailPage />} />
    </Routes>,
    { route: '/admin/members/mem-uuid-1' },
  );
}

function renderDetailAs(user: SessionUser) {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/members/:id" element={<MemberDetailPage />} />
    </Routes>,
    { route: '/admin/members/mem-uuid-1', user },
  );
}

function primeMemberMocks() {
  mockUseMember.mockReturnValue({ data: MEMBER, isPending: false, isError: false, error: null });
  mockUseMemberRegistration.mockReturnValue({ data: APPLICATION, isPending: false });
  mockGetGovernmentIdUrl.mockResolvedValue('https://signed.test/id.png');
  mockDeleteMemberPermanently.mockResolvedValue({ purgedId: 'mem-uuid-1', authRemoved: true });
}

describe('MemberDetailPage application card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseMember.mockReturnValue({ data: MEMBER, isPending: false, isError: false, error: null });
    mockUseMemberRegistration.mockReturnValue({ data: APPLICATION, isPending: false });
    mockGetGovernmentIdUrl.mockResolvedValue('https://signed.test/id.png');
  });

  it('renders the linked application details including government ID', async () => {
    renderDetail();
    expect(await screen.findByText('Application Details')).toBeInTheDocument();
    expect(screen.getByText('DOMESTIC (prg-domestic)')).toBeInTheDocument();
    expect(screen.getByText('id.png')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument();
    expect(mockUseMemberRegistration).toHaveBeenCalledWith('reg-001');
  });

  it('shows a note for direct-created members without an application', async () => {
    mockUseMember.mockReturnValue({
      data: { ...MEMBER, registrationId: undefined },
      isPending: false,
      isError: false,
      error: null,
    });
    renderDetail();
    expect(await screen.findByText(/Direct-created member/)).toBeInTheDocument();
    expect(mockUseMemberRegistration).toHaveBeenCalledWith(undefined);
  });

  it('explains a missing application as approved-and-removed (not an error)', async () => {
    mockUseMemberRegistration.mockReturnValue({ data: undefined, isPending: false });
    renderDetail();
    expect(await screen.findByText(/removed from the queue/i)).toBeInTheDocument();
    expect(screen.queryByText(/not found/i)).not.toBeInTheDocument();
  });
});

describe('MemberDetailPage permanent purge (super_admin)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeMemberMocks();
  });

  it('hides the permanent delete affordance for non-super-admin staff', async () => {
    renderDetailAs(MOCK_STAFF_ADMIN as SessionUser);
    await screen.findByText('Actions');
    expect(
      screen.queryByRole('button', { name: 'Delete member permanently' }),
    ).not.toBeInTheDocument();
    // Archive stays available to admins.
    expect(screen.getByRole('button', { name: 'Archive member' })).toBeInTheDocument();
  });

  it('requires a reason plus the member email before purging', async () => {
    const user = userEvent.setup();
    renderDetailAs(MOCK_SUPER_ADMIN as SessionUser);

    await user.click(screen.getByRole('button', { name: 'Delete member permanently' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Delete Permanently' });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByPlaceholderText('juan@example.com'), 'juan@example.com');
    expect(confirm).toBeDisabled(); // reason still missing

    await user.type(within(dialog).getByLabelText(/Reason/), 'Duplicate test account');
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    expect(mockDeleteMemberPermanently).toHaveBeenCalledWith(
      'mem-uuid-1',
      'Duplicate test account',
    );
  });

  it('locks the archive confirm while archiving so double-click sends one request', async () => {
    primeMemberMocks();
    let resolveArchive!: (value: unknown) => void;
    const gate = new Promise((resolve) => {
      resolveArchive = resolve;
    });
    mockArchiveMember.mockReturnValueOnce(gate);
    const user = userEvent.setup();
    renderDetailAs(MOCK_STAFF_ADMIN as SessionUser);

    await user.click(screen.getByRole('button', { name: 'Archive member' }));
    const confirm = await screen.findByRole('button', { name: 'Archive' });
    await user.click(confirm);
    await waitFor(() => expect(confirm).toBeDisabled());
    // Second click while pending must not fire again.
    await user.click(confirm);
    resolveArchive({ archivedId: 'mem-uuid-1' });
    await waitFor(() => expect(mockArchiveMember).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Member archived')).toBeInTheDocument();
  });

  it('warns when the auth identity survived the purge (authRemoved:false)', async () => {
    const user = userEvent.setup();
    mockDeleteMemberPermanently.mockResolvedValue({ purgedId: 'mem-uuid-1', authRemoved: false });
    renderDetailAs(MOCK_SUPER_ADMIN as SessionUser);

    await user.click(screen.getByRole('button', { name: 'Delete member permanently' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByPlaceholderText('juan@example.com'), 'juan@example.com');
    await user.type(within(dialog).getByLabelText(/Reason/), 'Duplicate test account');
    await user.click(within(dialog).getByRole('button', { name: 'Delete Permanently' }));

    // The Member row is gone but the login still works - this must be loud.
    expect(await screen.findByText(/auth.*account.*still|still.*log in/i)).toBeInTheDocument();
  });
});
