import { describe, expect, it } from 'vitest';

import {
  MODULE_CATALOG,
  MODULE_LABELS,
  afHomesModuleKeySchema,
  groupedModuleCatalog,
  moduleLabel,
} from './afhomes.js';

/**
 * The module catalog is what makes every permission screen human-readable, so
 * the invariants that keep it honest are pinned here:
 *
 * - COMPLETE: one entry per schema key, no stale entries. A module missing
 *   from the catalog would silently vanish from the Roles screen.
 * - READABLE: a label is never the raw key, and labels are unique so two
 *   modules cannot be confused for one another.
 * - ORDERED: sort_order is unique and strictly increasing, and grouping keeps
 *   that order.
 */
describe('module catalog', () => {
  it('covers every module key exactly once, with no stale entries', () => {
    const catalogKeys = MODULE_CATALOG.map((entry) => entry.key);
    expect(new Set(catalogKeys).size).toBe(catalogKeys.length);
    expect([...catalogKeys].sort()).toEqual([...afHomesModuleKeySchema.options].sort());
  });

  it('labels every module human-readably and uniquely', () => {
    for (const entry of MODULE_CATALOG) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.label).not.toBe(entry.key);
      expect(entry.label).not.toContain('.');
      expect(entry.group.length).toBeGreaterThan(0);
    }
    const labels = MODULE_CATALOG.map((entry) => entry.label);
    expect(new Set(labels).size).toBe(labels.length);
    // The flat map agrees with the catalog.
    for (const entry of MODULE_CATALOG) expect(MODULE_LABELS[entry.key]).toBe(entry.label);
  });

  it('orders modules by a unique, strictly increasing sort order', () => {
    const orders = MODULE_CATALOG.map((entry) => entry.sortOrder);
    expect(new Set(orders).size).toBe(orders.length);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    // Grouping preserves catalog order.
    const flattened = groupedModuleCatalog().flatMap((bucket) => bucket.modules);
    expect(flattened).toEqual([...MODULE_CATALOG]);
  });

  it('names the core staff-console pages', () => {
    // The labels the request names explicitly, pinned so a rename is a test
    // failure rather than a quiet regression.
    expect(moduleLabel('dashboard.view')).toBe('Dashboard');
    expect(moduleLabel('organization.staff')).toBe('Staff');
    expect(moduleLabel('organization.roles')).toBe('Roles & Permissions');
    expect(moduleLabel('sales.customers')).toBe('Customers');
    expect(moduleLabel('finance.payment_verification')).toBe('Payment Verification');
  });

  it('falls back to the raw key for an unknown module, never hiding it', () => {
    expect(moduleLabel('made.up.key')).toBe('made.up.key');
  });
});
