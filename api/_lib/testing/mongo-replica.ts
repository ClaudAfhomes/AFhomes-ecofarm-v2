import { createRequire } from 'node:module';
import { MongoClient } from 'mongodb';

/** New loopback replica set per run; never loads environment or existing data. */
export async function createTestReplica(options: { timeoutMS?: number } = {}) {
  const require = createRequire(
    new URL('../../../packages/db-testing/package.json', import.meta.url),
  );
  const { MongoMemoryReplSet } = require('mongodb-memory-server') as {
    MongoMemoryReplSet: {
      create(options: object): Promise<{ getUri(): string; stop(): Promise<unknown> }>;
    };
  };
  const replica = await MongoMemoryReplSet.create({
    binary: { version: '8.0.0' },
    replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' },
  });
  const client = new MongoClient(replica.getUri(), { serverSelectionTimeoutMS: 15_000, ...options });
  try {
    await client.connect();
    const hello = await client.db('admin').command({ hello: 1 });
    if (!hello.setName) throw new Error('Disposable test server must be a replica set');
    return {
      client,
      db: client.db('afhomes_dev'),
      async stop() {
        await client.close();
        await replica.stop();
      },
    };
  } catch (error) {
    await client.close();
    await replica.stop();
    throw error;
  }
}
