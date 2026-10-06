import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AuthPortals } from '@jad/contracts';

import { renderWithProviders } from '../../test/utils';
import App from '../../app/App';
import { decideStaffEntry, isAdminOriginMismatch } from '../../lib/staff-entry';

const portals = (overrides: Partial<AuthPortals> = {}): AuthPortals => ({
  staff: null,
  customer: null,
  ost: null,
  ...overrides,
});

const staffRow = (roleSlug: string, mustChangePassword = false) => ({
  roleSlug,
  roleName: roleSlug,
  status: 'active' as const,
  mustChangePassword,
});

describe('decideStaffEntry', () => {
  it('forwards admin roles at the admin entry to the staff console', () => {
    const next = decideStaffEntry('admin', portals({ staff: staffRow('admin') }));
    expect(next.action).toBe('forward');
    if (next.action === 'forward') expect(next.to).toMatch(/\/admin$/);
  });

  it('refuses staff roles at the admin entry toward /staff/login', () => {
    const next = decideStaffEntry('admin', portals({ staff: staffRow('finance') }));
    expect(next).toMatchObject({ action: 'refuse', linkTo: '/staff/login' });
  });

  it('forwards staff roles at the staff entry to the staff console', () => {
    const next = decideStaffEntry('staff', portals({ staff: staffRow('finance') }));
    expect(next.action).toBe('forward');
    if (next.action === 'forward') expect(next.to).toMatch(/\/admin$/);
  });

  it('refuses admin roles at the staff entry toward /admin/login', () => {
    const next = decideStaffEntry('staff', portals({ staff: staffRow('super_admin') }));
    expect(next).toMatchObject({ action: 'refuse', linkTo: '/admin/login' });
  });

  it('sends a temporary password to the console profile change screen', () => {
    const next = decideStaffEntry('staff', portals({ staff: staffRow('finance', true) }));
    expect(next.action).toBe('forward');
    if (next.action === 'forward') expect(next.to).toMatch(/\/admin\/profile$/);
  });

  it('refuses customer-only identities toward /customer/login', () => {
    const next = decideStaffEntry('staff', portals({ customer: { status: 'active' } }));
    expect(next).toMatchObject({ action: 'refuse', linkTo: '/customer/login' });
  });
});

describe('isAdminOriginMismatch', () => {
  it('flags a remote console while on a loopback dev server', () => {
    expect(isAdminOriginMismatch('https://app.example.invalid/admin', 'localhost')).toBe(true);
    expect(isAdminOriginMismatch('https://app.example.invalid/admin', '127.0.0.1')).toBe(true);
  });

  it('ignores ports: :5173 vs :5174 share one host by design', () => {
    expect(isAdminOriginMismatch('http://localhost:5174/admin', 'localhost')).toBe(false);
    expect(isAdminOriginMismatch('http://127.0.0.1:5174/admin', '127.0.0.1')).toBe(false);
  });

  it('never fires outside loopback (production stays silent)', () => {
    expect(isAdminOriginMismatch('https://app.example.invalid/admin', 'app.example.invalid')).toBe(
      false,
    );
  });

  it('treats an unparseable console URL as no signal, not a mismatch', () => {
    expect(isAdminOriginMismatch('not a url', 'localhost')).toBe(false);
  });
});

describe('staff entry routes', () => {
  it.each([
    ['/admin/login', 'Administration Login'],
    ['/staff/login', 'Staff Login'],
  ])('renders %s outside marketing chrome', async (route, title) => {
    renderWithProviders(<App />, { route });
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(document.querySelector('.afh-public')).not.toBeInTheDocument();
  });

  it.each([['/admin'], ['/staff']])('renders the matching login for bare %s', async (route) => {
    renderWithProviders(<App />, { route });
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(document.querySelector('.afh-public')).not.toBeInTheDocument();
  });
});
