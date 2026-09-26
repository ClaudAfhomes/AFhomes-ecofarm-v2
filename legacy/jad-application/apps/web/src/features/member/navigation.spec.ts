import { describe, expect, it } from 'vitest';

import {
  findMemberNavItem,
  memberBreadcrumbItems,
  memberBottomNavItems,
  memberSidebarItems,
} from './navigation';

describe('memberBreadcrumbItems', () => {
  it('renders no trail on the dashboard', () => {
    expect(memberBreadcrumbItems('/member')).toEqual([]);
  });

  it('uses the sub-page label, never the category label', () => {
    expect(memberBreadcrumbItems('/member/ewallet/ledger')).toEqual([
      { label: 'Dashboard', to: '/member' },
      { label: 'Ledger' },
    ]);
  });

  it('puts a clickable list link before Details on detail routes', () => {
    expect(memberBreadcrumbItems('/member/payouts/new')).toEqual([
      { label: 'Dashboard', to: '/member' },
      { label: 'Payouts', to: '/member/payouts' },
      { label: 'Details' },
    ]);
    expect(memberBreadcrumbItems('/member/sales/sal-1')).toEqual([
      { label: 'Dashboard', to: '/member' },
      { label: 'Sales', to: '/member/sales' },
      { label: 'Details' },
    ]);
  });

  it('covers plain items and suppresses unmatched routes', () => {
    expect(memberBreadcrumbItems('/member/profile')).toEqual([
      { label: 'Dashboard', to: '/member' },
      { label: 'Profile' },
    ]);
    expect(memberBreadcrumbItems('/member/unknown')).toBeNull();
  });
});

describe('member navigation registry', () => {
  it('lists categorized member destinations in the sidebar', () => {
    const labels = memberSidebarItems().map((item) => item.label);
    expect(labels).toEqual(['Dashboard', 'Sales & Earnings', 'Referrals', 'Resources', 'Profile']);
  });

  it('includes dropdown sub-items for categorized entries', () => {
    const items = memberSidebarItems();
    const sales = items.find((i) => i.label === 'Sales & Earnings');
    expect(sales?.dropdown).toEqual([
      { to: '/member/sales', label: 'Sales' },
      { to: '/member/qualification', label: 'Qualification' },
      { to: '/member/commissions', label: 'Commissions' },
      { to: '/member/ewallet', label: 'eWallet', end: true },
      { to: '/member/ewallet/ledger', label: 'Ledger' },
      { to: '/member/withdrawals', label: 'Withdrawals' },
      { to: '/member/payouts', label: 'Payouts' },
    ]);
  });

  it('surfaces the 5 most frequent destinations in the bottom nav (UI-UX §4.6)', () => {
    const labels = memberBottomNavItems().map((item) => item.label);
    expect(labels).toEqual(['Dashboard', 'Sales & Earnings', 'Referrals']);
  });

  it('marks the dashboard as the exact root match', () => {
    const item = findMemberNavItem('/member');
    expect(item?.end).toBe(true);
  });

  it('finds a sub-item by pathname within a category', () => {
    const item = findMemberNavItem('/member/ewallet');
    expect(item?.label).toBe('Sales & Earnings');
  });

  it('finds a top-level item by pathname', () => {
    const item = findMemberNavItem('/member/profile');
    expect(item?.label).toBe('Profile');
  });
});
