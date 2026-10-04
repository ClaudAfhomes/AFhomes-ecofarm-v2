/**
 * Post-login identity decisions on the customer entry (pure logic).
 *
 * A customer goes home; a staff-only sign-in is told plainly it belongs to
 * a staff user (never a generic customer error); a dual identity gets a
 * chooser; anything else fails closed.
 */
import { describe, expect, it } from 'vitest';
import type { AuthPortals } from '@jad/contracts';

import { decideCustomerLogin } from './CustomerLoginForm';

const staff = (roleSlug: string, mustChangePassword = false): AuthPortals => ({
  staff: { roleSlug, roleName: roleSlug, status: 'active', mustChangePassword },
  customer: null,
  ost: null,
});
const customer = (status: 'active' | 'suspended' = 'active'): AuthPortals => ({
  staff: null,
  customer: { status },
  ost: null,
});
const none: AuthPortals = { staff: null, customer: null, ost: null };

describe('decideCustomerLogin', () => {
  it('navigates a customer home', () => {
    expect(decideCustomerLogin(customer())).toEqual({
      kind: 'navigate',
      to: '/customer',
    });
  });

  it('names the staff portal for staff-only sign-ins, never a generic error', () => {
    for (const roleSlug of [
      'finance',
      'hr',
      'employee',
      'vice_director',
      'senior_sales_manager',
      'sales_manager',
    ]) {
      const decision = decideCustomerLogin(staff(roleSlug));
      expect(decision).toMatchObject({
        kind: 'notice',
        message: 'This account belongs to an AF Homes staff user.',
        linkTo: '/staff/login',
      });
    }
  });

  it('points admins at the administration entry', () => {
    expect(decideCustomerLogin(staff('super_admin'))).toMatchObject({
      kind: 'notice',
      linkTo: '/admin/login',
    });
  });

  it('points approved OST sign-ins at OST login', () => {
    expect(
      decideCustomerLogin({
        staff: null,
        customer: null,
        ost: { status: 'active', ostNumber: 'OST-1' },
      }),
    ).toMatchObject({ kind: 'notice', linkTo: '/ost/login' });
  });

  it('offers a chooser for dual staff+customer identities', () => {
    const decision = decideCustomerLogin({
      staff: {
        roleSlug: 'employee',
        roleName: 'Employee',
        status: 'active',
        mustChangePassword: false,
      },
      customer: { status: 'active' },
      ost: null,
    });
    expect(decision.kind).toBe('chooser');
    if (decision.kind === 'chooser') {
      expect(decision.options.map((o) => o.label)).toEqual(['Customer / Member', 'Staff']);
    }
  });

  it('offers a chooser for dual admin+customer identities', () => {
    const decision = decideCustomerLogin({
      staff: {
        roleSlug: 'admin',
        roleName: 'Admin',
        status: 'active',
        mustChangePassword: false,
      },
      customer: { status: 'active' },
      ost: null,
    });
    expect(decision.kind).toBe('chooser');
    if (decision.kind === 'chooser') {
      expect(decision.options.map((o) => o.label)).toEqual(['Customer / Member', 'Administration']);
    }
  });

  it('fails closed with a sign-out for valid Auth with no identity', () => {
    expect(decideCustomerLogin(none)).toMatchObject({
      kind: 'notice',
      signOut: true,
    });
  });
});
