import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetMockMemberLifecycle } from '../../../mock/handlers';
import { resetRegistrationStore } from '../../../mock/registrationMockStore';
import { installMockApi } from '../../../test/utils';
import { getArchived, restoreArchivedMember } from './archiveRepository';
import { archiveMember, deleteMemberPermanently, getMembers } from './memberRepository';

/**
 * Mock member lifecycle (archive → archived roster → restore, purge):
 * archive moves the record to Archives (visible via getArchived), restore
 * returns it, purge removes it. Store is reset per test for isolation.
 */
describe('mock member lifecycle', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    resetRegistrationStore();
    resetMockMemberLifecycle();
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
    resetRegistrationStore();
    resetMockMemberLifecycle();
  });

  it('archives a member into the archived roster', async () => {
    const before = await getMembers();
    expect(before.map((m) => m.id)).toContain('mem-001');

    const result = await archiveMember('mem-001');
    expect(result).toMatchObject({ archivedId: 'mem-001' });

    const after = await getMembers();
    expect(after.map((m) => m.id)).not.toContain('mem-001');

    const archived = await getArchived();
    const record = archived.find((a) => a.memberId === 'mem-001');
    expect(record).toBeDefined();
    expect(record!.originalData.firstName).toBe('Juan');
  });

  it('restores an archived member to the active roster', async () => {
    await archiveMember('mem-002');
    expect((await getMembers()).map((m) => m.id)).not.toContain('mem-002');

    await restoreArchivedMember('arch-mem-002');
    expect((await getMembers()).map((m) => m.id)).toContain('mem-002');

    const archived = await getArchived();
    expect(archived.find((a) => a.memberId === 'mem-002')).toBeUndefined();
  });

  it('purges a member from the mock roster', async () => {
    const result = await deleteMemberPermanently('mem-005', 'test cleanup');
    expect(result).toMatchObject({ purgedId: 'mem-005', authRemoved: true });
    expect((await getMembers()).map((m) => m.id)).not.toContain('mem-005');
  });

  it('rejects archiving an already-archived member', async () => {
    await archiveMember('mem-007');
    await expect(archiveMember('mem-007')).rejects.toThrow();
  });
});
