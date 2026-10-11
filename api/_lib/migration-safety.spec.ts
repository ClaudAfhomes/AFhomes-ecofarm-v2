import { describe, expect, it } from 'vitest';
import { assertOrdinaryMigrationSafety } from '../../supabase/migration-safety.js';
describe('ordinary migration balance-preservation guard', () => {
  it('refuses the unapplied historical reset even when production apply is otherwise approved', () => {
    expect(() =>
      assertOrdinaryMigrationSafety(['20261104000001_afhomes_points_rebuild.sql'], []),
    ).toThrow(/LEGACY_POINTS_PRESERVATION_REQUIRED/);
  });
  it('does not block unrelated or already-applied migrations', () => {
    expect(() =>
      assertOrdinaryMigrationSafety(['20261122000001_afhomes_readonly_auth_recovery.sql'], []),
    ).not.toThrow();
    expect(() =>
      assertOrdinaryMigrationSafety(
        ['20261104000001_afhomes_points_rebuild.sql'],
        ['20261104000001'],
      ),
    ).not.toThrow();
  });
});
