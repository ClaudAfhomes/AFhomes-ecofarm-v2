import { describe, expect, it } from 'vitest';
import type { AfHomesPermission } from '@afhomes/contracts';
import { breadcrumbItems, canAccessNavTarget, navItemsForPermissions, istNavItemsForPermissions } from './navigation';

const permission = (moduleKey: AfHomesPermission['moduleKey']): AfHomesPermission => ({
  moduleKey,
  canView: true,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
});

describe('AFHomes navigation', () => {
  it('hides disabled Reports/CMS and removes Accreditation from IST navigation',()=>{
    const grants=[permission('dashboard.view'),permission('sales.card_sales'),permission('governance.audit'),permission('cms.pages')];
    expect(navItemsForPermissions(grants).some(item=>['Reports','Website CMS'].includes(item.label))).toBe(false);
    expect(canAccessNavTarget(grants,'/admin/reports')).toBe(false);
    expect(canAccessNavTarget(grants,'/admin/cms/pages')).toBe(false);
    expect(istNavItemsForPermissions(grants).some(item=>item.label==='Accreditation')).toBe(false);
  });
  it('places Customer Lookup after Dashboard for employee without weakening route guards', () => {
    const grants = [
      permission('dashboard.view'),
      permission('operations.redemption'),
      permission('operations.customer_lookup'),
      permission('sales.id_documents'),
    ];
    const items = navItemsForPermissions(grants);
    expect(items.slice(0, 2).map((item) => item.label)).toEqual(['Dashboard', 'Customer Lookup']);
    expect(items.map((item) => item.label)).not.toContain('Membership Lookup');
    expect(JSON.stringify(items)).not.toContain('/admin/documents');
    expect(canAccessNavTarget([], '/admin/documents')).toBe(false);
    expect(canAccessNavTarget([], '/admin/documents/test')).toBe(false);
    expect(canAccessNavTarget(grants, '/admin/documents/test')).toBe(true);
  });

  it('keeps the member-TRANSACTION lookup out of the global nav', () => {
    // The member lookup shows Membership Codes, so it must not be presented as a
    // system-wide general lookup. It belongs under Redemption, next to the action
    // that follows it.
    const items = navItemsForPermissions([
      permission('dashboard.view'),
      permission('operations.redemption'),
      permission('operations.customer_lookup'),
    ]);
    const topLevel = items.filter((item) => !item.dropdown).map((item) => item.to);
    expect(topLevel).not.toContain('/admin/member-lookup');
    expect(topLevel).toContain('/admin/customer-lookup');
    const redemption = items.find((item) => item.to === '/admin/redemption');
    // A dropdown child may be a divider rather than a link, so narrow before
    // reading `to` instead of asserting on the union type.
    const redemptionTargets = (redemption?.dropdown ?? []).flatMap((child) =>
      'to' in child ? [child.to] : [],
    );
    expect(redemptionTargets).not.toContain('/admin/member-lookup');
  });

  it('reserves Customer Lookup to its own grant, not the till key', () => {
    // The screen has its own module (`operations.customer_lookup`, seeded by
    // 20261131000003 for employee and admin). Visibility is permission-driven:
    // that grant shows the entry, the till key alone does not, and the route
    // guard tracks the same key so hiding and refusing cannot disagree.
    const lookupGrant = [permission('dashboard.view'), permission('operations.customer_lookup')];
    expect(canAccessNavTarget(lookupGrant, '/admin/customer-lookup')).toBe(true);
    const targets = navItemsForPermissions(lookupGrant).flatMap((item) =>
      item.dropdown
        ? item.dropdown.flatMap((child) => ('to' in child ? [child.to] : []))
        : [item.to],
    );
    expect(targets.filter((to) => to?.includes('customer-lookup'))).toEqual([
      '/admin/customer-lookup',
    ]);

    // The till permission is NOT enough: neither the entry nor the URL. The
    // viewer's role is not consulted at all - the effective permission is the
    // whole rule - which is why every "role" case below is the same call.
    const tillOnly = [permission('dashboard.view'), permission('operations.redemption')];
    expect(canAccessNavTarget(tillOnly, '/admin/customer-lookup')).toBe(false);
    expect(
      navItemsForPermissions(tillOnly).some((item) => item.to === '/admin/customer-lookup'),
    ).toBe(false);
    expect(
      navItemsForPermissions(lookupGrant).some((item) => item.to === '/admin/customer-lookup'),
    ).toBe(true);
  });
  it('does not grant employee lookup without its effective permission', () => {
    expect(navItemsForPermissions([])).toEqual([]);
    expect(canAccessNavTarget([], '/admin/customer-lookup')).toBe(false);
    expect(canAccessNavTarget([permission('dashboard.view')], '/admin/customer-lookup')).toBe(
      false,
    );
  });
  it('shows only server-granted groups and links', () => {
    const items = navItemsForPermissions([
      permission('dashboard.view'),
      permission('organization.staff'),
    ]);
    // Phase 25 removes the dead Reports destination when none of its real
    // report modules are visible.
    expect(items.map((item) => item.label)).toEqual(['Dashboard', 'Organization']);
    expect(items[1]?.dropdown?.map((item) => ('label' in item ? item.label : ''))).toEqual([
      'Staff',
    ]);
  });
  it('keeps Reports hidden while its feature flag is disabled, even with governance access', () => {
    const items = navItemsForPermissions([
      permission('dashboard.view'),
      permission('governance.audit'),
    ]);
    expect(items.map((item) => item.label)).toEqual(['Dashboard']);
  });
  it('hides every destination when the server grants nothing', () =>
    expect(navItemsForPermissions([])).toEqual([]));
  it('builds organization breadcrumbs', () =>
    expect(breadcrumbItems('/admin/roles')).toEqual([
      { label: 'Dashboard', to: '/admin' },
      { label: 'Organization' },
      { label: 'Roles' },
    ]));
});
