import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { AppShell } from '../index';
import { mockMatchMedia } from '../test/matchMedia';

const NAV = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/registrations', label: 'Registrations' },
];

function renderShell() {
  return render(
    <MemoryRouter>
      <AppShell brand="AFHomes" navItems={NAV} topbarActions={<button>Export</button>}>
        <h1>Queue</h1>
      </AppShell>
    </MemoryRouter>,
  );
}

describe('AppShell', () => {
  it('opens a compact workspace with the navigation rail collapsed and context in the topbar', () => {
    mockMatchMedia(true);
    render(
      <MemoryRouter>
        <AppShell compactWorkspace navItems={NAV} topbarContext={<span>New application</span>}>
          <h1>Application</h1>
        </AppShell>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Registrations' })).toHaveAttribute(
      'title',
      'Registrations',
    );
    expect(within(screen.getByRole('banner')).getByText('New application')).toBeInTheDocument();
  });
  it('renders semantic landmarks (aside, header, main)', () => {
    mockMatchMedia(true);
    renderShell();
    expect(screen.getByRole('complementary', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toBeInTheDocument();
  });

  it('opens the navigation drawer on mobile via the menu button', async () => {
    mockMatchMedia(false);
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Navigation' });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Registrations' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not render the drawer on desktop', async () => {
    mockMatchMedia(true);
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps drawer open when toggling category and closes on child link', async () => {
    mockMatchMedia(false);
    const user = userEvent.setup();
    const NAV_WITH_DROPDOWN = [
      { to: '/admin', label: 'Dashboard', end: true },
      {
        to: '/admin/ops',
        label: 'Operations',
        dropdown: [
          { to: '/admin/sales', label: 'Sales' },
          { to: '/admin/payouts', label: 'Payouts' },
        ],
      },
    ];
    render(
      <MemoryRouter>
        <AppShell brand="AFHomes" navItems={NAV_WITH_DROPDOWN}>
          <h1>Queue</h1>
        </AppShell>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = await screen.findByRole('dialog', { name: 'Navigation' });
    const category = within(dialog).getByRole('button', { name: 'Operations' });
    expect(category).toHaveAttribute('aria-expanded', 'false');
    expect(within(dialog).queryByRole('link', { name: 'Sales' })).not.toBeInTheDocument();

    await user.click(category);
    expect(category).toHaveAttribute('aria-expanded', 'true');
    expect(within(dialog).getByRole('link', { name: 'Sales' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Navigation' })).toBeInTheDocument();

    await user.click(category);
    expect(category).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('dialog', { name: 'Navigation' })).toBeInTheDocument();

    await user.click(category);
    await user.click(within(dialog).getByRole('link', { name: 'Sales' }));
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument();
  });

  it('auto-collapses the sidebar to icon-only on desktop after a module link is clicked', async () => {
    mockMatchMedia(true);
    const user = userEvent.setup();
    renderShell();
    const link = screen.getByRole('link', { name: 'Registrations' });
    // Collapsed state surfaces as a `title` tooltip on each item (see
    // `Sidebar`); uncollapsed links carry none.
    expect(link).not.toHaveAttribute('title');
    await user.click(link);
    expect(link).toHaveAttribute('title', 'Registrations');
  });

  it('does not collapse the sidebar when only expanding a dropdown category', async () => {
    mockMatchMedia(true);
    const user = userEvent.setup();
    const NAV_WITH_DROPDOWN = [
      { to: '/admin', label: 'Dashboard', end: true },
      {
        to: '/admin/ops',
        label: 'Operations',
        dropdown: [{ to: '/admin/sales', label: 'Sales' }],
      },
    ];
    render(
      <MemoryRouter>
        <AppShell brand="AFHomes" navItems={NAV_WITH_DROPDOWN}>
          <h1>Queue</h1>
        </AppShell>
      </MemoryRouter>,
    );
    const category = screen.getByRole('button', { name: 'Operations' });
    await user.click(category);
    const sub = screen.getByRole('link', { name: 'Sales' });
    expect(sub).not.toHaveAttribute('title');
  });
});
