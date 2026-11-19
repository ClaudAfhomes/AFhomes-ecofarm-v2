import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { BSON, type ClientSession, type Db, type Document, type MongoClient } from 'mongodb';
import { restoreLocalBackup, type LocalBackupSnapshot } from './local-mongo-backup.js';

/**
 * One-time business-data reset for afhomes_dev. Organization (staff, departments, roles,
 * permissions, verification settings), staff sign-ins, configuration and system metadata stay.
 * Collections are emptied with deleteMany only, so definitions, indexes and validators remain.
 */
export const RESET_RULES_VERSION = 'business-data-reset-v1';
export const RESET_DATABASE = 'afhomes_dev';
// shortcut: one transaction for the whole reset; switch to batched, resumable deletes if a plan exceeds this.
export const RESET_MAX_DELETES = 50_000;

export type ResetRule = 'preserve' | 'review' | 'delete' | 'identity';
const group = (rule: ResetRule, names: string) =>
  names
    .split(/\s+/)
    .filter(Boolean)
    .map((name) => [name, rule] as const);

/** Every known collection. Anything else blocks the reset until it is classified here. */
export const RESET_RULES: ReadonlyMap<string, ResetRule> = new Map([
  // Organization module and what it needs to work (cleanup lease backs Verification Settings).
  ...group(
    'preserve',
    `staff_users departments roles role_permissions staff_role_assignments
     staff_permission_restrictions modules mfa_policy public_verification_settings
     background_jobs staff_invitations`,
  ),
  // System metadata, identifier counters and catalog configuration.
  ...group(
    'preserve',
    `counters admin_bootstrap mongo_conversion_setup auth_rate_limits card_categories card_plans
     tier_points_config commission_rules service_catalog service_tier_discounts`,
  ),
  // Disabled CMS, preserved on purpose by owner decision.
  ...group(
    'preserve',
    `cms_documents cms_document_versions cms_media_assets cms_page_sections cms_page_versions
     cms_pages public_media_assets`,
  ),
  // Left untouched pending an owner decision: append-only audit, permanent identifier ledgers,
  // and IST/OST seller records (sellers are staff_users rows shown in Organization > Staff).
  ...group(
    'review',
    `audit_events vip_card_number_issuances business_id_aliases mutation_requests
     storage_cleanup_jobs auth_verifications synthetic validator_test_audit recovery_fidelity
     ost_members ost_accreditation_terms ost_accreditation_renewals ost_ist_conversions
     ost_team_transfers ost_applications ost_registration_details ost_applicant_changes
     network_member_profiles sale_team_accreditations sale_team_accreditation_history
     referral_relationships referral_codes legacy_referral_codes identity_documents profile_photos`,
  ),
  // Business records.
  ...group(
    'delete',
    `customers memberships customer_onboarding_tokens customer_applications
     customer_application_holders customer_application_purchase_terms reservation_agreements
     reservation_agreement_holders reservation_agreement_schedule card_sales
     card_sale_hierarchy_snapshots purchases payments purchase_document_evidence commissions
     final_qualifications earning_claims points_accounts points_ledger points_periods
     redemption_items redemption_quotes redemptions service_refunds service_refund_repayments
     sale_team_search_attempts sale_team_search_contacts sale_team_search_disclosures
     customer_import_jobs customer_import_payment_claims customer_import_purchase_sources
     customer_import_rows customer_import_source_rows customer_external_import_receipts
     customer_import_commission_policies customer_import_points_baselines source_private_files`,
  ),
  // Shared sign-in collections, decided per record by the owning Better Auth user id.
  ...group(
    'identity',
    'auth_users auth_accounts auth_sessions auth_two_factors auth_session_assurance',
  ),
]);
const OWNER_FIELD: Record<string, string> = {
  auth_users: '_id',
  auth_accounts: 'userId',
  auth_sessions: 'userId',
  auth_two_factors: 'userId',
  auth_session_assurance: 'user_id',
};

export type ResetPlanRow = {
  name: string;
  rule: ResetRule | 'unknown';
  total: number;
  delete: number;
  preserve: number;
  blocked?: string;
};
export type ResetPlan = {
  database: string;
  rulesVersion: string;
  ready: boolean;
  blockers: string[];
  totals: { delete: number; preserve: number };
  fingerprint: string;
  collections: ResetPlanRow[];
};

/** Refusals carry only text written here: no records, credentials or raw driver errors. */
export class ResetRefused extends Error {}
const refuse = (message: string): never => {
  throw new ResetRefused(message);
};

const idKey = (id: unknown) => BSON.EJSON.stringify(id as Document, { relaxed: false });
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function listMetadata(db: Db) {
  return (await db.listCollections({}, { nameOnly: false }).toArray()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

/** Collection options plus index definitions, compared before and after the reset. */
async function schemaState(db: Db) {
  const meta = await listMetadata(db);
  const state: Record<string, unknown> = {};
  for (const entry of meta)
    state[entry.name] = {
      type: entry.type,
      options: entry.options ?? {},
      indexes:
        entry.type === 'collection'
          ? (await db.collection(entry.name).listIndexes().toArray()).sort((a, b) =>
              String(a.name).localeCompare(String(b.name)),
            )
          : [],
    };
  return { meta, hash: digest(BSON.EJSON.serialize(state)) };
}

async function inspect(db: Db, meta: Document[], session?: ClientSession) {
  const read = (name: string, projection: Document = { _id: 1 }) =>
    db.collection(name).find({}, { session, projection }).toArray();
  // Staff identities: staff_users rows (IST/OST sellers included) and pending staff invitations.
  const staff = new Set<string>();
  for (const row of await read('staff_users', { _id: 1, auth_user_id: 1 })) {
    staff.add(String(row._id));
    if (typeof row.auth_user_id === 'string') staff.add(row.auth_user_id);
  }
  for (const row of await read('staff_invitations', { auth_user_id: 1 }))
    if (typeof row.auth_user_id === 'string') staff.add(row.auth_user_id);
  const customerOwners = new Set<string>();
  for (const row of await read('customers', { auth_user_id: 1 }))
    if (typeof row.auth_user_id === 'string') customerOwners.add(row.auth_user_id);

  const rows: ResetPlanRow[] = [],
    blockers: string[] = [],
    ids = new Map<string, string[]>(),
    deletes = new Map<string, unknown[]>(),
    hashed: unknown[] = [];
  for (const entry of meta) {
    const name = String(entry.name);
    const rule = entry.type === 'collection' ? RESET_RULES.get(name) : undefined;
    const owner = OWNER_FIELD[name];
    const docs =
      entry.type === 'collection'
        ? await read(name, owner && owner !== '_id' ? { _id: 1, [owner]: 1 } : { _id: 1 })
        : [];
    const remove: unknown[] = [];
    let blocked: string | undefined;
    if (!rule)
      blocked = entry.type === 'collection' ? 'not classified' : `unsupported ${entry.type}`;
    if (rule === 'delete') remove.push(...docs.map((row) => row._id));
    if (rule === 'identity') {
      let unowned = 0;
      for (const row of docs) {
        const user = String(owner === '_id' ? row._id : row[owner!]);
        // A staff identity always stays, even when that staff member also owns a customer.
        if (staff.has(user)) continue;
        if (customerOwners.has(user)) remove.push(row._id);
        else unowned++;
      }
      if (unowned) blocked = `${unowned} record(s) not linked to a staff user or customer`;
    }
    if (blocked) blockers.push(`${name}: ${blocked}`);
    const keys = docs.map((row) => idKey(row._id)).sort();
    ids.set(name, keys);
    deletes.set(name, remove);
    rows.push({
      name,
      rule: rule ?? 'unknown',
      total: docs.length,
      delete: remove.length,
      preserve: docs.length - remove.length,
      ...(blocked ? { blocked } : {}),
    });
    hashed.push({
      name,
      rule: rule ?? 'unknown',
      ids: digest(keys),
      remove: digest(remove.map(idKey).sort()),
    });
  }
  const totals = {
    delete: rows.reduce((sum, row) => sum + row.delete, 0),
    preserve: rows.reduce((sum, row) => sum + row.preserve, 0),
  };
  if (totals.delete > RESET_MAX_DELETES)
    blockers.push(`plan deletes ${totals.delete} records; limit is ${RESET_MAX_DELETES}`);
  const plan: ResetPlan = {
    database: db.databaseName,
    rulesVersion: RESET_RULES_VERSION,
    ready: blockers.length === 0,
    blockers,
    totals,
    fingerprint: digest({ rulesVersion: RESET_RULES_VERSION, database: db.databaseName, hashed }),
    collections: rows,
  };
  return { plan, ids, deletes };
}

/** Read-only inventory. The fingerprint changes on any insert or delete in any collection. */
export async function planBusinessDataReset(db: Db) {
  if (db.databaseName !== RESET_DATABASE) refuse('Reset target must be afhomes_dev.');
  const session = db.client.startSession({ defaultTimeoutMS: 120_000 });
  try {
    let plan: ResetPlan | undefined;
    const meta = await listMetadata(db);
    // Snapshot read inside a read-only transaction so counts and the fingerprint agree.
    await session.withTransaction(
      async () => {
        plan = (await inspect(db, meta, session)).plan;
      },
      { readConcern: { level: 'snapshot' } },
    );
    return plan!;
  } finally {
    await session.endSession();
  }
}

export function snapshotIds(snapshot: LocalBackupSnapshot) {
  return new Map(
    snapshot.collections.map((collection) => [
      collection.name,
      collection.documents
        .map((document) => idKey(BSON.deserialize(Buffer.from(document, 'base64'))._id))
        .sort(),
    ]),
  );
}
function sameIds(left: Map<string, string[]>, right: Map<string, string[]>) {
  if (left.size !== right.size) return false;
  for (const [name, keys] of left) {
    const other = right.get(name);
    if (!other || other.length !== keys.length || other.some((key, at) => key !== keys[at]))
      return false;
  }
  return true;
}

/** Restores the backup into a new afhomes_restore_* namespace; loopback clients only. */
export async function verifyBackupRestorable(
  snapshot: LocalBackupSnapshot,
  client: MongoClient,
  scratchParent: string,
) {
  await mkdir(scratchParent, { recursive: true });
  const scratch = await mkdtemp(path.join(scratchParent, 'reset-verify-'));
  const db = client.db('afhomes_restore_' + randomUUID().replaceAll('-', ''));
  try {
    return await restoreLocalBackup(db, scratch, snapshot);
  } finally {
    await db.dropDatabase().catch(() => undefined);
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * Deletes exactly the reviewed plan in one transaction. Refuses unless the target is confirmed,
 * the live state still produces the reviewed fingerprint, and the backup holds every current
 * record id in every collection.
 */
export async function applyBusinessDataReset(
  db: Db,
  input: { fingerprint: string; confirmTarget: string; backup: LocalBackupSnapshot },
) {
  if (db.databaseName !== RESET_DATABASE || input.confirmTarget !== RESET_DATABASE)
    refuse('Reset target must be afhomes_dev and confirmed exactly.');
  if (!/^[a-f0-9]{64}$/.test(input.fingerprint)) refuse('Fingerprint must be 64 hex characters.');
  const backupIds = snapshotIds(input.backup);
  const before = await schemaState(db);
  const session = db.client.startSession({ defaultTimeoutMS: 120_000 });
  let plan: ResetPlan | undefined;
  try {
    await session.withTransaction(
      async () => {
        const current = await inspect(db, before.meta, session);
        if (current.plan.blockers.length)
          refuse(`Plan is blocked: ${current.plan.blockers.join('; ')}`);
        if (current.plan.fingerprint !== input.fingerprint)
          refuse('Database differs from the reviewed plan. Run --plan again.');
        if (!sameIds(backupIds, current.ids))
          refuse('Backup does not match the current database. Capture a new backup.');
        for (const [name, remove] of current.deletes) {
          if (!remove.length) continue;
          const result = await db
            .collection(name)
            .deleteMany({ _id: { $in: remove } } as Document, { session });
          if (result.deletedCount !== remove.length)
            refuse(`Delete count mismatch in ${name}; nothing was deleted.`);
        }
        plan = current.plan;
      },
      { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
    );
  } finally {
    await session.endSession();
  }
  const after = await schemaState(db);
  const remaining = (await inspect(db, after.meta)).plan.collections;
  const countsMatch = plan!.collections.every(
    (row) => remaining.find((entry) => entry.name === row.name)?.total === row.preserve,
  );
  return {
    applied: true,
    database: db.databaseName,
    fingerprint: plan!.fingerprint,
    deleted: plan!.totals.delete,
    preserved: plan!.totals.preserve,
    schemaUnchanged: after.hash === before.hash,
    countsMatch,
    collections: plan!.collections.map(({ name, rule, delete: removed, preserve }) => ({
      name,
      rule,
      deleted: removed,
      remaining: remaining.find((entry) => entry.name === name)?.total ?? 0,
      preserve,
    })),
  };
}
