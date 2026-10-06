import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditResponse, Membership, MembershipCard } from '@afhomes/contracts';
import { Route, Routes } from 'react-router';

import { renderWithProviders } from '../../test/utils';
import type { SessionUser } from '../../lib/session';
import { MembershipCardPrintPage } from './MembershipCardPrintPage';
import { MembershipDetailPage } from './MembershipDetailPage';
import { MembershipsPage } from './MembershipsPage';
import { getMembershipCard, getMemberships } from './services';
import { getAudit } from '../reports/services';

vi.mock('./services', () => ({
  getMemberships: vi.fn(),
  getMembershipCard: vi.fn(),
  reissueMembershipCard: vi.fn(),
  markMembershipPrinted: vi.fn(),
}));

vi.mock('../reports/services', () => ({
  getAudit: vi.fn(),
}));

const mockedGetMemberships = vi.mocked(getMemberships);
const mockedGetMembershipCard = vi.mocked(getMembershipCard);
const mockedGetAudit = vi.mocked(getAudit);

const MEMBER_ID = 'dddddddd-0000-4000-8000-000000000001';

const MEMBER: Membership = {
  id: MEMBER_ID,
  customerId: 'aaaaaaaa-0000-4000-8000-000000000003',
  customerName: 'Pedro Reyes',
  customerStatus: 'active',
  saleId: 'bbbbbbbb-0000-4000-8000-000000000004',
  membershipNumber: 'MBS-000001',
  productId: '33333333-3333-4333-8333-333333333333',
  productName: 'Gold',
  categoryName: 'Membership Cards',
  status: 'active',
  paymentScheme: 'spot_cash',
  pointsBalance: 60000,
  yearlyPointsAllocated: 60000,
  activatedAt: '2026-09-27T09:00:00.000Z',
  expiresAt: '2027-09-27T09:00:00.000Z',
  renewalDueAt: '2027-09-27T09:00:00.000Z',
  cardIssuedAt: '2026-09-28T01:00:00.000Z',
  issuedBy: 'Ops Admin',
  lastPrintedAt: '2026-09-28T02:00:00.000Z',
  printCount: 2,
  createdAt: '2026-09-27T09:00:00.000Z',
};

const CARD: MembershipCard = {
  membershipId: MEMBER_ID,
  membershipNumber: 'MBS-000001',
  memberName: 'Pedro Reyes',
  customerStatus: 'active',
  tierName: 'Gold',
  tierCode: 'GOLD',
  categoryName: 'Membership Cards',
  status: 'active',
  pointsBalance: 60000,
  yearlyPointsAllocated: 60000,
  activatedAt: '2026-09-27T09:00:00.000Z',
  expiresAt: '2027-09-27T09:00:00.000Z',
  validityYears: 1,
  memberCode: 'MBS-000001',
  qrPayload: 'AFHOMES:MBS-000001',
  cardIssuedAt: '2026-09-28T01:00:00.000Z',
  issuedBy: 'Ops Admin',
  lastPrintedAt: '2026-09-28T02:00:00.000Z',
  printCount: 2,
};

const HISTORY: AuditResponse = {
  report: 'audit',
  generatedAt: '2026-09-28T03:00:00.000Z',
  scope: { kind: 'global', viewerRole: 'super_admin', label: 'Audit' },
  window: { from: null, to: null },
  filters: {},
  summary: {},
  data: [
    {
      id: 1,
      createdAt: '2026-09-28T02:00:00.000Z',
      actorId: 'admin-id',
      action: 'MEMBERSHIP_CARD_PRINTED',
      entityType: 'membership',
      entityId: MEMBER_ID,
      summary: 'Card printed',
      metadata: {},
    },
  ],
  meta: { total: 1, limit: 20, offset: 0 },
};

const STAFF: SessionUser = {
  id: 'staff-id',
  name: 'Sam Staff',
  email: 'sam@example.com',
  roleId: 'role-id',
  roleName: 'Admin',
  status: 'active',
  afHomesPermissions: [
    {
      moduleKey: 'finance.card_activation',
      canView: true,
      canCreate: false,
      canUpdate: true,
      canDelete: false,
    },
    {
      moduleKey: 'governance.audit',
      canView: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    },
  ],
};

afterEach(() => vi.clearAllMocks());

beforeEach(() => {
  mockedGetAudit.mockResolvedValue({ ...HISTORY, data: [] });
});

describe('Memberships list', () => {
  it('shows loading while the API request is pending', () => {
    mockedGetMemberships.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<MembershipsPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading memberships');
  });

  it('shows the empty state after an empty response', async () => {
    mockedGetMemberships.mockResolvedValue([]);
    renderWithProviders(<MembershipsPage />);
    expect(await screen.findByText('No memberships')).toBeInTheDocument();
  });

  it('renders issuance and print columns for a populated card', async () => {
    mockedGetMemberships.mockResolvedValue([MEMBER]);
    renderWithProviders(<MembershipsPage />);
    expect(await screen.findByText('MBS-000001')).toBeInTheDocument();
    for (const heading of [
      'Member',
      'Number',
      'Tier',
      'Category',
      'Status',
      'Points',
      'Activated',
      'Valid until',
      'Card Issued',
      'Last Printed',
      'Prints',
    ]) {
      expect(screen.getByRole('columnheader', { name: heading })).toBeInTheDocument();
    }
    expect(screen.getByText('Pedro Reyes')).toBeInTheDocument();
    expect(screen.getByText('Membership Cards')).toBeInTheDocument();
  });

  it('filters rows by member name or number without refetching', async () => {
    mockedGetMemberships.mockResolvedValue([MEMBER]);
    renderWithProviders(<MembershipsPage />);
    await screen.findByText('MBS-000001');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search member or number' }), {
      target: { value: 'no-such-member' },
    });
    // The keystrokes apply after the live-search pause, still without refetching.
    await waitFor(() => {
      expect(screen.queryByText('MBS-000001')).not.toBeInTheDocument();
    });
    expect(mockedGetMemberships).toHaveBeenCalledTimes(1);
  });

  it('replaces loading with a retryable API error state', async () => {
    mockedGetMemberships.mockRejectedValue(new Error('Memberships unavailable'));
    renderWithProviders(<MembershipsPage />);
    await waitFor(() => expect(screen.queryByText('Loading memberships…')).not.toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('Please try again');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Memberships unavailable');
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});

describe('Membership detail', () => {
  function renderDetail(user: SessionUser) {
    return renderWithProviders(
      <Routes>
        <Route path="/admin/memberships/:id" element={<MembershipDetailPage />} />
      </Routes>,
      { route: `/admin/memberships/${MEMBER_ID}`, user },
    );
  }

  it('renders card metadata, issuer, entitlement and history', async () => {
    mockedGetMembershipCard.mockResolvedValue(CARD);
    mockedGetAudit.mockResolvedValue(HISTORY);
    renderDetail(STAFF);
    expect(await screen.findByText('Pedro Reyes')).toBeInTheDocument();
    expect(screen.getByText('Membership Cards')).toBeInTheDocument();
    expect(screen.getByText('Ops Admin')).toBeInTheDocument();
    expect(screen.getAllByText('60,000')).toHaveLength(2);
    expect(await screen.findByText('History')).toBeInTheDocument();
    expect(screen.getByText(/MEMBERSHIP_CARD_PRINTED/)).toBeInTheDocument();
    expect(mockedGetAudit).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'membership', entityId: MEMBER_ID }),
    );
  });

  it('hides history without the audit grant', async () => {
    mockedGetMembershipCard.mockResolvedValue(CARD);
    renderDetail({ ...STAFF, afHomesPermissions: STAFF.afHomesPermissions.slice(0, 1) });
    await screen.findByText('Pedro Reyes');
    expect(screen.queryByText('History')).not.toBeInTheDocument();
    expect(mockedGetAudit).not.toHaveBeenCalled();
  });

  it('shows a retryable error state', async () => {
    mockedGetMembershipCard.mockRejectedValue(new Error('Card unavailable'));
    renderDetail(STAFF);
    await waitFor(() => expect(screen.queryByText('Loading card…')).not.toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('Please try again');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Card unavailable');
  });
});

describe('Printable card', () => {
  it('renders brand, member, tier, category and the no-codes note', async () => {
    mockedGetMembershipCard.mockResolvedValue(CARD);
    renderWithProviders(
      <Routes>
        <Route path="/admin/memberships/:id/card" element={<MembershipCardPrintPage />} />
      </Routes>,
      {
        route: `/admin/memberships/${MEMBER_ID}/card`,
        user: STAFF,
      },
    );
    const proof = await screen.findByRole('img', {
      name: 'AF Homes membership card for Pedro Reyes',
    });
    expect(proof).toHaveTextContent('AF Homes Ecofarm');
    expect(proof).toHaveTextContent('MBS-000001');
    expect(proof).toHaveTextContent('Membership Cards');
    expect(
      screen.getByText(/stored credentials cannot be recovered, only rotated/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument();
  });
});
