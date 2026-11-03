import { MongoClient, type Db } from 'mongodb';
import { mongoRuntimeDatabase } from './mongodb-scope.js';

export function createMongoClient(env: NodeJS.ProcessEnv = process.env) {
  const uri = env.MONGODB_URI?.trim();
  const database = env.MONGODB_DB?.trim();
  if (!uri || !/^mongodb(?:\+srv)?:\/\//.test(uri)) {
    throw new Error('MONGODB_URI must be configured in the server environment.');
  }
  if (database !== mongoRuntimeDatabase(env)) {
    throw new Error('MONGODB_DB must match the explicitly selected runtime scope.');
  }
  return {
    client: new MongoClient(uri, {
      appName: 'afhomes-mongodb-phase1',
      serverSelectionTimeoutMS: 10_000,
      connectTimeoutMS: 10_000,
      timeoutMS: 15_000,
    }),
    database,
  };
}

export async function pingMongoDB(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const { client, database } = createMongoClient(env);
  try {
    await client.connect();
    const result = await client.db(database).command({ ping: 1 });
    if (result.ok !== 1) throw new Error('MongoDB ping did not succeed.');
  } finally {
    await client.close();
  }
}

/** Cached MongoDB client for server-side operations. */
let mongoClientCached: { client: MongoClient; db: Db } | null = null;
let mongoClientKey = '';

/** Get or create a cached MongoDB client and database connection. */
export async function getMongoClient(env: NodeJS.ProcessEnv = process.env): Promise<{ client: MongoClient; db: Db }> {
  const uri = env.MONGODB_URI?.trim();
  const database = env.MONGODB_DB?.trim();
  if (!uri || !/^mongodb(?:\+srv)?:\/\//.test(uri)) {
    throw new Error('MONGODB_URI must be configured in the server environment.');
  }
  if (database !== mongoRuntimeDatabase(env)) {
    throw new Error('MONGODB_DB must match the explicitly selected runtime scope.');
  }
  const key = uri + database;
  if (mongoClientCached && mongoClientKey === key) {
    return mongoClientCached;
  }
  const client = new MongoClient(uri, {
    appName: 'afhomes-mongodb',
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    timeoutMS: 15_000,
  });
  await client.connect();
  const db = client.db(database);
  mongoClientCached = { client, db };
  mongoClientKey = key;
  return { client, db };
}

/** Close the cached MongoDB client. */
export async function closeMongoClient(): Promise<void> {
  if (mongoClientCached) {
    await mongoClientCached.client.close().catch(() => {});
    mongoClientCached = null;
    mongoClientKey = '';
  }
}
