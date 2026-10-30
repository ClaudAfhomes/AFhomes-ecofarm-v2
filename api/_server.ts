/**
 * Standalone production API for the approved MongoDB deployment.
 *
 * Start with `node server.js` (the bundled artifact) or, from a checkout:
 * `NODE_ENV=production ... pnpm --filter api start`.
 *
 * This entrypoint:
 * - never starts Vite, Supabase, seeds, migrations, or index preparation;
 * - validates the production environment before binding a socket;
 * - binds loopback only (Nginx terminates TLS);
 * - serves the existing `/api/v1/**` Mongo runtime unchanged;
 * - exposes internal `/health` and `/ready` probes;
 * - shuts down on SIGTERM/SIGINT without dropping in-flight work abruptly.
 */
import { createMongoClient } from './_lib/mongodb.js';
import { createMongoPhase5Runtime } from './_lib/mongo-runtime.js';
import { createS3PrivateObjectStore } from './_lib/private-object-store.js';
import { createMongoSearchMaintenance } from './_lib/search-maintenance.mongo.js';
import {
  describeProductionConfig,
  loadProductionConfig,
  type ProductionConfig,
} from './_lib/production-config.js';
import {
  createProductionServer,
  resolveClientIp,
  type MaintenanceWorker,
} from './_lib/production-server.js';

function safeFailure(stage: string, error: unknown): string {
  const suffix =
    stage === 'configuration' && error instanceof Error && error.message
      ? ` ${error.message}.`
      : ' Check the environment file and approved database access.';
  return `[api] startup failed during ${stage}.${suffix}`;
}

async function main(): Promise<void> {
  let stage = 'configuration';
  let config: ProductionConfig | undefined;
  let client: ReturnType<typeof createMongoClient>['client'] | undefined;
  let maintenance: MaintenanceWorker | undefined;
  let production: ReturnType<typeof createProductionServer> | undefined;
  let shuttingDown = false;

  const shutdown = async (reason: string, exitCode: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    const hardExit = setTimeout(() => process.exit(exitCode), 30_000);
    hardExit.unref();
    try {
      const result = await production?.shutdown();
      if (result?.forced) console.warn('[api] shutdown completed with forced connection close');
    } catch {
      console.error('[api] shutdown did not complete cleanly');
    }
    await maintenance?.stop().catch(() => {});
    await client?.close().catch(() => {});
    console.log(`[api] stopped (${reason})`);
    process.exit(exitCode);
  };

  try {
    config = loadProductionConfig(process.env);
    stage = 'database';
    const connection = createMongoClient(process.env);
    client = connection.client;
    // Never print topology or driver errors: they can contain hostnames.
    client.on('error', () => console.error('[api] database connection error'));
    await client.connect();
    const db = client.db(connection.database);
    await db.command({ ping: 1 });

    stage = 'storage';
    // `undefined` means private-file routes fail closed; `local` is rejected by
    // configuration, so a development store can never be selected here.
    const objects = createS3PrivateObjectStore(process.env);

    stage = 'runtime';
    const runtime = createMongoPhase5Runtime(
      db,
      client,
      process.env,
      {},
      objects ?? null,
      { clientIp: (req) => resolveClientIp(req, config!.trustProxy) },
    );

    stage = 'maintenance';
    if (config.enableSearchMaintenance) {
      const worker = createMongoSearchMaintenance(db, client);
      maintenance = {
        start: () => worker.start(),
        stop: () => worker.stop(),
      };
    }

    stage = 'listener';
    production = createProductionServer({
      host: config.host,
      port: config.port,
      requestTimeoutMs: config.requestTimeoutMs,
      shutdownGraceMs: config.shutdownGraceMs,
      maxRequestBytes: config.maxRequestBytes,
      trustProxy: config.trustProxy,
      runtime,
      readiness: async () => {
        await db.command({ ping: 1 });
      },
      maintenance,
    });
    await production.start();

    process.once('SIGTERM', () => void shutdown('SIGTERM', 0));
    process.once('SIGINT', () => void shutdown('SIGINT', 0));
    process.once('uncaughtException', () => void shutdown('uncaughtException', 1));
    process.once('unhandledRejection', () => void shutdown('unhandledRejection', 1));

    const summary = describeProductionConfig(config);
    console.log(
      `[api] listening on http://${summary.host}:${summary.port} ` +
        `(db=${summary.database}, storage=${summary.storage}, ` +
        `searchMaintenance=${summary.searchMaintenance ? 'on' : 'off'}` +
        `${summary.release ? `, release=${summary.release}` : ''})`,
    );
    console.log('[api] health=/health readiness=/ready routes=/api/v1/**');
  } catch (error) {
    console.error(safeFailure(stage, error));
    await maintenance?.stop().catch(() => {});
    await client?.close().catch(() => {});
    process.exit(1);
  }
}

void main();
