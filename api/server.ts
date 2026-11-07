/** Hosted MongoDB API for a native Node/systemd service. Never starts Vite, initializes schema or bootstraps identities. */
import http from 'node:http';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { createMongoClient } from './_lib/mongodb.js';
import { hostedMongoConfig, createHostedMongoHandler } from './_lib/hosted-runtime.js';
import { inspectMongoCoreSetup } from './_lib/mongo-core-setup.js';
import { createMongoSearchMaintenance } from './_lib/search-maintenance.mongo.js';

let server: http.Server | undefined;
let client: ReturnType<typeof createMongoClient>['client'] | undefined;
let maintenance: ReturnType<typeof createMongoSearchMaintenance> | undefined;
let closing = false,
  stage = 'configuration';
async function close(code = 0) {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => {
    server?.closeAllConnections();
    process.exit(1);
  }, 60_000);
  deadline.unref();
  try {
    if (server?.listening)
      await new Promise<void>((resolve) => {
        server!.close(() => resolve());
        server!.closeIdleConnections();
      });
    await maintenance?.stop();
    await client?.close();
  } catch {
    code = 1;
  }
  clearTimeout(deadline);
  process.exit(code);
}
try {
  if (process.env.AFHOMES_SERVER_ENV_FILE) {
    if (!path.isAbsolute(process.env.AFHOMES_SERVER_ENV_FILE))
      throw new Error('Use an absolute server credential path');
    loadEnvFile(process.env.AFHOMES_SERVER_ENV_FILE);
  }
  const config = hostedMongoConfig(process.env),
    connection = createMongoClient(process.env);
  stage = 'database connection';
  client = connection.client;
  await client.connect();
  const db = client.db(connection.database);
  await db.command({ ping: 1 });
  stage = 'existing schema readiness';
  const readiness = await inspectMongoCoreSetup(db);
  if (
    !readiness.initialized ||
    readiness.missingRoles.length ||
    readiness.missingDepartments.length ||
    readiness.missingModules.length
  )
    throw new Error('Reviewed existing core setup is required');
  server = http.createServer(createHostedMongoHandler(db, client, process.env));
  server.requestTimeout = 60_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  stage = 'loopback listener';
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(config.port, '127.0.0.1', resolve);
  });
  server.on('error', () => {
    console.error('[mongodb] Hosted listener failed.');
    void close(1);
  });
  if (config.maintenanceEnabled) {
    stage = 'approved search maintenance';
    maintenance = createMongoSearchMaintenance(db, client);
    await maintenance.start();
  }
  process.once('SIGTERM', () => void close());
  process.once('SIGINT', () => void close());
  console.log(
    '[mongodb] Hosted API listening on loopback; existing native workflow gates remain active.',
  );
} catch {
  console.error(
    `[mongodb] Hosted startup failed at ${stage}. Check private configuration and reviewed readiness; credentials and raw errors are not logged.`,
  );
  await close(1);
}
