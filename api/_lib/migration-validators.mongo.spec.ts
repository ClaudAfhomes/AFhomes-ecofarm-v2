import { expect, it } from 'vitest';
import { proposedMigrationCoreValidators } from './migration-validators.mongo.js';
import { mongoCoreValidators } from './core-validators.mongo.js';
import { createTestReplica } from './testing/mongo-replica.js';

it('preserves legacy unknown allocation pairs and rejects partial, fractional or inconsistent splits', async () => {
  const replica = await createTestReplica();
  try {
    const proposal = proposedMigrationCoreValidators(), existing = mongoCoreValidators();
    for (const name of Object.keys(existing).filter(name => name !== 'points_ledger')) expect(proposal[name]).toEqual(existing[name]);
    expect(existing.points_ledger!.$jsonSchema.properties.weekday_delta.bsonType).not.toContain('null');
    await replica.db.createCollection('points_ledger', { validator: proposal.points_ledger, validationAction: 'error', validationLevel: 'strict' });
    let n = 0;
    const insert = (split: object) => replica.db.collection<{ _id: string; [key: string]: unknown }>('points_ledger').insertOne({ _id: String(++n), account_id: 'synthetic', amount: 10, balance_after: 10, ...split });
    for (const split of [{}, { weekday_delta: null, weekend_delta: null }, { weekday_delta: 7, weekend_delta: 3 }, { weekday_delta: 12, weekend_delta: -2 }]) await insert(split);
    for (const split of [{ weekday_delta: null }, { weekday_delta: 7, weekend_delta: null }, { weekday_delta: 7, weekend_delta: 2 }, { weekday_delta: 7.5, weekend_delta: 2.5 }, { weekday_delta: '7', weekend_delta: 3 }]) await expect(insert(split)).rejects.toMatchObject({ code: 121 });
    expect(await replica.db.collection('points_ledger').countDocuments()).toBe(4);
  } finally { await replica.stop(); }
}, 15000);
