/**
 * Portal routing resolver matrix.
 *
 * Pure function, both SPAs and the server agree because there is exactly one
 * implementation. Every identity combination maps to exactly one legal
 * destination; in particular a dual identity never auto-escalates and a
 * temporary password always routes to the forced change first.
 */
import { describe, expect, it } from 'vitest';

import {
  isAdminPortalRole,
  isStaffPortalRole,
  resolvePortalDestination,
  type PortalIdentity,
} from './portal-routing.js';

const base: PortalIdentity = {
  staffRole: null,
  mustChangePassword: false,
  hasActiveCustomer: false,
  hasCustomer: false,
  ostStatus: null,
};

describe('portal role sets', () => {
  it('admin portal is super_admin + admin only', () => {
    expect(isAdminPortalRole('super_admin')).toBe(true);
    expect(isAdminPortalRole('admin')).toBe(true);
    for (const role of [
      'finance',
      'hr',
      'employee',
      'vice_director',
      'senior_sales_manager',
      'sales_manager',
      'ost',
      'customer',
    ]) {
      expect(isAdminPortalRole(role)).toBe(false);
    }
    expect(isAdminPortalRole(null)).toBe(false);
  });

  it('staff portal is the six operational roles, never ost/admin/customer', () => {
    for (const role of [
      'finance',
      'hr',
      'employee',
      'vice_director',
      'senior_sales_manager',
      'sales_manager',
    ]) {
      expect(isStaffPortalRole(role)).toBe(true);
    }
    for (const role of ['super_admin', 'admin', 'ost', 'customer', null, undefined]) {
      expect(isStaffPortalRole(role)).toBe(false);
    }
  });
});

describe('resolvePortalDestination', () => {
  it('routes a customer-only identity to the customer portal', () => {
    expect(
      resolvePortalDestination({ ...base, hasCustomer: true, hasActiveCustomer: true }),
    ).toBe('customer');
  });

  it('routes a suspended customer to the portal shell, not nowhere', () => {
    expect(resolvePortalDestination({ ...base, hasCustomer: true })).toBe('customer');
  });

  it.each([
    'finance',
    'hr',
    'employee',
    'vice_director',
    'senior_sales_manager',
    'sales_manager',
  ])('routes %s to the staff portal', (staffRole) => {
    expect(resolvePortalDestination({ ...base, staffRole })).toBe('staff');
  });

  it.each(['super_admin', 'admin'])('routes %s to the admin portal', (staffRole) => {
    expect(resolvePortalDestination({ ...base, staffRole })).toBe('admin');
  });

  it('routes an approved OST to the OST portal even with a staff row', () => {
    expect(
      resolvePortalDestination({ ...base, staffRole: 'ost', ostStatus: 'active' }),
    ).toBe('ost');
  });

  it('a pending OST applicant has no portal yet', () => {
    expect(resolvePortalDestination({ ...base, ostStatus: 'suspended' })).toBe('pending-ost');
  });

  it('a temporary password wins over every portal', () => {
    expect(
      resolvePortalDestination({ ...base, staffRole: 'sales_manager', mustChangePassword: true }),
    ).toBe('password-change');
    expect(
      resolvePortalDestination({
        ...base,
        staffRole: 'admin',
        hasCustomer: true,
        hasActiveCustomer: true,
        mustChangePassword: true,
      }),
    ).toBe('password-change');
  });

  it('dual staff+customer offers a chooser, never an automatic staff landing', () => {
    expect(
      resolvePortalDestination({
        ...base,
        staffRole: 'employee',
        hasCustomer: true,
        hasActiveCustomer: true,
      }),
    ).toBe('chooser-customer-staff');
  });

  it('dual admin+customer offers a chooser, never an automatic downgrade', () => {
    expect(
      resolvePortalDestination({
        ...base,
        staffRole: 'super_admin',
        hasCustomer: true,
        hasActiveCustomer: true,
      }),
    ).toBe('chooser-customer-admin');
  });

  it('valid Auth with no AF Homes identity has no portal', () => {
    expect(resolvePortalDestination(base)).toBe('no-portal');
  });
});
