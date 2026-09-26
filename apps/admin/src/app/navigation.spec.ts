import { describe, expect, it } from 'vitest';
import type { AfHomesPermission } from '@jad/contracts';
import { breadcrumbItems, navItemsForPermissions } from './navigation';

const permission = (moduleKey: AfHomesPermission['moduleKey']): AfHomesPermission => ({
  moduleKey,
  canView: true,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
});

describe('AF Homes navigation', () => {
  it('shows only server-granted groups and links', () => {
    const items = navItemsForPermissions([
      permission('dashboard.view'),
      permission('organization.staff'),
    ]);
    expect(items.map((item) => item.label)).toEqual(['Dashboard', 'Organization']);
    expect(items[1]?.dropdown?.map((item) => ('label' in item ? item.label : ''))).toEqual([
      'Staff',
    ]);
  });
  it('hides every destination when the server grants nothing', () =>
    expect(navItemsForPermissions([])).toEqual([]));
  it('builds organization breadcrumbs', () =>
    expect(breadcrumbItems('/admin/roles')).toEqual([
      { label: 'Dashboard', to: '/admin' },
      { label: 'Organization' },
      { label: 'Roles & Permissions' },
    ]));
});
