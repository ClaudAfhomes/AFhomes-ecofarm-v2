import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Db, MongoClient } from 'mongodb';
import { getAuthOptions } from './auth.js';
import { mongoRuntimeDatabase } from './mongodb-scope.js';
import { createMongoPhase5Runtime } from './mongo-runtime.js';
import { createMongoDevelopmentHandler } from './mongo-development-access.js';
import { createHostedPrivateObjectStore } from './private-object-store.js';

function flag(value: string | undefined) {
  if (value && !['true', 'false'].includes(value))
    throw new Error('Use an explicit true/false flag');
  return value === 'true';
}
export function hostedMongoConfig(env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV !== 'production' || env.AFHOMES_HOSTED_RUNTIME_ENABLED !== 'true')
    throw new Error('Hosted runtime requires explicit production opt-in');
  const base = new URL(env.AFHOMES_PUBLIC_ORIGIN ?? '');
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.port ||
    base.pathname !== '/' ||
    base.search ||
    base.hash ||
    !base.hostname.includes('.') ||
    /^(localhost|127\.|0\.|\[)/.test(base.hostname) ||
    /^\d+(?:\.\d+){3}$/.test(base.hostname)
  )
    throw new Error('A canonical public HTTPS origin is required');
  const origin = base.origin;
  if (
    env.BETTER_AUTH_URL !== origin ||
    env.AFHOMES_WEB_URL !== origin ||
    env.AFHOMES_ADMIN_URL !== origin + '/admin'
  )
    throw new Error('Hosted application URLs must share the canonical origin');
  if (
    env.AFHOMES_AUTH_TRUSTED_ORIGINS &&
    env.AFHOMES_AUTH_TRUSTED_ORIGINS.split(',').some((value) => value.trim() !== origin)
  )
    throw new Error('Unexpected hosted trusted origin');
  getAuthOptions(env);
  if (env.MONGODB_DB?.trim() !== mongoRuntimeDatabase(env))
    throw new Error('Hosted database must match the explicitly selected runtime scope');
  const port = Number(env.PORT ?? 3084);
  if (
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    (env.HOST && env.HOST !== '127.0.0.1')
  )
    throw new Error('Hosted API requires an unprivileged loopback listener');
  if (
    env.AFHOMES_PRIVATE_STORAGE_PROVIDER === 'filesystem' &&
    !path.isAbsolute(env.AFHOMES_PRIVATE_STORAGE_ROOT ?? '')
  )
    throw new Error('Hosted private files require an absolute persistent directory');
  if (env.AFHOMES_PRIVATE_STORAGE_PROVIDER === 'filesystem') {
    const root = path.resolve(env.AFHOMES_PRIVATE_STORAGE_ROOT!);
    if (
      ['vercel-static', 'apps/web/dist', 'apps/admin/dist'].some(
        (folder) =>
          root === path.resolve(folder) || root.startsWith(path.resolve(folder) + path.sep),
      )
    )
      throw new Error('Private files cannot be placed inside a static site directory');
  }
  if (!['filesystem', 's3'].includes(env.AFHOMES_PRIVATE_STORAGE_PROVIDER ?? ''))
    throw new Error('Hosted private storage must be explicit');
  const coreWritesEnabled = flag(env.AFHOMES_MONGODB_ENABLE_CORE_WRITES),
    maintenanceEnabled = flag(env.AFHOMES_HOSTED_SEARCH_MAINTENANCE);
  if (maintenanceEnabled && !coreWritesEnabled)
    throw new Error('Search maintenance needs approved write enablement');
  return { origin, port, coreWritesEnabled, maintenanceEnabled };
}

/** Reuses native business handlers and the existing conversion allowlist behind a loopback-only HTTPS proxy. */
export function createHostedMongoHandler(db: Db, client: MongoClient, env: NodeJS.ProcessEnv) {
  const config = hostedMongoConfig(env),
    objects = createHostedPrivateObjectStore(env);
  const runtime = createMongoPhase5Runtime(db, client, env, {}, objects);
  const guarded = createMongoDevelopmentHandler(runtime, {
    coreWritesEnabled: config.coreWritesEnabled,
  });
  return (req: IncomingMessage, res: ServerResponse) => {
    if (
      !req.url?.startsWith('/') ||
      req.url.startsWith('//') ||
      req.headers.host?.toLowerCase() !== new URL(config.origin).host ||
      req.headers['x-forwarded-proto'] !== 'https'
    ) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(
        JSON.stringify({
          error: { code: 'INVALID_HOST', message: 'Use the configured HTTPS origin' },
        }),
      );
      return;
    }
    guarded(req, res);
  };
}
