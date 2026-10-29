import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { getAuthOptions } from '../auth.js';

type Mail = { email: string; token: string; url: string };

/** Real library + disposable memory only. Captures callbacks; never sends mail. */
export function createMemoryAuthFixture() {
  const store: Record<string, Record<string, unknown>[]> = {
    auth_users: [],
    auth_sessions: [],
    auth_accounts: [],
    auth_verifications: [],
    auth_rate_limits: [],
    auth_two_factors: [],
  };
  const mailbox: { verification: Mail[]; reset: Mail[] } = { verification: [], reset: [] };
  const options = {
    ...getAuthOptions({
      BETTER_AUTH_SECRET: 'phase2-memory-fixture-only-'.repeat(3),
      BETTER_AUTH_URL: 'http://localhost:3000',
    }),
    database: memoryAdapter(store),
  };
  const auth = betterAuth({
    ...options,
    emailAndPassword: {
      ...options.emailAndPassword,
      sendResetPassword: async ({ user, url, token }) => {
        mailbox.reset.push({ email: user.email, url, token });
      },
    },
    emailVerification: {
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url, token }) => {
        mailbox.verification.push({ email: user.email, url, token });
      },
    },
  });
  return { auth, options, store, mailbox };
}
