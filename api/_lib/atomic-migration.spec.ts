import { describe, expect, it } from 'vitest';
import { atomicMigrationSql } from '../../supabase/recovery/atomic-migration.js';
describe('atomic preservation migration execution', () => {
  it('keeps ordinary migration SQL unchanged', () => {
    expect(atomicMigrationSql('ordinary.sql', 'select 1;')).toBe('select 1;');
  });
  it('removes only the reviewed November 12 outer transaction envelope', () => {
    const source = 'begin;\nselect 1;\ncommit;\n';
    expect(atomicMigrationSql('20261112000001_afhomes_service_policy_status.sql', source)).toBe(
      '\nselect 1;\n',
    );
  });
  it('fails closed for unknown or changed transaction boundaries', () => {
    expect(() => atomicMigrationSql('other.sql', 'begin;\ncommit;')).toThrow(/UNREVIEWED/);
    expect(() =>
      atomicMigrationSql('20261112000001_afhomes_service_policy_status.sql', 'begin;\nrollback;'),
    ).toThrow(/UNREVIEWED/);
  });
});
