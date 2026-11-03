import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PROFILE_PHOTO_MAX_BYTES } from '@afhomes/contracts';
import { Long, type Db } from 'mongodb';
import type { SourceArchive } from './migration-source-archive.js';
import { reviewedBusinessMigrationTables } from './migration-reviewed-manifest.js';
import { decodeMigrationSourceRows } from './migration-source-decode.js';
import { planMigrationMapping, type MigrationRecord } from './migration-mapping.js';
import { reconcileMigrationMapping } from './migration-reconciliation.js';
import { planMigrationIdentities, type SourceMigrationIdentity, type MigrationIdentityBinding } from './migration-identity-plan.js';
import { migrationFingerprint } from './migration-fingerprint.js';
import { setupMongoPhase5 } from './mongo-runtime.js';
import { proposedMigrationCoreValidators } from './migration-validators.mongo.js';
import { planMigrationCounters } from './migration-counters.js';
import { planMigrationProfilePhotos, verifyMigrationProfilePhotoLinks } from './migration-profile-photos.js';
import { planMigrationFiles, copyMigrationFiles } from './migration-files.js';
import { LocalPrivateObjectStore } from './private-object-store.js';
import { ledgerId } from './customer-points.mongo.js';
import { planMigrationLedgerCounter } from './migration-ledger-counter.js';

async function rehearsePhotos(db: Db, archive: SourceArchive, identities: Parameters<typeof planMigrationProfilePhotos>[1], owner: Parameters<typeof planMigrationProfilePhotos>[2]) {
  const plan = planMigrationProfilePhotos(archive, identities, owner, []);
  if (!plan.ready) return { ready: false, copied: 0, protectedPhotosExcluded: plan.protectedPhotosExcluded };
  const root = await mkdtemp(path.join(tmpdir(), 'afhomes-native-photo-rehearsal-'));
  if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('afhomes-native-photo-rehearsal-')) throw new Error('Private rehearsal directory required');
  try {
    const store = new LocalPrivateObjectStore({ root, baseURL: 'http://127.0.0.1:3000', secret: randomBytes(32).toString('hex') });
    const filePlan = planMigrationFiles(plan.files, plan.mapping, PROFILE_PHOTO_MAX_BYTES);
    const copied = await copyMigrationFiles(plan.files, plan.mapping, PROFILE_PHOTO_MAX_BYTES, async (bucket, key) => {
      const matches = archive.files.filter(file => file.bucket === bucket && file.key === key);
      return matches.length === 1 ? { bytes: Buffer.from(matches[0]!.bytes, 'base64'), contentType: matches[0]!.contentType } : null;
    }, store, filePlan.manifestDigest);
    if (!copied.ready) return { ready: false, copied: 0, protectedPhotosExcluded: plan.protectedPhotosExcluded };
    const verified = await verifyMigrationProfilePhotoLinks(archive, identities, owner, [], plan.manifestDigest, store);
    if (!verified.ready) return { ready: false, copied: 0, protectedPhotosExcluded: plan.protectedPhotosExcluded };
    for (const row of verified.records) await db.collection<MigrationRecord>('profile_photos').insertOne(row);
    const after = await db.collection<MigrationRecord>('profile_photos').find().toArray();
    const replay = planMigrationProfilePhotos(archive, identities, owner, after);
    return { ready: replay.ready && replay.records.length === 0, copied: plan.files.length, protectedPhotosExcluded: plan.protectedPhotosExcluded };
  } finally { await rm(root, { recursive: true, force: true }); }
}

/** Source-only rehearsal in a fresh loopback namespace; never merges development business data. */
export async function rehearseNativeMigration(db: Db, archive: SourceArchive) {
  if (!/^afhomes_native_rehearsal_[a-f0-9]{32}$/.test(db.databaseName) ||
      !db.client.options.hosts.length || db.client.options.hosts.some(host => !['127.0.0.1', '::1'].includes(host.host ?? '')) ||
      (await db.listCollections().toArray()).length) throw new Error('New disposable loopback namespace required');
  const tables = reviewedBusinessMigrationTables();
  const decoded = decodeMigrationSourceRows(archive, { tables });
  if (!decoded.ready) return { ready: false, stage: 'decode', issues: decoded.issues };
  const source = decoded.source;
  const roles = source['public.roles']!.filter(row => row.slug === 'super_admin').map(row => row.id);
  const owners = source['public.staff_role_assignments']!.filter(row => roles.includes(row.role_id));
  if (owners.length !== 1) throw new Error('Unique source owner required');
  const owner = { sourceId: String(owners[0]!.staff_id), targetId: randomUUID() };
  const auth = archive.tables.find(table => table.name === 'auth.users')!.rows.map(raw => JSON.parse(raw) as SourceMigrationIdentity);
  const sourceOwner = auth.find(row => row.id === owner.sourceId);
  if (!sourceOwner) throw new Error('Source owner identity required');
  const bindings: MigrationIdentityBinding[] = [];
  for (const identity of auth) {
    const staff = source['public.staff_users']!.find(row => row.id === identity.id);
    const customer = source['public.customers']!.find(row => row.auth_user_id === identity.id);
    if (staff) bindings.push({ identityId: identity.id, email: String(staff.email), fullName: String(staff.full_name), kind: 'staff', mustChangePassword: staff.must_change_password === true });
    else if (customer) bindings.push({ identityId: identity.id, email: String(customer.email), fullName: [customer.first_name, customer.last_name].filter(Boolean).join(' '), kind: 'customer', mustChangePassword: null });
  }
  const ownerHeader = { id: owner.targetId, email: sourceOwner.email };
  const identityPlan = planMigrationIdentities(auth, bindings, [ownerHeader], owner);
  if (!identityPlan.ready) return { ready: false, stage: 'identities', issues: identityPlan.issues };
  const target: Record<string, MigrationRecord[]> = Object.fromEntries(tables.map(table => [table.target, []]));
  const protectedStaff: MigrationRecord = { _id: owner.targetId, email: sourceOwner.email, status: 'active', full_name: 'Synthetic protected owner', preserved_fixture: true };
  target.staff_users = [protectedStaff];
  const identities = {
    source: auth.map(row => ({ id: row.id, email: row.email })),
    target: [ownerHeader, ...identityPlan.users.map(row => ({ id: row._id, email: String(row.email) }))],
  };
  const manifest = { version: 1 as const, timestampPrecision: 'preserve-source' as const, protectedOwner: { table: 'public.staff_users', ...owner }, tables };
  const input = { source, target, identities };
  const plan = planMigrationMapping(manifest, input);
  if (!plan.ready) return { ready: false, stage: 'mapping', issues: plan.issues };
  const rawRows = (name: string) => archive.tables.find(table => table.name === name)!.rows.map(raw => JSON.parse(raw));
  const counterPlan = planMigrationCounters({
    company: rawRows('private.company_customer_id_counters').map(row => ({ issue_year: row.issue_year, last_issued: row.last_issued })),
    accreditation: rawRows('private.sale_team_aa_counters').map(row => ({ accreditation_month: row.accreditation_month, last_value: row.last_value })),
    target: [],
    issued: {
      company: source['public.customers']!.map(row => row.ra_number).filter((value): value is string => typeof value === 'string'),
      accreditation: ['private.sale_team_accreditations', 'private.sale_team_accreditation_history'].flatMap(name => source[name]!.flatMap(row => [row.aa_number, row.successor_aa_number]).filter((value): value is string => typeof value === 'string')),
      vip: [...source['public.customers']!, ...source['private.vip_card_number_issuances']!].map(row => row.vip_card_number).filter((value): value is string => typeof value === 'string'),
    },
  });
  if (!counterPlan.ready) return { ready: false, stage: 'counters', issues: counterPlan.issues };
  const ledgerCounter = planMigrationLedgerCounter(source['public.points_ledger']!.map(row => String(row.id)), target.points_ledger!.map(row => row._id), null);
  if (!ledgerCounter.ready) return { ready: false, stage: 'ledger-counter', issues: ledgerCounter.issues };
  await setupMongoPhase5(db);
  for (const table of tables) if (!(await db.listCollections({ name: table.target }).toArray()).length) await db.createCollection(table.target);
  for (const [name, validator] of Object.entries(proposedMigrationCoreValidators())) await db.command({ collMod: name, validator, validationLevel: 'strict', validationAction: 'error' });
  const protectedUser = { _id: owner.targetId, email: sourceOwner.email, name: 'Synthetic protected owner', emailVerified: true, createdAt: new Date(), updatedAt: new Date() };
  const protectedAccount = { _id: randomUUID(), userId: owner.targetId, accountId: owner.targetId, providerId: 'credential', password: 'synthetic-preserved-credential-no-login' };
  const beforeOwner = migrationFingerprint({ protectedStaff, protectedUser, protectedAccount });
  const session = db.client.startSession();
  let writingCollection = 'protected-owner';
  try {
    await session.withTransaction(async () => {
      await db.collection<MigrationRecord>('staff_users').insertOne(protectedStaff, { session });
      await db.collection<MigrationRecord>('auth_users').insertOne(protectedUser, { session });
      await db.collection<MigrationRecord>('auth_accounts').insertOne(protectedAccount, { session });
      for (const user of identityPlan.users) await db.collection<MigrationRecord>('auth_users').insertOne(user, { session });
      for (const account of identityPlan.accounts) {
        const password = identityPlan.credentials.get(String(account.userId));
        if (!password) throw new Error('Credential plan incomplete');
        await db.collection<MigrationRecord>('auth_accounts').insertOne({ ...account, password }, { session });
      }
      for (const [name, rows] of Object.entries(plan.records)) for (const row of rows) {
        writingCollection = name;
        await db.collection<MigrationRecord>(name).insertOne(row, { session });
      }
      for (const counter of counterPlan.changes) await db.collection<MigrationRecord>('counters').updateOne({ _id: counter._id }, { $max: { seq: counter.seq } }, { upsert: true, session });
      await db.collection<{ _id: string; seq: Long }>('counters').updateOne({ _id: 'points-ledger' }, { $max: { seq: Long.fromString(ledgerCounter.counter!.seq) } }, { upsert: true, session });
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 121) {
      const fields = new Set<string>();
      const collect = (value: unknown) => {
        if (!value || typeof value !== 'object') return;
        for (const [key, item] of Object.entries(value)) {
          if (key === 'propertyName' && typeof item === 'string' && /^[a-z_]+$/.test(item)) fields.add(item);
          if (key === 'missingProperties' && Array.isArray(item)) for (const field of item) if (typeof field === 'string' && /^[a-z_]+$/.test(field)) fields.add(field);
          if (['details', 'schemaRulesNotSatisfied', 'propertiesNotSatisfied', 'itemsNotSatisfied'].includes(key) || Array.isArray(value)) collect(item);
        }
      };
      if ('errInfo' in error) collect(error.errInfo);
      return { ready: false, stage: 'native-validation', issues: [{ table: writingCollection, code: 'NATIVE_VALIDATOR_REJECTED_SOURCE', fields: [...fields].sort() }] };
    }
    throw error;
  } finally { await session.endSession(); identityPlan.credentials.clear(); }
  const after: Record<string, MigrationRecord[]> = {};
  for (const table of tables) after[table.target] = await db.collection<MigrationRecord>(table.target).find().toArray();
  const reconciliation = reconcileMigrationMapping(manifest, input, after);
  const probeSession = db.client.startSession();
  let ledgerIdAvailable = false;
  const rollbackProbe = new Error('Rollback disposable allocator probe');
  try {
    await probeSession.withTransaction(async () => {
      const nextId = await ledgerId(db, probeSession);
      ledgerIdAvailable = !after.points_ledger!.some(row => row._id === nextId);
      throw rollbackProbe;
    });
  } catch (error) { if (error !== rollbackProbe) throw error; }
  finally { await probeSession.endSession(); }
  if (!ledgerIdAvailable) return { ready: false, stage: 'post-migration-ledger-allocation', issues: [{ code: 'NEXT_NATIVE_LEDGER_ID_COLLIDES' }] };
  const afterOwner = migrationFingerprint({
    protectedStaff: await db.collection<MigrationRecord>('staff_users').findOne({ _id: owner.targetId }),
    protectedUser: await db.collection<MigrationRecord>('auth_users').findOne({ _id: owner.targetId }),
    protectedAccount: await db.collection<MigrationRecord>('auth_accounts').findOne({ _id: protectedAccount._id }),
  });
  const photos = await rehearsePhotos(db, archive, identities, owner);
  return { ready: reconciliation.ready && beforeOwner === afterOwner && photos.ready, stage: 'reconciliation', issues: reconciliation.issues, definitions: tables.length, proposedCoreValidators: Object.keys(proposedMigrationCoreValidators()).length, productionValidatorChangeRequired: true, counterHighWaterMarks: counterPlan.changes.length + 1, nativeLedgerAppendVerified: ledgerIdAvailable, insertedBusinessRecords: Object.values(plan.records).reduce((sum, rows) => sum + rows.length, 0), insertedIdentities: identityPlan.users.length, protectedSyntheticOwnerUnchanged: beforeOwner === afterOwner, authenticationAcceptance: false, profilePhotoTransfer: photos, sharedDatabase: false, developmentBusinessDataMerged: false };
}
