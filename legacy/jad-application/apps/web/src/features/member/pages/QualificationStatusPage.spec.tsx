import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import {
  MOCK_MEMBER,
  MOCK_MEMBER_NOT_QUALIFIED,
  MOCK_MEMBER_PENDING,
  MOCK_MEMBER_REJECTED,
} from '@jad/mock';

import { QualificationStatusPage } from './QualificationStatusPage';
import { renderMember } from '../test/utils';
import { mockFetchNetworkError, mockFetchRoutes } from '../../../test/utils';

const QUALIFIED = {
  status: 'APPROVED_ACTIVE',
  isQualified: true,
  requirements: [
    { key: 'MIN_AGE', label: 'Minimum age', met: true },
    { key: 'EMAIL_VERIFIED', label: 'Email verified', met: true },
    { key: 'ID_VERIFIED', label: 'Government ID verified', met: true },
    { key: 'ADMIN_APPROVAL', label: 'Admin approval', met: true },
    { key: 'QUALIFICATION', label: 'Qualification requirements satisfied', met: true },
  ],
};

const NOT_QUALIFIED = {
  status: 'APPROVED_ACTIVE',
  isQualified: false,
  requirements: [
    { key: 'MIN_AGE', label: 'Minimum age', met: true },
    { key: 'EMAIL_VERIFIED', label: 'Email verified', met: true },
    { key: 'ID_VERIFIED', label: 'Government ID verified', met: true },
    { key: 'ADMIN_APPROVAL', label: 'Admin approval', met: true },
    {
      key: 'QUALIFICATION',
      label: 'Qualification requirements satisfied',
      met: false,
      detail: 'Complete the qualification questions.',
    },
  ],
};

const PENDING = {
  status: 'PENDING',
  isQualified: false,
  requirements: [
    { key: 'MIN_AGE', label: 'Minimum age', met: true },
    {
      key: 'EMAIL_VERIFIED',
      label: 'Email verified',
      met: false,
      detail: 'Verify your email address to continue.',
    },
    {
      key: 'ID_VERIFIED',
      label: 'Government ID verified',
      met: false,
      detail: 'Your government-issued ID is verified manually by JA&D Admin.',
    },
    {
      key: 'ADMIN_APPROVAL',
      label: 'Admin approval',
      met: false,
      detail: 'Your application is under review by JA&D Admin.',
    },
    {
      key: 'QUALIFICATION',
      label: 'Qualification requirements satisfied',
      met: false,
      detail: 'Complete the qualification questions.',
    },
  ],
};

const REJECTED = {
  status: 'REJECTED',
  isQualified: false,
  requirements: [
    { key: 'MIN_AGE', label: 'Minimum age', met: true },
    { key: 'EMAIL_VERIFIED', label: 'Email verified', met: true },
    { key: 'ID_VERIFIED', label: 'Government ID verified', met: true },
    { key: 'ADMIN_APPROVAL', label: 'Admin approval', met: false, detail: 'Not approved' },
    {
      key: 'QUALIFICATION',
      label: 'Qualification requirements satisfied',
      met: false,
      detail: 'Complete.',
    },
  ],
  rejectionReason: 'ID did not match profile.',
};

describe('member QualificationStatusPage (SCR-MEM-004)', () => {
  it('renders qualified state with progress 5/5 and CTAs', async () => {
    mockFetchRoutes({ '/me/qualification': QUALIFIED });
    renderMember(<QualificationStatusPage />, {
      user: MOCK_MEMBER,
      route: '/member/qualification',
    });

    expect(await screen.findByText('You are Active + Qualified')).toBeInTheDocument();
    expect(screen.getByText('5 of 5 requirements met')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '5');
    expect(screen.getByText('Submit a sale')).toHaveAttribute('href', '/member/sales/new');
    expect(screen.getByText('View referral code')).toHaveAttribute('href', '/member/referrals');
    expect(screen.getByText(/Last checked/)).toBeInTheDocument();
  });

  it('renders not qualified APPROVED_ACTIVE with warning and actionable link', async () => {
    mockFetchRoutes({ '/me/qualification': NOT_QUALIFIED });
    renderMember(<QualificationStatusPage />, {
      user: MOCK_MEMBER_NOT_QUALIFIED,
      route: '/member/qualification',
    });

    expect(await screen.findByText('Active but not yet qualified')).toBeInTheDocument();
    expect(screen.getByText('4 of 5 requirements met')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '4');
    // Per-requirement action for QUALIFICATION unmet
    expect(screen.getByRole('link', { name: 'View guidance →' })).toHaveAttribute(
      'href',
      '/member/policies',
    );
  });

  it('renders PENDING with info alert and email verify action', async () => {
    mockFetchRoutes({ '/me/qualification': PENDING });
    renderMember(<QualificationStatusPage />, {
      user: MOCK_MEMBER_PENDING,
      route: '/member/qualification',
    });

    expect(await screen.findByText('Application pending')).toBeInTheDocument();
    expect(screen.getByText('1 of 5 requirements met')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Verify email →' })).toHaveAttribute(
      'href',
      '/register/verify-email',
    );
  });

  it('renders REJECTED with danger alert and resubmit link', async () => {
    mockFetchRoutes({ '/me/qualification': REJECTED });
    renderMember(<QualificationStatusPage />, {
      user: MOCK_MEMBER_REJECTED,
      route: '/member/qualification',
    });

    expect(await screen.findByText('Your application was not approved')).toBeInTheDocument();
    expect(screen.getByText('ID did not match profile.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Resubmit your application' })).toHaveAttribute(
      'href',
      '/member/resubmit',
    );
  });

  it('highlights first unmet requirement via ?highlight=unmet', async () => {
    mockFetchRoutes({ '/me/qualification': NOT_QUALIFIED });
    renderMember(<QualificationStatusPage />, {
      user: MOCK_MEMBER_NOT_QUALIFIED,
      route: '/member/qualification?highlight=unmet',
    });

    const highlighted = await screen.findByLabelText(
      'Not completed: Qualification requirements satisfied',
    );
    expect(highlighted.id).toBe('req-QUALIFICATION');
  });

  it('shows retry when qualification fetch fails', async () => {
    mockFetchRoutes({
      '/me/qualification': { body: { error: { code: 'INTERNAL', message: 'Oops' } }, status: 500 },
    });
    renderMember(<QualificationStatusPage />, {
      user: MOCK_MEMBER,
      route: '/member/qualification',
    });

    expect(await screen.findByText('Could not load your qualification status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows retry on network error', async () => {
    mockFetchNetworkError();
    renderMember(<QualificationStatusPage />, {
      user: MOCK_MEMBER,
      route: '/member/qualification',
    });

    expect(await screen.findByText('Could not load your qualification status')).toBeInTheDocument();
  });
});
