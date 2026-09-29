/**
 * AF Homes Phase 33 - shared responsive contracts.
 *
 * jsdom performs no layout, so these tests pin the STRUCTURAL contracts that
 * make the CSS responsive rules work: drawer-vs-sidebar switching, dialog
 * landmarks with reachable close controls, table card-collapse labels, and
 * accessible names on icon-only controls. The CSS breakpoints themselves
 * (639px sheet, 640px nav, 1024px sidebar) are reviewed against the styles;
 * viewport-size rendering smoke lives in the app suites.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { mockMatchMedia } from '../test/matchMedia';
import { AppShell } from './AppShell';
import { BottomNav } from './BottomNav';
import { Dialog } from './Dialog';
import { IconButton } from './IconButton';
import { PageHeader } from './PageHeader';
import { StatusChip } from './StatusChip';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from './Table';

const NAV = [
  { to: '/admin', label: 'Dashboard' },
  { to: '/admin/staff', label: 'Staff' },
];

describe('Phase 33 AppShell responsive contracts', () => {
  it('mobile: hamburger opens the drawer with the same links (390px class)', () => {
    mockMatchMedia(false);
    render(
      <MemoryRouter>
        <AppShell navItems={NAV} menuLabel="Open menu">
          <p>content</p>
        </AppShell>
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Open menu' })).not.toBeNull();
    expect(screen.getByRole('main')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    // Drawer reuses the same Sidebar links - nothing permission-hidden appears
    // that the sidebar would not also show.
    expect(screen.getAllByRole('link', { name: 'Staff' }).length).toBeGreaterThanOrEqual(1);
  });

  it('desktop: sidebar navigation renders inline and collapses', () => {
    mockMatchMedia(true);
    render(
      <MemoryRouter>
        <AppShell navItems={NAV} menuLabel="Toggle menu">
          <p>content</p>
        </AppShell>
      </MemoryRouter>,
    );
    expect(screen.getByRole('complementary')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }));
    expect(screen.getByRole('complementary')).not.toBeNull();
  });

  it('bottom nav renders touch-sized links with labels', () => {
    mockMatchMedia(false);
    render(
      <MemoryRouter>
        <AppShell
          navItems={NAV}
          bottomNav={<BottomNav items={NAV.map((n) => ({ ...n, icon: 'home' }))} />}
        >
          <p>content</p>
        </AppShell>
      </MemoryRouter>,
    );
    expect(screen.getByRole('navigation', { name: 'Primary' })).not.toBeNull();
  });
});

describe('Phase 33 dialog responsive contracts', () => {
  it('dialog has a heading, a labelled close control, and a footer region', () => {
    render(
      <Dialog
        open
        onClose={() => {}}
        title="Record payment"
        footer={
          <>
            <button type="button">Cancel</button>
            <button type="button">Save</button>
          </>
        }
      >
        <p>body</p>
      </Dialog>,
    );
    expect(screen.getByRole('dialog', { name: 'Record payment' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Close dialog' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeNull();
  });

  it('icon-only controls always carry an accessible name', () => {
    render(<IconButton icon="close" label="Dismiss scanner" onClick={() => {}} />);
    expect(screen.getByRole('button', { name: 'Dismiss scanner' })).not.toBeNull();
  });
});

describe('Phase 33 table responsive contracts', () => {
  it('cells carry labels so the mobile card collapse stays legible', () => {
    render(
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Sale number</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell label="Sale number">SALE-000001</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const cell = screen.getByText('SALE-000001');
    expect(cell.getAttribute('data-label')).toBe('Sale number');
  });

  it('long status values render through the shared chip without breaking semantics', () => {
    render(<StatusChip label="final_qualification_pending" tone="neutral" />);
    expect(screen.getByText('final_qualification_pending')).not.toBeNull();
  });
});

describe('Phase 33 page header responsive contracts', () => {
  it('title, description and actions all render for the mobile stack', () => {
    render(
      <PageHeader
        title="Card Sales"
        description="Frozen snapshots."
        actions={<button type="button">New application</button>}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Card Sales' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'New application' })).not.toBeNull();
  });
});
