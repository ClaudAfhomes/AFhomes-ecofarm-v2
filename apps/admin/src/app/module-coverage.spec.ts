import { describe, expect, it } from 'vitest';

import { MODULE_CATALOG, afHomesModuleKeySchema, moduleLabel } from '@afhomes/contracts';

import { ADMIN_NAV_ITEMS, EXTRA_GATED_ROUTES } from './navigation';

/**
 * "Every existing admin/staff page is in the Roles listing."
 *
 * The Roles screen and its access dialog list the module catalog, so a page
 * whose module is missing from that catalog would be invisible to whoever
 * grants access to it. This spec is the tripwire: it walks the nav table and
 * the explicitly-gated routes - the two places a console page is declared -
 * and refuses any module key the catalog cannot label. Adding a page without
 * adding its module is a test failure, never a silent gap.
 */
describe('module catalog covers every console page', () => {
  it('labels every navigation entry and its dropdown children', () => {
    const navModules = ADMIN_NAV_ITEMS.flatMap((item) => [
      item.module,
      ...(item.dropdown ?? []).map((child) => child.module),
    ]);
    expect(navModules.length).toBeGreaterThan(10);
    for (const moduleKey of navModules) {
      expect(afHomesModuleKeySchema.safeParse(moduleKey).success).toBe(true);
      // A label equal to the key would mean the catalog does not know it.
      expect(moduleLabel(moduleKey)).not.toBe(moduleKey);
    }
  });

  it('labels every explicitly gated non-nav page', () => {
    expect(EXTRA_GATED_ROUTES.length).toBeGreaterThan(0);
    for (const entry of EXTRA_GATED_ROUTES) {
      expect(afHomesModuleKeySchema.safeParse(entry.module).success).toBe(true);
      expect(moduleLabel(entry.module)).not.toBe(entry.module);
    }
    // The screens this table exists for stay covered by name.
    const byPrefix = new Map(EXTRA_GATED_ROUTES.map((entry) => [entry.pathPrefix, entry.module]));
    expect(byPrefix.get('/admin/member-lookup')).toBe('operations.redemption');
    expect(byPrefix.get('/admin/customer-lookup')).toBe('operations.customer_lookup');
    expect(byPrefix.has('/admin/documents')).toBe(false);
    expect(byPrefix.get('/admin/customers/applications/import-export')).toBe(
      'governance.customer_import',
    );
  });

  it('keeps the catalog complete against the schema', () => {
    // The same invariant the contracts spec pins, asserted from the console
    // side: every schema key is listed exactly once.
    expect(MODULE_CATALOG.map((entry) => entry.key).sort()).toEqual(
      [...afHomesModuleKeySchema.options].sort(),
    );
  });

  it('uses unique destinations for every live link', () => {
    // A dropdown PARENT intentionally repeats its first child (the group header
    // links to the same page as the first entry), so uniqueness is asserted on
    // the live links: every child, plus every item without a dropdown.
    const liveLinks = ADMIN_NAV_ITEMS.flatMap((item) =>
      item.dropdown?.length ? item.dropdown.map((child) => child.to) : [item.to],
    );
    expect(liveLinks.length).toBeGreaterThan(10);
    expect(new Set(liveLinks).size).toBe(liveLinks.length);
  });
});
