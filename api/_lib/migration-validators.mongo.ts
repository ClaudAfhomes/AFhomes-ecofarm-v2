import { mongoCoreValidators } from './core-validators.mongo.js';

/** Unapplied cutover proposal: preserve source legacy unknown allocations, never invent a split. */
export function proposedMigrationCoreValidators() {
  const validators = mongoCoreValidators();
  const ledger = structuredClone(validators.points_ledger!);
  for (const field of ['weekday_delta', 'weekend_delta'])
    ledger.$jsonSchema.properties[field].bsonType = ['int', 'long', 'double', 'null'];
  validators.points_ledger = {
    $and: [ledger, {
      $or: [
        { weekday_delta: { $exists: false }, weekend_delta: { $exists: false } },
        { weekday_delta: { $type: 'null' }, weekend_delta: { $type: 'null' } },
        { weekday_delta: { $type: 'number' }, weekend_delta: { $type: 'number' }, $expr: { $eq: [{ $add: ['$weekday_delta', '$weekend_delta'] }, '$amount'] } },
      ],
    }],
  };
  return validators;
}
