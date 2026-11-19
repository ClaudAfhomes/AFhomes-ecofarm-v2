import { describe, expect, it, vi } from 'vitest';
import { provisionMemberWorkbookRow } from './member-workbook-jobs.js';

const actor = '11111111-1111-4111-8111-111111111111';
const job = '22222222-2222-4222-8222-222222222222';
const row = '33333333-3333-4333-8333-333333333333';
const authId = '44444444-4444-4444-8444-444444444444';
const email = 'synthetic@example.invalid';
const user = { id: authId, email, app_metadata: { member_import_row_id: row } };
function db() {
  return {
    rpc: vi.fn(async (fn: string) => ({
      error: null,
      data: fn === 'claim_member_workbook_row' ? { completed: false, authId, email } : authId,
    })),
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({
          data: { user: null as typeof user | null },
          error: { status: 404 } as { status: number } | null,
        })),
        createUser: vi.fn(async () => ({ data: { user }, error: null })),
        deleteUser: vi.fn(),
        inviteUserByEmail: vi.fn(),
      },
    },
  };
}
describe('durable member import Auth boundary', () => {
  it('provisions the reserved UUID with the chosen batch password and immediate login, without an invitation', async () => {
    const fake = db();
    await provisionMemberWorkbookRow(fake, actor, job, row, true, 'TestPass123!');
    expect(fake.auth.admin.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        id: authId,
        email,
        password: 'TestPass123!',
        email_confirm: true,
        app_metadata: { member_import_row_id: row },
      }),
    );
    expect(fake.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
    expect(fake.auth.admin.deleteUser).not.toHaveBeenCalled();
  });
  it('resumes the same owned account after a lost response, without a second creation', async () => {
    const fake = db();
    fake.auth.admin.getUserById.mockResolvedValue({ data: { user }, error: null });
    await provisionMemberWorkbookRow(fake, actor, job, row, true, 'TestPass123!');
    expect(fake.auth.admin.createUser).not.toHaveBeenCalled();
    expect(fake.rpc).toHaveBeenLastCalledWith('install_member_workbook_row', {
      p_actor: actor,
      p_job: job,
      p_row: row,
    });
  });
  it('refuses an unrelated Auth identity even with the same email and UUID', async () => {
    const fake = db();
    fake.auth.admin.getUserById.mockResolvedValue({
      data: { user: { ...user, app_metadata: { member_import_row_id: 'other' } } },
      error: null,
    });
    await expect(
      provisionMemberWorkbookRow(fake, actor, job, row, true, 'TestPass123!'),
    ).rejects.toThrow('ownership');
    expect(fake.auth.admin.createUser).not.toHaveBeenCalled();
    expect(fake.rpc).toHaveBeenCalledTimes(1);
  });
  it('retains the reserved identity on ambiguous SQL outcome and never deletes an account', async () => {
    const fake = db();
    fake.rpc.mockImplementation(async (fn) =>
      fn === 'claim_member_workbook_row'
        ? { error: null, data: { completed: false, authId, email } }
        : ({ error: { message: 'timeout' }, data: null } as never),
    );
    await expect(
      provisionMemberWorkbookRow(fake, actor, job, row, true, 'TestPass123!'),
    ).rejects.toThrow('reserved account');
    expect(fake.auth.admin.deleteUser).not.toHaveBeenCalled();
  });
  it('stops before Auth if claim fails or lookup is uncertain', async () => {
    const fake = db();
    fake.auth.admin.getUserById.mockResolvedValue({ data: { user: null }, error: { status: 503 } });
    await expect(
      provisionMemberWorkbookRow(fake, actor, job, row, true, 'TestPass123!'),
    ).rejects.toThrow('uncertain');
    expect(fake.auth.admin.createUser).not.toHaveBeenCalled();
  });
  it('recovers an ambiguous creation response only through the reserved UUID and row marker', async () => {
    const fake = db();
    fake.auth.admin.getUserById
      .mockResolvedValueOnce({ data: { user: null }, error: { status: 404 } })
      .mockResolvedValueOnce({ data: { user }, error: null });
    fake.auth.admin.createUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'connection interrupted' },
    } as never);
    await provisionMemberWorkbookRow(fake, actor, job, row, true, 'TestPass123!');
    expect(fake.auth.admin.createUser).toHaveBeenCalledTimes(1);
    expect(fake.auth.admin.getUserById.mock.calls).toEqual([[authId], [authId]]);
    expect(fake.rpc).toHaveBeenLastCalledWith('install_member_workbook_row', {
      p_actor: actor,
      p_job: job,
      p_row: row,
    });
  });
  it('holds an ambiguous creation when the recovered row marker does not match', async () => {
    const fake = db();
    fake.auth.admin.getUserById
      .mockResolvedValueOnce({ data: { user: null }, error: { status: 404 } })
      .mockResolvedValueOnce({
        data: { user: { ...user, app_metadata: { member_import_row_id: 'other' } } },
        error: null,
      });
    fake.auth.admin.createUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'connection interrupted' },
    } as never);
    await expect(
      provisionMemberWorkbookRow(fake, actor, job, row, true, 'TestPass123!'),
    ).rejects.toThrow('unconfirmed');
    expect(fake.rpc).toHaveBeenCalledTimes(1);
    expect(fake.auth.admin.deleteUser).not.toHaveBeenCalled();
  });
  it('does not trust a lookup that returns both user data and an error', async () => {
    const fake = db();
    fake.auth.admin.getUserById.mockResolvedValue({ data: { user }, error: { status: 503 } });
    await expect(
      provisionMemberWorkbookRow(fake, actor, job, row, true, 'TestPass123!'),
    ).rejects.toThrow('uncertain');
    expect(fake.auth.admin.createUser).not.toHaveBeenCalled();
    expect(fake.rpc).toHaveBeenCalledTimes(1);
  });
});
