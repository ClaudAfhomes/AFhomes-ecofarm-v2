import type { Db } from 'mongodb';
import { mongoCoreValidators, inspectMongoCoreValidators } from '../core-validators.mongo.js';

/** Disposable loopback fixtures only; not an operator/shared-database installer. */
export async function installTestCoreValidators(db: Db) {
  if (
    !db.client.options.hosts.length ||
    db.client.options.hosts.some((host) => host.host !== '127.0.0.1')
  )
    throw new Error('Validator fixture requires a disposable loopback server');
  const plan = await inspectMongoCoreValidators(db);
  if (!plan.readyForReview)
    throw new Error('Validator fixture requires compatible core collections');
  for (const [collection, validator] of Object.entries(mongoCoreValidators()))
    await db.command({
      collMod: collection,
      validator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
}
