import { randomUUID } from 'node:crypto';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { admin, captcha } from 'better-auth/plugins';
import { APIError } from 'better-auth/api';
import { mongodbAdapter } from '@better-auth/mongo-adapter';
import type { Db, MongoClient } from 'mongodb';
import { RECOVERY_PASSWORD_MIN_LENGTH, validateRecoveryPassword } from '@afhomes/shared';
import { verifyMigrationPassword } from './migration-password.js';
import { mongoRuntimeDatabase } from './mongodb-scope.js';

export type AuthDelivery = {
  sendResetPassword?: (message: {
    user: { id: string; email: string };
    url: string;
    token: string;
  }) => Promise<void>;
};

/** Application launchers require a complete pair; isolated library fixtures may omit both. */
export function requireAuthTurnstile(env: NodeJS.ProcessEnv) {
  const siteKey = env.VITE_TURNSTILE_SITE_KEY;
  const secretKey = env.AFHOMES_AUTH_TURNSTILE_SECRET;
  if (!siteKey) throw new Error('Login requires VITE_TURNSTILE_SITE_KEY.');
  if (!secretKey) throw new Error('Login requires server-only AFHOMES_AUTH_TURNSTILE_SECRET.');
  if (secretKey === siteKey)
    throw new Error(
      'AFHOMES_AUTH_TURNSTILE_SECRET must be the server secret, not the public VITE_TURNSTILE_SITE_KEY.',
    );
  if (siteKey !== siteKey.trim())
    throw new Error('VITE_TURNSTILE_SITE_KEY must not have surrounding whitespace.');
  if (secretKey !== secretKey.trim())
    throw new Error('AFHOMES_AUTH_TURNSTILE_SECRET must not have surrounding whitespace.');
  if (secretKey.length < 16)
    throw new Error('AFHOMES_AUTH_TURNSTILE_SECRET must be at least 16 characters.');
  return { siteKey, secretKey };
}

function trustedOrigin(value: string, name: string, allowLoopback: boolean): URL {
  try {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !(allowLoopback && url.protocol === 'http:' && loopback)) ||
      url.hostname.includes('*') ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url;
  } catch {
    throw new Error(`${name} must contain explicit HTTPS origins or HTTP loopback origins.`);
  }
}

export function getAuthOptions(env: NodeJS.ProcessEnv = process.env) {
  if (
    env.AFHOMES_ENABLE_LEGACY_PASSWORDS !== undefined &&
    !['true', 'false'].includes(env.AFHOMES_ENABLE_LEGACY_PASSWORDS)
  )
    throw new Error('AFHOMES_ENABLE_LEGACY_PASSWORDS must be true or false.');
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret || secret.trim().length < 32 || secret !== secret.trim())
    throw new Error('BETTER_AUTH_SECRET must be a server-only secret of at least 32 characters.');
  const allowLoopback = env.NODE_ENV !== 'production';
  const base = trustedOrigin(env.BETTER_AUTH_URL?.trim() ?? '', 'BETTER_AUTH_URL', allowLoopback);
  const extraOrigins =
    env.AFHOMES_AUTH_TRUSTED_ORIGINS?.split(',').map(
      (origin) =>
        trustedOrigin(origin.trim(), 'AFHOMES_AUTH_TRUSTED_ORIGINS', allowLoopback).origin,
    ) ?? [];
  const challenge = env.AFHOMES_AUTH_TURNSTILE_SECRET !== undefined
    ? requireAuthTurnstile(env) : null;
  const testChallenge = challenge && /^[123]x0+AA$/.test(challenge.secretKey);
  if (testChallenge && (!allowLoopback || base.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))
    throw new Error('Turnstile test keys are permitted only in disposable/local HTTP loopback configuration.');

  return {
    appName: 'AFHomes',
    baseURL: base.origin,
    basePath: '/api/v1/auth/identity',
    secret,
    trustedOrigins: [...new Set([base.origin, ...extraOrigins])],
    user: { modelName: 'auth_users' },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: true,
      minPasswordLength: RECOVERY_PASSWORD_MIN_LENGTH,
      revokeSessionsOnPasswordReset: true,
      password: {
        hash: async (password: string) => {
          const error = validateRecoveryPassword(password);
          if (error)
            throw APIError.from('BAD_REQUEST', { code: 'INVALID_PASSWORD', message: error });
          return hashPassword(password);
        },
        verify:
          env.AFHOMES_ENABLE_LEGACY_PASSWORDS === 'true'
            ? verifyMigrationPassword
            : verifyPassword,
      },
    },
    session: {
      modelName: 'auth_sessions',
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 5,
      cookieCache: { enabled: false },
      deferSessionRefresh: true,
    },
    account: { modelName: 'auth_accounts', accountLinking: { enabled: false } },
    verification: { modelName: 'auth_verifications' },
    advanced: {
      ipAddress: { ipAddressHeaders: ['x-real-ip'] },
      disableOriginCheck: false,
      disableCSRFCheck: false,
      cookiePrefix: 'afhomes-mongodb',
      useSecureCookies: base.protocol === 'https:',
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: base.protocol === 'https:',
      },
      // The adapter's "uuid" mode stores BSON UUIDs; the callback keeps string IDs.
      database: { generateId: () => randomUUID() },
    },
    rateLimit: { enabled: true, storage: 'database', modelName: 'auth_rate_limits' },
    plugins: challenge ? [captcha({
      provider: 'cloudflare-turnstile',
      secretKey: challenge.secretKey,
      endpoints: ['/sign-in/email'],
      // Cloudflare's loopback-only dummy response can omit action; live keys always require it.
      expectedAction: testChallenge ? undefined : 'login',
      allowedHostnames: [...new Set([base.hostname, ...extraOrigins.map(origin => new URL(origin).hostname), ...(testChallenge ? ['example.com'] : [])])],
    })] : [],
    telemetry: { enabled: false },
  } satisfies BetterAuthOptions;
}

/** Not mounted. Calling this against Atlas requires separate database-write authorization. */
export function createAfHomesAuth(
  db: Db,
  client: MongoClient,
  env: NodeJS.ProcessEnv = process.env,
  delivery: AuthDelivery = {},
) {
  const options = getAuthOptions(env);
  const database = mongoRuntimeDatabase(env);
  if (db.databaseName !== database || db.client !== client)
    throw new Error(`Authentication requires its matching ${database} MongoDB client.`);
  return betterAuth({
    ...options,
    emailAndPassword: { ...options.emailAndPassword, ...delivery },
    database: mongodbAdapter(db, { client, transaction: true, debugLogs: false }),
  });
}

/**
 * Create a Better Auth instance with admin plugin for server-side user management.
 * Used by staff provisioning to create users with temporary passwords.
 * Not mounted as an HTTP handler - called directly by authorized server code only.
 */
export function createAfHomesAdminAuth(
  db: Db,
  client: MongoClient,
  env: NodeJS.ProcessEnv = process.env,
) {
  const options = getAuthOptions(env);
  const database = mongoRuntimeDatabase(env);
  if (db.databaseName !== database || db.client !== client)
    throw new Error(`Authentication requires its matching ${database} MongoDB client.`);
  return betterAuth({
    ...options,
    database: mongodbAdapter(db, { client, transaction: true, debugLogs: false }),
    plugins: [...options.plugins, admin()],
    emailAndPassword: {
      ...options.emailAndPassword,
      minPasswordLength: 8,
      password: { hash: hashPassword, verify: options.emailAndPassword.password.verify },
    },
  });
}
