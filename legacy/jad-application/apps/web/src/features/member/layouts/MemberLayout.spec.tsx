import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MOCK_MEMBER } from '@jad/mock';

function mockMatchMedia(matches: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

import { MemberLayout } from './MemberLayout';
import { renderMember } from '../test/utils';

describe('MemberLayout', () => {
  it('renders the shell with categorized navigation and member identity', async () => {
    renderMember(<MemberLayout />, { route: '/member', user: MOCK_MEMBER });

    expect(await screen.findByAltText('JA&D')).toBeInTheDocument();
    expect(screen.getByText('JA&D Realty')).toBeInTheDocument();
    expect(screen.getByText('Member Portal')).toBeInTheDocument();
    expect(screen.getByText('juan.delacruz@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument();
    /* Sidebar: Dashboard is a single-page link; categories are rendered as buttons. */
    const sidebar = screen.getByRole('complementary', { name: 'Member navigation' });
    expect(within(sidebar).getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: 'Sales & Earnings' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: 'Referrals' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: 'Resources' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('link', { name: 'Profile' })).toBeInTheDocument();
  });

  it('shows the bottom nav and opens the drawer via More', async () => {
    const user = userEvent.setup();
    renderMember(<MemberLayout />, { route: '/member', user: MOCK_MEMBER });

    const bottomNav = await screen.findByRole('navigation', { name: 'Primary' });
    expect(within(bottomNav).getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(within(bottomNav).getByRole('link', { name: 'Sales & Earnings' })).toBeInTheDocument();
    expect(within(bottomNav).getByRole('link', { name: 'Referrals' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'More' }));
    const dialog = screen.getByRole('dialog', { name: 'Member navigation' });
    expect(within(dialog).getByRole('button', { name: 'Sales & Earnings' })).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Profile' })).toBeInTheDocument();
  });

  it('keeps drawer open when toggling a category and closes on child link', async () => {
    mockMatchMedia(false);
    const user = userEvent.setup();
    renderMember(<MemberLayout />, { route: '/member', user: MOCK_MEMBER });

    // Open drawer via bottom nav More (mobile - hamburger is hidden, replaced by logo)
    await user.click(screen.getByRole('button', { name: 'More' }));
    const dialog = await screen.findByRole('dialog', { name: 'Member navigation' });
    expect(dialog).toBeInTheDocument();

    const category = within(dialog).getByRole('button', { name: 'Sales & Earnings' });
    // Initially collapsed: child link not visible, aria-expanded false
    expect(category).toHaveAttribute('aria-expanded', 'false');
    expect(within(dialog).queryByRole('link', { name: 'Sales' })).not.toBeInTheDocument();

    // Expand - drawer stays open
    await user.click(category);
    expect(category).toHaveAttribute('aria-expanded', 'true');
    expect(within(dialog).getByRole('link', { name: 'Sales' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Member navigation' })).toBeInTheDocument();

    // Collapse - drawer stays open, other categories unaffected
    await user.click(category);
    expect(category).toHaveAttribute('aria-expanded', 'false');
    expect(within(dialog).queryByRole('link', { name: 'Sales' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Referrals' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('dialog', { name: 'Member navigation' })).toBeInTheDocument();

    // Expand again and select child link - navigates and closes drawer
    await user.click(category);
    expect(within(dialog).getByRole('link', { name: 'Sales' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('link', { name: 'Sales' }));
    expect(screen.queryByRole('dialog', { name: 'Member navigation' })).not.toBeInTheDocument();
  });

  it('toggles category via keyboard without closing drawer', async () => {
    mockMatchMedia(false);
    const user = userEvent.setup();
    renderMember(<MemberLayout />, { route: '/member', user: MOCK_MEMBER });

    await user.click(screen.getByRole('button', { name: 'More' }));
    const dialog = await screen.findByRole('dialog', { name: 'Member navigation' });
    const category = within(dialog).getByRole('button', { name: 'Referrals' });

    expect(category).toHaveAttribute('aria-expanded', 'false');
    category.focus();
    await user.keyboard('{Enter}');
    expect(category).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'Member navigation' })).toBeInTheDocument();

    await user.keyboard(' ');
    expect(category).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('dialog', { name: 'Member navigation' })).toBeInTheDocument();
  });

  it('owns the breadcrumb trail: sub-page label + clickable list link', () => {
    renderMember(<MemberLayout />, { route: '/member/ewallet/ledger', user: MOCK_MEMBER });

    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getByText('Dashboard')).toBeInTheDocument();
    // Sub-page label, not the category label (the old bug).
    expect(within(trail).getByText('Ledger')).toBeInTheDocument();
    // Exactly one breadcrumb nav - page components must not render their own.
    expect(screen.getAllByRole('navigation', { name: 'Breadcrumb' }).length).toBe(1);
  });

  it('renders a detail trail with a clickable list link and suppresses unmatched routes', () => {
    renderMember(<MemberLayout />, { route: '/member/payouts/new', user: MOCK_MEMBER });

    const detail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(detail!).getByRole('link', { name: 'Payouts' })).toHaveAttribute(
      'href',
      '/member/payouts',
    );
    expect(within(detail!).getByText('Details')).toBeInTheDocument();
  });

  it('suppresses the trail when no nav item matches the route', () => {
    renderMember(<MemberLayout />, { route: '/member/unknown', user: MOCK_MEMBER });
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument();
  });

  it('renders Profile as the current page for the profile route', () => {
    renderMember(<MemberLayout />, { route: '/member/profile', user: MOCK_MEMBER });
    const trails = screen.getAllByRole('navigation', { name: 'Breadcrumb' });
    expect(trails.length).toBe(1);
    expect(within(trails[0]!).getByText('Profile')).toBeInTheDocument();
  });

  it('closes the previous dropdown when opening another', async () => {
    mockMatchMedia(false);
    const user = userEvent.setup();
    renderMember(<MemberLayout />, { route: '/member', user: MOCK_MEMBER });

    await user.click(screen.getByRole('button', { name: 'More' }));
    const dialog = await screen.findByRole('dialog', { name: 'Member navigation' });

    const salesCategory = within(dialog).getByRole('button', { name: 'Sales & Earnings' });
    const referralsCategory = within(dialog).getByRole('button', { name: 'Referrals' });

    expect(salesCategory).toHaveAttribute('aria-expanded', 'false');
    expect(referralsCategory).toHaveAttribute('aria-expanded', 'false');

    await user.click(salesCategory);
    expect(salesCategory).toHaveAttribute('aria-expanded', 'true');
    expect(within(dialog).getByRole('link', { name: 'Sales' })).toBeInTheDocument();
    expect(referralsCategory).toHaveAttribute('aria-expanded', 'false');

    // Opening a second dropdown must collapse the first
    await user.click(referralsCategory);
    expect(referralsCategory).toHaveAttribute('aria-expanded', 'true');
    expect(salesCategory).toHaveAttribute('aria-expanded', 'false');
    expect(within(dialog).queryByRole('link', { name: 'Sales' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Direct Referrals' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Member navigation' })).toBeInTheDocument();
  });
});
