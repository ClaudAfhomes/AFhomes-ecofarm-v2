import { describe, expect, it } from 'vitest';
import type { AfHomesPermission } from '@afhomes/contracts';
import { actionAllowed, permissionsAreSubset } from './afhomes-access.js';

const held: AfHomesPermission[] = [
  {
    moduleKey: 'organization.staff',
    canView: true,
    canCreate: true,
    canUpdate: false,
    canDelete: false,
  },
];

describe('AF Homes server authorization', () => {
  it('denies direct URL actions not granted by the effective matrix', () => {
    expect(actionAllowed(held[0], 'view')).toBe(true);
    expect(actionAllowed(held[0], 'update')).toBe(false);
    expect(actionAllowed(undefined, 'view')).toBe(false);
  });

  it('prevents granting a permission the caller does not possess', () => {
    expect(permissionsAreSubset(held, held)).toBe(true);
    expect(permissionsAreSubset([{ ...held[0]!, canDelete: true }], held)).toBe(false);
  });
});
