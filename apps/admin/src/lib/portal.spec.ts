/**
 * Portal entry decisions (pure logic).
 *
 * The entry split is enforced after authentication by role: admin entries
 * accept only Super Admin + Admin, staff entries accept the six operational
 * roles. Everything else names the right portal and links straight there.
 */
import { describe, expect, it } from 'vitest';

import {
  decideForPortal,
  entryPortal,
  loginPathFor,
  logoutPathForRole,
  rememberEntryPortal,
  resolvePostLoginDestination,
} from './portal';

const staff = (roleSlug: string, mustChangePassword = false) => ({
  staff: { roleSlug, roleName: roleSlug, status: 'active' as const, mustChangePassword },
  customer: null,
  ost: null,
});

const customerOnly = {
  staff: null,
  customer: { status: 'active' as const },
  ost: null,
};

describe('decideForPortal (admin entry)', () => {
  it.each(['super_admin', 'admin'])('forwards %s into the console', (roleSlug) => {
    expect(decideForPortal('admin', staff(roleSlug), undefined)).toEqual({
      action: 'forward',
      to: '/admin',
    });
  });

  it('restores a deep link, but never the profile or an auth page', () => {
    expect(decideForPortal('admin', staff('admin'), '/admin/redemption')).toEqual({
      action: 'forward',
      to: '/admin/redemption',
    });
    expect(decideForPortal('admin', staff('admin'), '/admin/profile')).toEqual({
      action: 'forward',
      to: '/admin',
    });
    expect(decideForPortal('admin', staff('admin'), '/admin/login')).toEqual({
      action: 'forward',
      to: '/admin',
    });
  });

  it.each([
    'finance',
    'hr',
    'employee',
    'vice_director',
    'senior_sales_manager',
    'sales_manager',
  ])('refuses %s with the Staff Portal message and link', (roleSlug) => {
    expect(decideForPortal('admin', staff(roleSlug), undefined)).toEqual({
      action: 'refuse',
      message: 'This account uses the Staff Portal.',
      linkTo: '/staff/login',
      linkLabel: 'Go to Staff Login',
    });
  });

  it('refuses a customer-only sign-in with the customer message, never a generic error', () => {
    const decision = decideForPortal('admin', customerOnly, undefined);
    expect(decision.action).toBe('refuse');
    if (decision.action === 'refuse') {
      expect(decision.message).toBe('This is a customer account.');
      expect(decision.linkTo).toMatch(/\/customer\/login$/);
    }
  });

  it('refuses an OST sign-in with the OST message', () => {
    const decision = decideForPortal(
      'admin',
      { staff: null, customer: null, ost: { status: 'active', ostNumber: 'OST-1' } },
      undefined,
    );
    expect(decision).toMatchObject({ action: 'refuse', linkLabel: 'Go to OST Login' });
  });
});

describe('decideForPortal (staff entry)', () => {
  it.each([
    'finance',
    'hr',
    'employee',
    'vice_director',
    'senior_sales_manager',
    'sales_manager',
  ])('forwards %s into the console', (roleSlug) => {
    expect(decideForPortal('staff', staff(roleSlug), undefined).action).toBe('forward');
  });

  it('lands employees on the redemption dashboard by default', () => {
    expect(decideForPortal('staff', staff('employee'), undefined)).toEqual({
      action: 'forward',
      to: '/admin/redemption',
    });
    expect(decideForPortal('staff', staff('finance'), undefined)).toEqual({
      action: 'forward',
      to: '/admin',
    });
  });

  it.each(['super_admin', 'admin'])('refuses %s with the Administration message', (roleSlug) => {
    expect(decideForPortal('staff', staff(roleSlug), undefined)).toEqual({
      action: 'refuse',
      message: 'This account uses the Administration portal.',
      linkTo: '/admin/login',
      linkLabel: 'Go to Administration Login',
    });
  });

  it('refuses OST and customer-only sign-ins with their own portals', () => {
    expect(decideForPortal('staff', staff('ost'), undefined)).toMatchObject({
      linkLabel: 'Go to OST Login',
    });
    expect(decideForPortal('staff', customerOnly, undefined)).toMatchObject({
      linkLabel: 'Go to Customer Login',
    });
  });

  it('a temporary password always forwards to the shared change screen', () => {
    expect(decideForPortal('staff', staff('employee', true), '/admin/redemption')).toEqual({
      action: 'forward',
      to: '/admin/profile',
    });
    expect(decideForPortal('admin', staff('admin', true), undefined)).toEqual({
      action: 'forward',
      to: '/admin/profile',
    });
  });
});

describe('resolvePostLoginDestination', () => {
  it('restores in-app deep links', () => {
    expect(resolvePostLoginDestination('/admin/redemption/history', '/admin')).toBe(
      '/admin/redemption/history',
    );
  });

  it('never restores auth pages or the profile screen', () => {
    for (const path of [
      '/admin/login',
      '/staff/login',
      '/admin/profile',
      '/admin/forgot-password',
      '/staff/reset-password',
      '/customer',
      '/ost/login',
      '',
    ]) {
      expect(resolvePostLoginDestination(path, '/admin')).toBe('/admin');
    }
    expect(resolvePostLoginDestination(undefined, '/admin')).toBe('/admin');
  });
});

describe('logout + entry tracking', () => {
  it('returns admins to the admin entry and everyone else to staff', () => {
    expect(logoutPathForRole('super_admin')).toBe('/admin/login');
    expect(logoutPathForRole('admin')).toBe('/admin/login');
    expect(logoutPathForRole('employee')).toBe('/staff/login');
    expect(logoutPathForRole(undefined)).toBe('/staff/login');
  });

  it('defaults to the admin entry and remembers the staff entry', () => {
    sessionStorage.clear();
    expect(entryPortal()).toBe('admin');
    expect(loginPathFor(entryPortal())).toBe('/admin/login');
    rememberEntryPortal('staff');
    expect(entryPortal()).toBe('staff');
    expect(loginPathFor(entryPortal())).toBe('/staff/login');
  });
});
