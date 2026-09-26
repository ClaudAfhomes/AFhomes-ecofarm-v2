import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { BottomNav, MobileDrawer, Sidebar } from '../index';

const NAV = [
  { to: '/member', label: 'Dashboard', icon: 'home' as const },
  { to: '/member/sales', label: 'Sales' },
];

describe('Sidebar', () => {
  it('renders nav items and badges', () => {
    render(
      <MemoryRouter>
        <Sidebar
          brand="AF Homes"
          items={[...NAV, { to: '/member/wallet', label: 'eWallet', badge: 2 }]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('complementary')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});

describe('BottomNav', () => {
  it('renders items plus a More affordance', async () => {
    const user = userEvent.setup();
    const onMore = vi.fn();
    render(
      <MemoryRouter>
        <BottomNav items={NAV} moreItem={{ label: 'More', onClick: onMore }} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(onMore).toHaveBeenCalledTimes(1);
  });
});

describe('MobileDrawer', () => {
  it('opens as a modal dialog and closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <button>Trigger</button>
        <MobileDrawer open onClose={onClose}>
          <Sidebar items={NAV} />
        </MobileDrawer>
      </MemoryRouter>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Navigation' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
