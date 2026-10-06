import { describe, expect, it } from 'vitest';
import type { AuthPortals } from '@afhomes/contracts';
import { decideCustomerLogin } from './CustomerLoginForm';
const staff = (roleSlug: string, mustChangePassword = false): AuthPortals => ({
  staff: { roleSlug, roleName: roleSlug, status: 'active', mustChangePassword },
  customer: null,
  ost: null,
});
describe('customer entry identity routing', () => {
  it.each([
    'employee',
    'finance',
    'hr',
    'vice_director',
    'senior_sales_manager',
    'sales_manager',
    'admin',
    'super_admin',
  ])('routes %s to its shared authorized staff dashboard', (role) => {
    expect(decideCustomerLogin(staff(role))).toEqual({ kind: 'navigate', to: '/admin' });
  });
  it('requires password change before portal entry', () =>
    expect(decideCustomerLogin(staff('employee', true))).toEqual({
      kind: 'navigate',
      to: '/admin/profile',
    }));
  it('routes approved OST directly home', () =>
    expect(
      decideCustomerLogin({
        staff: null,
        customer: null,
        ost: { status: 'active', ostNumber: 'OST-1' },
      }),
    ).toEqual({ kind: 'navigate', to: '/ost/dashboard' }));
  it.each(['active', 'suspended'] as const)(
    'routes a %s customer to its customer shell',
    (status) =>
      expect(decideCustomerLogin({ staff: null, customer: { status }, ost: null })).toEqual({
        kind: 'navigate',
        to: '/customer',
      }),
  );
  it('allows a real dual customer identity to use the customer entry', () =>
    expect(decideCustomerLogin({ ...staff('employee'), customer: { status: 'active' } })).toEqual({
      kind: 'navigate',
      to: '/customer',
    }));
  it('fails closed for Auth without an assigned identity', () =>
    expect(decideCustomerLogin({ staff: null, customer: null, ost: null })).toMatchObject({
      kind: 'notice',
      signOut: true,
    }));
});
