import { expect, it } from 'vitest';
import {
  auditStaffIdentityReferences,
  type MigrationIdentitySnapshots,
} from './migration-identity-references.js';

const owner = { sourceId: 'source-owner', targetId: 'target-owner' };
const staff = [
  { id: 'source-owner', email: 'owner@example.invalid' },
  { id: 'staff-two', email: 'staff@example.invalid' },
];
const identities = (): MigrationIdentitySnapshots => ({
  source: structuredClone(staff),
  target: [{ id: 'target-owner', email: 'OWNER@example.invalid' }, { ...staff[1]! }],
});

it('requires identity snapshots and verifies owner aliases without modifying input', () => {
  expect(auditStaffIdentityReferences(staff, owner)).toContainEqual(
    expect.objectContaining({ code: 'IDENTITY_SNAPSHOTS_REQUIRED' }),
  );
  const snapshots = identities(),
    before = structuredClone(snapshots);
  expect(auditStaffIdentityReferences(staff, owner, snapshots)).toEqual([]);
  expect(snapshots).toEqual(before);
});

it('allows only the three owner-reviewed test aliases with exact source/target headers', () => {
  const sourceId = '00000000-0000-4000-8000-000000000003', targetId = '00000000-0000-4000-8000-000000000004';
  const snapshots: MigrationIdentitySnapshots = { source: [{ id: sourceId, email: 'john@gmail.com' }], target: [{ id: targetId, email: 'john@gmail.com' }], approvedAliases: [{ sourceId, targetId, email: 'john@gmail.com', reason: 'owner-approved-test-account' }] };
  const rows = [{ id: sourceId, email: 'john@gmail.com' }];
  expect(auditStaffIdentityReferences(rows, owner, snapshots)).toEqual([]);
  expect(auditStaffIdentityReferences(rows, owner, { ...snapshots, approvedAliases: [] }).length).toBeGreaterThan(0);
  const wrong = structuredClone(snapshots); wrong.approvedAliases![0]!.email = 'other@example.invalid';
  expect(auditStaffIdentityReferences(rows, owner, wrong)).toContainEqual(expect.objectContaining({ code: 'INVALID_APPROVED_TEST_ALIASES' }));
});

it('rejects missing source/target identities and mismatching emails', () => {
  for (const side of ['source', 'target'] as const) {
    const missing = identities();
    missing[side].pop();
    expect(auditStaffIdentityReferences(staff, owner, missing)).toContainEqual(
      expect.objectContaining({ code: `${side.toUpperCase()}_IDENTITY_MISSING` }),
    );
    const mismatch = identities();
    mismatch[side][1]!.email = 'different@example.invalid';
    expect(auditStaffIdentityReferences(staff, owner, mismatch)).toContainEqual(
      expect.objectContaining({ code: `${side.toUpperCase()}_IDENTITY_EMAIL_MISMATCH` }),
    );
  }
});

it('blocks duplicates and refuses email-only linking for non-owner accounts', () => {
  for (const side of ['source', 'target'] as const) {
    const duplicate = identities();
    duplicate[side].push({ ...duplicate[side][0]! });
    expect(auditStaffIdentityReferences(staff, owner, duplicate)).toContainEqual(
      expect.objectContaining({ code: 'AMBIGUOUS_IDENTITY_SNAPSHOT' }),
    );
  }
  const collision = identities();
  collision.target[1]!.id = 'different-target';
  expect(auditStaffIdentityReferences(staff, owner, collision)).toContainEqual(
    expect.objectContaining({ code: 'TARGET_IDENTITY_EMAIL_COLLISION' }),
  );
});

it('refuses raw credential/provider fields without echoing rejected values', () => {
  for (const field of ['password', 'encrypted_password', 'token', 'banned_until']) {
    const snapshots = identities();
    Object.assign(snapshots.source[0]!, { [field]: 'FICTIONAL-REJECTED-IDENTITY-VALUE' });
    const issues = auditStaffIdentityReferences(staff, owner, snapshots);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'INVALID_IDENTITY_SNAPSHOT' }));
    expect(JSON.stringify(issues)).not.toContain('FICTIONAL-REJECTED-IDENTITY-VALUE');
  }
});

it('rejects malformed headers, duplicate normalized emails and invalid staff identities', () => {
  for (const header of [
    { id: '', email: 'valid@example.invalid' },
    { id: 'id', email: ' ' },
    null,
  ]) {
    const snapshots = identities();
    snapshots.source[0] = header as unknown as MigrationIdentitySnapshots['source'][number];
    expect(auditStaffIdentityReferences(staff, owner, snapshots)).toContainEqual(
      expect.objectContaining({ code: 'INVALID_IDENTITY_SNAPSHOT' }),
    );
  }
  const snapshots = identities();
  snapshots.target.push({ id: 'another-id', email: ' STAFF@example.invalid ' });
  expect(auditStaffIdentityReferences(staff, owner, snapshots)).toContainEqual(
    expect.objectContaining({ code: 'AMBIGUOUS_IDENTITY_SNAPSHOT' }),
  );
  expect(
    auditStaffIdentityReferences([{ id: 'staff', email: '' }], owner, identities()),
  ).toContainEqual(expect.objectContaining({ code: 'INVALID_STAFF_IDENTITY' }));
  expect(
    auditStaffIdentityReferences(staff, owner, {
      source: null,
      target: [],
    } as unknown as MigrationIdentitySnapshots),
  ).toContainEqual(expect.objectContaining({ code: 'IDENTITY_SNAPSHOTS_REQUIRED' }));
});
