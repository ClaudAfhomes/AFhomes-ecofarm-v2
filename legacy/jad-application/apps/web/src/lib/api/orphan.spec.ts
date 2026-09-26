import { describe, expect, it } from 'vitest';

import { ApiError } from './errors';
import {
  ARCHIVED_ACCOUNT_MESSAGE,
  getMemberAccessBlock,
  INACTIVE_ACCOUNT_MESSAGE,
  isOrphanMemberError,
  ORPHAN_ACCOUNT_MESSAGE,
} from './orphan';

describe('isOrphanMemberError', () => {
  it('detects the raw PostgREST PGRST116 single-row coercion failure', () => {
    expect(
      isOrphanMemberError({
        code: 'PGRST116',
        message: 'Cannot coerce the result to a single JSON object',
      }),
    ).toBe(true);
  });

  it('detects the API NOT_FOUND Member not found envelope as ApiError', () => {
    expect(
      isOrphanMemberError(
        new ApiError({ code: 'NOT_FOUND', message: 'Member not found', status: 404 }),
      ),
    ).toBe(true);
  });

  it('does not flag unrelated errors', () => {
    expect(
      isOrphanMemberError(new ApiError({ code: 'INTERNAL', message: 'boom', status: 500 })),
    ).toBe(false);
    expect(isOrphanMemberError(new Error('boom'))).toBe(false);
    expect(isOrphanMemberError(null)).toBe(false);
  });

  it('exposes a friendly, non-technical account message', () => {
    expect(ORPHAN_ACCOUNT_MESSAGE).toMatch(/no longer exists/i);
    expect(ORPHAN_ACCOUNT_MESSAGE).not.toMatch(/PGRST116|coerce/i);
  });
});

describe('getMemberAccessBlock', () => {
  it('allows active, unarchived members', () => {
    expect(getMemberAccessBlock({ archivedAt: null, accountStatus: 'ACTIVE' })).toBeNull();
    // Missing flags default to active (legacy rows predate the columns).
    expect(getMemberAccessBlock({})).toBeNull();
    expect(getMemberAccessBlock(null)).toBeNull();
  });

  it('blocks archived members even when active', () => {
    expect(
      getMemberAccessBlock({ archivedAt: '2026-09-01T00:00:00.000Z', accountStatus: 'ACTIVE' }),
    ).toBe('ARCHIVED');
  });

  it('blocks inactive members', () => {
    expect(getMemberAccessBlock({ archivedAt: null, accountStatus: 'INACTIVE' })).toBe('INACTIVE');
  });

  it('prefers the archived reason when both apply', () => {
    expect(
      getMemberAccessBlock({ archivedAt: '2026-09-01T00:00:00.000Z', accountStatus: 'INACTIVE' }),
    ).toBe('ARCHIVED');
  });

  it('exposes friendly, non-technical messages', () => {
    expect(ARCHIVED_ACCOUNT_MESSAGE).toMatch(/archived/i);
    expect(INACTIVE_ACCOUNT_MESSAGE).toMatch(/inactive/i);
  });
});
