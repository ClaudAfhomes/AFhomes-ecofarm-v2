import { describe, expect, it } from 'vitest';
import { resolveCommissionRule } from './commission-model.js';

const rule = (over: Record<string, unknown>) => ({
  _id: 'rule',
  is_active: true,
  effective_from: '2026-01-01',
  effective_until: null,
  accredited_on_or_after: null,
  rate: '0.04',
  target_type: 'role',
  target_id: 'role-1',
  ...over,
});
const seller = { staffId: 'staff-1', roleId: 'role-1', date: '2026-06-01', accredited: '2026-03-01' };

describe('resolveCommissionRule', () => {
  it('prefers the account rule over the position rule and never stacks', () => {
    const picked = resolveCommissionRule(
      [rule({ _id: 'role' }), rule({ _id: 'own', target_type: 'staff', target_id: 'staff-1' })],
      seller,
    );
    expect(picked?._id).toBe('own');
  });

  it('falls back to the position rule and returns nothing when none match', () => {
    expect(resolveCommissionRule([rule({ _id: 'role' })], seller)?._id).toBe('role');
    expect(resolveCommissionRule([rule({ target_id: 'other-role' })], seller)).toBeUndefined();
    expect(resolveCommissionRule([], seller)).toBeUndefined();
  });

  it('honours active flag, date window and accreditation cut-off', () => {
    expect(resolveCommissionRule([rule({ is_active: false })], seller)).toBeUndefined();
    expect(resolveCommissionRule([rule({ effective_from: '2026-07-01' })], seller)).toBeUndefined();
    expect(resolveCommissionRule([rule({ effective_until: '2026-05-31' })], seller)).toBeUndefined();
    expect(resolveCommissionRule([rule({ effective_until: '2026-06-01' })], seller)).toBeDefined();
    expect(
      resolveCommissionRule([rule({ accredited_on_or_after: '2026-04-01' })], seller),
    ).toBeUndefined();
    expect(
      resolveCommissionRule([rule({ accredited_on_or_after: '2026-04-01' })], {
        ...seller,
        accredited: '',
      }),
    ).toBeUndefined();
  });

  it('ignores role rules when the seller has no role', () => {
    expect(resolveCommissionRule([rule({})], { ...seller, roleId: null })).toBeUndefined();
  });
});
