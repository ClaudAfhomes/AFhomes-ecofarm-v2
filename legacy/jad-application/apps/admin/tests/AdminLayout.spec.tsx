import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MOCK_MEMBER, MOCK_SUPER_ADMIN } from '@jad/mock';

import { renderWithProviders } from '../test/utils';
import { AdminLayout } from './AdminLayout';

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

describe('AdminLayout', () => {
  it('renders the shell with role-filtered navigation and identity', async () => {
    renderWithProviders(<AdminLayout />, { user: MOCK_SUPER_ADMIN });
    expect(await screen.findByAltText('JA&D')).toBeInTheDocument();
    expect(screen.getByText('Saul Super')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument();
    /* SUPER_ADMIN sees all: Dashboard, Members, Operations, Properties, Marketing Tools, System */
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Members' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Operations' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Properties' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Marketing Tools' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'System' })).toBeInTheDocument();
  });

  it('shows no admin navigation for MEMBER role', async () => {
    renderWithProviders(<AdminLayout />, { user: MOCK_MEMBER });
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Members' })).not.toBeInTheDocument();
  });

  it('shows an unresolved-role notice instead of a silently empty sidebar', async () => {
    // Staff role present but roleId unresolvable (missing MemberRole link or
    // failed role lookup): deny by default, but fail loud.
    renderWithProviders(<AdminLayout />, {
      user: { ...MOCK_SUPER_ADMIN, roleId: null },
    });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Navigation unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('shows the session-resolved custom role name and nav without the role catalog', async () => {
    // Production shape for custom-role staff: the catalog fetch fails
    // (super_admin-only), so the shell renders the topbar label and
    // navigation from the session-resolved roleName/roleModules alone -
    // never the raw role id.
    renderWithProviders(<AdminLayout />, {
      user: {
        ...MOCK_SUPER_ADMIN,
        roleId: 'role-admin-support',
        roleName: 'Admin Support',
        roleModules: ['dashboard', 'members', 'registrations'],
      },
    });
    expect(await screen.findByText('Admin Support')).toBeInTheDocument();
    expect(screen.queryByText('role-admin-support')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Members' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Operations' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'System' })).not.toBeInTheDocument();
    expect(screen.queryByText('Navigation unavailable')).not.toBeInTheDocument();
  });

  it('shows no notice when navigation resolves or the user is not staff', async () => {
    const healthy = renderWithProviders(<AdminLayout />, { user: MOCK_SUPER_ADMIN });
    expect(await screen.findByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    healthy.unmount();

    renderWithProviders(<AdminLayout />, { user: MOCK_MEMBER });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps drawer open when toggling a category and closes on child link', async () => {
    mockMatchMedia(false);
    const user = userEvent.setup();
    renderWithProviders(<AdminLayout />, { user: MOCK_SUPER_ADMIN });

    await user.click(screen.getAllByRole('button', { name: 'Open navigation' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Admin navigation' });
    expect(dialog).toBeInTheDocument();

    const category = within(dialog).getByRole('button', { name: 'Operations' });
    expect(category).toHaveAttribute('aria-expanded', 'false');
    expect(within(dialog).queryByRole('link', { name: 'Sales' })).not.toBeInTheDocument();

    // Expand - drawer stays open
    await user.click(category);
    expect(category).toHaveAttribute('aria-expanded', 'true');
    expect(within(dialog).getByRole('link', { name: 'Sales' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Admin navigation' })).toBeInTheDocument();

    // Collapse - drawer stays open
    await user.click(category);
    expect(category).toHaveAttribute('aria-expanded', 'false');
    expect(within(dialog).queryByRole('link', { name: 'Sales' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Admin navigation' })).toBeInTheDocument();

    // Expand again and select child link - navigates and closes drawer
    await user.click(category);
    expect(within(dialog).getByRole('link', { name: 'Sales' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('link', { name: 'Sales' }));
    expect(screen.queryByRole('dialog', { name: 'Admin navigation' })).not.toBeInTheDocument();
  });

  it('toggles category via keyboard without closing drawer', async () => {
    mockMatchMedia(false);
    const user = userEvent.setup();
    renderWithProviders(<AdminLayout />, { user: MOCK_SUPER_ADMIN });

    await user.click(screen.getAllByRole('button', { name: 'Open navigation' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Admin navigation' });
    const category = within(dialog).getByRole('button', { name: 'Operations' });

    expect(category).toHaveAttribute('aria-expanded', 'false');
    category.focus();
    await user.keyboard('{Enter}');
    expect(category).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'Admin navigation' })).toBeInTheDocument();

    await user.keyboard(' ');
    expect(category).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('dialog', { name: 'Admin navigation' })).toBeInTheDocument();
  });

  it('closes the previous dropdown when opening another', async () => {
    mockMatchMedia(false);
    const user = userEvent.setup();
    renderWithProviders(<AdminLayout />, { user: MOCK_SUPER_ADMIN });
    await user.click(screen.getAllByRole('button', { name: 'Open navigation' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Admin navigation' });

    const operationsCategory = within(dialog).getByRole('button', { name: 'Operations' });
    const configCategory = within(dialog).getByRole('button', { name: 'System' });

    expect(operationsCategory).toHaveAttribute('aria-expanded', 'false');
    expect(configCategory).toHaveAttribute('aria-expanded', 'false');

    await user.click(operationsCategory);
    expect(operationsCategory).toHaveAttribute('aria-expanded', 'true');
    expect(within(dialog).getByRole('link', { name: 'Sales' })).toBeInTheDocument();
    expect(configCategory).toHaveAttribute('aria-expanded', 'false');

    // Opening a second dropdown must collapse the first
    await user.click(configCategory);
    expect(configCategory).toHaveAttribute('aria-expanded', 'true');
    expect(operationsCategory).toHaveAttribute('aria-expanded', 'false');
    expect(within(dialog).queryByRole('link', { name: 'Sales' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'System Configuration' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Admin navigation' })).toBeInTheDocument();
  });
});
