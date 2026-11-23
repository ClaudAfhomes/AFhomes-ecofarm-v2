import { beforeEach, describe, expect, it } from 'vitest';
import { createInvitedIdentityProvisioner } from './auth-provisioning.js';
import { createMemoryAuthFixture } from './testing/auth-fixture.js';

const identity = { email: ' INVITED@EXAMPLE.INVALID ', fullName: 'Synthetic Person' };
const password = 'OwnerChoosesTestPassword123';
describe('closed-registration identity setup with memory storage', () => {
  let test: ReturnType<typeof createMemoryAuthFixture>;
  let provision: ReturnType<typeof createInvitedIdentityProvisioner>;
  beforeEach(() => {
    test = createMemoryAuthFixture();
    provision = createInvitedIdentityProvisioner(test.options);
  });

  async function provisionAndVerify() {
    const user = await provision(identity);
    await test.auth.api.sendVerificationEmail({ body: { email: user.email } });
    expect(test.mailbox.verification).toHaveLength(1);
    await test.auth.api.verifyEmail({ query: { token: test.mailbox.verification[0]!.token } });
    expect(test.store.auth_users[0]!.emailVerified).toBe(true);
    expect(test.store.auth_sessions).toHaveLength(0);
    return user;
  }

  async function requestSetup(email: string) {
    await test.auth.api.requestPasswordReset({ body: { email } });
    return test.mailbox.reset.at(-1)!.token;
  }

  it('creates only an unverified identity, with no password, session or AFHomes role assignment', async () => {
    const user = await provision(identity);
    expect(user).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      email: 'invited@example.invalid',
    });
    expect(test.store.auth_users[0]!.emailVerified).toBe(false);
    expect(test.store.auth_accounts).toHaveLength(0);
    expect(test.store.auth_sessions).toHaveLength(0);
    expect(Object.keys(test.store)).not.toContain('staff_users');
    expect(provision).not.toHaveProperty('handler');
  });

  it.each([
    { role: 'admin' },
    { roleId: 'administrator' },
    { data: { emailVerified: true } },
    { password },
    { emailVerified: true },
  ])('rejects injected provisioning fields %j', async (extra) => {
    await expect(provision({ ...identity, ...extra })).rejects.toThrow();
    expect(test.store.auth_users).toHaveLength(0);
  });

  it('rejects duplicate identities and leaves public signup closed', async () => {
    await provision(identity);
    await expect(provision(identity)).rejects.toThrow();
    await expect(
      test.auth.api.signUpEmail({
        body: { name: identity.fullName, email: 'other@example.invalid', password },
      }),
    ).rejects.toThrow();
    expect(test.store.auth_users).toHaveLength(1);
  });

  it.each([{ email: { $ne: null } }, { email: 'not-an-email' }, { fullName: 'Invalid123' }])(
    'rejects malformed identity values %j',
    async (extra) => {
      await expect(provision({ ...identity, ...extra })).rejects.toThrow();
      expect(test.store.auth_users).toHaveLength(0);
    },
  );

  it('verifies mailbox ownership and lets the owner set a password without opening signup', async () => {
    const user = await provisionAndVerify();
    const token = await requestSetup(user.email);
    await test.auth.api.resetPassword({ body: { token, newPassword: password } });
    expect(test.store.auth_accounts).toHaveLength(1);
    expect(test.store.auth_sessions).toHaveLength(0);
    await expect(
      test.auth.api.resetPassword({ body: { token, newPassword: password } }),
    ).rejects.toThrow();
    const response = await test.auth.api.signInEmail({
      body: { email: user.email, password },
      asResponse: true,
    });
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies.length).toBeGreaterThan(0);
    const cookie = cookies.map((value) => value.split(';')[0]).join('; ');
    const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.id).toBe(user.id);
    await test.auth.api.signOut({ headers: new Headers({ cookie }) });
    expect(await test.auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
  });

  it('refuses weak passwords without consuming the setup token', async () => {
    const user = await provisionAndVerify();
    const token = await requestSetup(user.email);
    const response = await test.auth.api.resetPassword({
      body: { token, newPassword: 'LongButNoNumber' },
      asResponse: true,
    });
    expect(response.status).toBe(400);
    expect(test.store.auth_accounts).toHaveLength(0);
    await expect(
      test.auth.api.resetPassword({ body: { token, newPassword: password } }),
    ).resolves.toMatchObject({ status: true });
  });

  it('rejects an expired setup token', async () => {
    const user = await provisionAndVerify();
    const token = await requestSetup(user.email);
    const record = test.store.auth_verifications.find((row) =>
      String(row.identifier).includes('reset-password:'),
    );
    expect(record).toBeDefined();
    record!.expiresAt = new Date(0);
    await expect(
      test.auth.api.resetPassword({ body: { token, newPassword: password } }),
    ).rejects.toThrow();
    expect(test.store.auth_accounts).toHaveLength(0);
  });

  it('permits only one concurrent setup-token redemption', async () => {
    const user = await provisionAndVerify();
    const token = await requestSetup(user.email);
    const results = await Promise.allSettled([
      test.auth.api.resetPassword({ body: { token, newPassword: password } }),
      test.auth.api.resetPassword({ body: { token, newPassword: password + 'Other' } }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(test.store.auth_accounts).toHaveLength(1);
  });
});
