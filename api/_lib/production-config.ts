/**
 * Production configuration for the standalone MongoDB API.
 *
 * Validation is intentionally strict and fails closed before the server binds
 * a socket. Error messages name the variable that is wrong and never include
 * its value, a connection string, or a credential.
 */
export type ProductionConfig = {
  host: string;
  port: number;
  mongoUri: string;
  mongoDb: 'afhomes_dev';
  authUrl: string;
  authSecret: string;
  trustedOrigins: string[];
  webUrl: string;
  adminUrl?: string;
  storageProvider?: 's3';
  enableSearchMaintenance: boolean;
  trustProxy: boolean;
  requestTimeoutMs: number;
  shutdownGraceMs: number;
  maxRequestBytes: number;
  assetRoot?: string;
  releaseId?: string;
};

type LoadOptions = { allowEphemeralPort?: boolean };

function value(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const found = value(env, name);
  if (!found) throw new Error(`Missing required production configuration: ${name}`);
  return found;
}

function httpsOrigin(name: string, raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid absolute URL`);
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  )
    throw new Error(`${name} must be an HTTPS origin without a path, query, or credentials`);
  return url.origin;
}

/** An HTTPS URL that may include a path (the admin console lives at /admin). */
function httpsUrl(name: string, raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid absolute URL`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error(`${name} must be an HTTPS URL without query or credentials`);
  return url.toString();
}

function boolean(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = value(env, name);
  if (raw === undefined) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function integer(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = value(env, name);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max)
    throw new Error(`${name} must be between ${min} and ${max}`);
  return parsed;
}

export function loadProductionConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: LoadOptions = {},
): ProductionConfig {
  if (env.NODE_ENV !== 'production')
    throw new Error('NODE_ENV must be production for the standalone API');

  const host = value(env, 'HOST') ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '::1')
    throw new Error('HOST must be 127.0.0.1 or ::1; a public interface is never allowed');

  const port = integer(env, 'PORT', 3084, options.allowEphemeralPort ? 0 : 1024, 65535);

  const mongoUri = required(env, 'MONGODB_URI');
  if (!/^mongodb(?:\+srv)?:\/\//.test(mongoUri) || /\s/.test(mongoUri))
    throw new Error('MONGODB_URI must be a MongoDB connection string');
  const mongoDb = required(env, 'MONGODB_DB');
  if (mongoDb !== 'afhomes_dev')
    throw new Error('MONGODB_DB must be the approved database afhomes_dev');

  const authSecret = required(env, 'BETTER_AUTH_SECRET');
  if (authSecret.length < 32 || authSecret !== authSecret.trim())
    throw new Error('BETTER_AUTH_SECRET must be at least 32 characters without surrounding spaces');
  const authUrl = httpsOrigin('BETTER_AUTH_URL', required(env, 'BETTER_AUTH_URL'));

  const trusted = required(env, 'AFHOMES_AUTH_TRUSTED_ORIGINS')
    .split(',')
    .map((entry) => httpsOrigin('AFHOMES_AUTH_TRUSTED_ORIGINS', entry.trim()));
  const trustedOrigins = [...new Set(trusted)];
  if (!trustedOrigins.includes(authUrl))
    throw new Error('AFHOMES_AUTH_TRUSTED_ORIGINS must include BETTER_AUTH_URL');

  const webUrl = httpsOrigin('AFHOMES_WEB_URL', required(env, 'AFHOMES_WEB_URL'));
  const adminRaw = value(env, 'AFHOMES_ADMIN_URL');
  const adminUrl = adminRaw ? httpsUrl('AFHOMES_ADMIN_URL', adminRaw) : undefined;

  const storageRaw = value(env, 'AFHOMES_PRIVATE_STORAGE_PROVIDER');
  if (storageRaw && storageRaw !== 's3')
    throw new Error('AFHOMES_PRIVATE_STORAGE_PROVIDER must be s3 in production');
  const storageProvider = storageRaw === 's3' ? ('s3' as const) : undefined;

  if (boolean(env, 'AFHOMES_ENABLE_TEST_PURGE', false))
    throw new Error('AFHOMES_ENABLE_TEST_PURGE is not allowed in production');

  const assetRootRaw = value(env, 'AFHOMES_ASSET_ROOT');
  if (assetRootRaw && !/^[A-Za-z]:[\\/]|^\//.test(assetRootRaw))
    throw new Error('AFHOMES_ASSET_ROOT must be an absolute path');

  const releaseRaw = value(env, 'AFHOMES_RELEASE_ID');
  if (releaseRaw && !/^[A-Za-z0-9._-]{1,64}$/.test(releaseRaw))
    throw new Error('AFHOMES_RELEASE_ID may contain only letters, digits, dot, underscore, or dash');

  return Object.freeze({
    host,
    port,
    mongoUri,
    mongoDb: 'afhomes_dev',
    authUrl,
    authSecret,
    trustedOrigins,
    webUrl,
    adminUrl,
    storageProvider,
    enableSearchMaintenance: boolean(env, 'AFHOMES_ENABLE_SEARCH_MAINTENANCE', false),
    trustProxy: boolean(env, 'AFHOMES_TRUST_PROXY', false),
    requestTimeoutMs: integer(env, 'AFHOMES_REQUEST_TIMEOUT_MS', 60_000, 5_000, 300_000),
    shutdownGraceMs: integer(env, 'AFHOMES_SHUTDOWN_GRACE_MS', 25_000, 1_000, 30_000),
    maxRequestBytes: integer(
      env,
      'AFHOMES_MAX_REQUEST_BYTES',
      16 * 1024 * 1024,
      65_536,
      64 * 1024 * 1024,
    ),
    assetRoot: assetRootRaw,
    releaseId: releaseRaw,
  });
}

/** Safe startup summary: names and modes only, never secrets or the URI. */
export function describeProductionConfig(config: ProductionConfig) {
  return {
    host: config.host,
    port: config.port,
    database: config.mongoDb,
    authUrl: config.authUrl,
    trustedOrigins: config.trustedOrigins,
    storage: config.storageProvider ?? 'disabled',
    searchMaintenance: config.enableSearchMaintenance,
    trustProxy: config.trustProxy,
    release: config.releaseId ?? null,
  };
}
