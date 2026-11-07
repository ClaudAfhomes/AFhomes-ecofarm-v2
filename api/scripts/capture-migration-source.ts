import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { backupChecksum } from '../_lib/local-mongo-backup.js';
import { checkKey } from '../_lib/private-object-store.js';
import {
  openSourceArchive,
  sealSourceArchive,
  verifySourceArchiveLocally,
  type SourceArchive,
} from '../_lib/migration-source-archive.js';
import { createTestReplica } from '../_lib/testing/mongo-replica.js';
import { decodeMigrationSourceRows } from '../_lib/migration-source-decode.js';
import { reviewedBusinessMigrationTables } from '../_lib/migration-reviewed-manifest.js';
import { reconcileSourceMembershipPoints } from '../_lib/migration-points-manifest.js';
import { reconcileSourceFinance } from '../_lib/migration-finance-manifest.js';
import { reconcileSourceForms } from '../_lib/migration-forms-manifest.js';
import { reviewSourceFileBindings } from '../_lib/migration-file-bindings.js';
import { reconcileSourceImports } from '../_lib/migration-imports.js';
import { reconcileSourceLegacyOst } from '../_lib/migration-legacy-ost.js';
import { reconcileSourceDocumentMetadata } from '../_lib/migration-documents.js';
import { rehearseMigratedDocuments } from '../_lib/migration-document-rehearsal.js';
import { reviewSourceAuditHistory } from '../_lib/migration-audit.js';
import { reconcileSourceRulesAndPolicies } from '../_lib/migration-rules-policy.js';
import { reviewMigrationSourceCoverage } from '../_lib/migration-source-coverage.js';
import { reviewNativeMigrationTarget } from '../_lib/migration-target-review.js';
import { createMongoClient } from '../_lib/mongodb.js';
import { rehearseNativeMigration } from '../_lib/migration-native-rehearsal.js';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const backupRoot = path.join(homedir(), '.afhomes', 'backups', 'afhomes_dev');
const project = 'ikaevepedpqygdlipsei';
const initializer = fileURLToPath(new URL('./Initialize-MongoLocalBackup.ps1', import.meta.url));
let stage = 'arguments';
let key: Buffer | undefined;
let client: pg.Client | undefined;

async function captureDatabase(): Promise<Omit<SourceArchive, 'capturedAt' | 'files'>> {
  const db = client!;
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    if (
      (await db.query("SELECT current_setting('transaction_read_only') AS value")).rows[0]
        ?.value !== 'on'
    )
      throw new Error();
    await db.query("SET LOCAL TIME ZONE 'UTC'");
    await db.query("SET LOCAL DateStyle TO 'ISO,YMD'");
    const tables = (
      await db.query(`SELECT n.nspname AS schema,c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind IN ('r','p') AND (n.nspname IN ('public','private') OR (n.nspname='auth' AND c.relname='users') OR (n.nspname='storage' AND c.relname IN ('objects','buckets'))) ORDER BY 1,2`)
    ).rows as { schema: string; name: string }[];
    const reviewed = JSON.parse(
      await readFile(
        path.join(repository, 'docs/mongodb/SOURCE-SCHEMA-INVENTORY-2026-10-30.json'),
        'utf8',
      ),
    );
    const names = tables.map((table) => `${table.schema}.${table.name}`);
    if (
      backupChecksum(Buffer.from(JSON.stringify(names))) !==
      backupChecksum(
        Buffer.from(
          JSON.stringify(
            reviewed.tables.map(
              (table: { schema: string; name: string }) => `${table.schema}.${table.name}`,
            ),
          ),
        ),
      )
    )
      throw new Error('Source table set changed');
    const allowed = new Set(names);
    const columns = (
      await db.query(`SELECT table_schema AS schema,table_name AS table,column_name AS name,ordinal_position AS position,data_type AS type,
      udt_schema,udt_name,is_nullable AS nullable,is_identity AS identity,is_generated AS generated,numeric_precision,numeric_scale
      FROM information_schema.columns WHERE table_schema IN ('public','private','auth','storage') ORDER BY 1,2,4`)
    ).rows.filter((row) => allowed.has(`${row.schema}.${row.table}`));
    const constraints = (
      await db.query(`SELECT n.nspname AS schema,t.relname AS table,c.conname AS name,c.contype AS kind,pg_get_constraintdef(c.oid,true) AS definition
      FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname IN ('public','private') ORDER BY 1,2,3`)
    ).rows;
    const indexes = (
      await db.query(`SELECT schemaname AS schema,tablename AS table,indexname AS name,indexdef AS definition FROM pg_indexes
      WHERE schemaname IN ('public','private') ORDER BY 1,2,3`)
    ).rows;
    const captured: SourceArchive['tables'] = [];
    let size = 0;
    for (const name of names) {
      if (!/^(public|private|auth|storage)\.[a-z][a-z0-9_]*$/.test(name)) throw new Error();
      // Only the approved credential/state projection; never capture sessions, recovery tokens or MFA secrets.
      const from =
        name === 'auth.users'
          ? `(SELECT id,email,encrypted_password,created_at,updated_at,email_confirmed_at,banned_until,deleted_at,is_anonymous,is_sso_user,
        ARRAY(SELECT jsonb_array_elements_text(coalesce(raw_app_meta_data->'providers','[]'::jsonb))) AS providers FROM auth.users)`
          : name;
      const rows = (await db.query(`SELECT row_to_json(t)::text AS payload FROM ${from} t`)).rows
        .map((row) => {
          if (typeof row.payload !== 'string') throw new Error();
          size += Buffer.byteLength(row.payload);
          if (size > 16 * 1024 * 1024) throw new Error('Source row limit exceeded');
          return row.payload as string;
        })
        .sort();
      captured.push({ name, rows });
    }
    return {
      version: 1,
      project,
      schema: { tables, columns, constraints, indexes },
      tables: captured,
    };
  } finally {
    await db.query('ROLLBACK');
  }
}

try {
  const [mode, filename, ...extra] = process.argv.slice(2);
  if (
    !['capture', 'verify', 'review', 'verify-documents', 'verify-native', 'review-target'].includes(mode ?? '') ||
    extra.length ||
    (mode === 'capture' && filename) ||
    (mode !== 'capture' &&
      (!filename || !/^supabase-source-[a-zA-Z0-9_-]+\.afsource$/.test(filename)))
  )
    throw new Error();
  stage = 'key-recovery';
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', initializer], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const secret = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-File', initializer, '-ExportKeyForProcess'],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  key = Buffer.from(secret.toString('utf8').trim(), 'base64');
  secret.fill(0);
  if (key.length !== 32) throw new Error();
  if (mode === 'review') {
    stage = 'source-free-typed-review';
    const encrypted = await readFile(path.join(backupRoot, filename!));
    const source = openSourceArchive(encrypted, key);
    const tables = reviewedBusinessMigrationTables();
    const decoded = decodeMigrationSourceRows(source, { tables });
    const points = decoded.ready ? reconcileSourceMembershipPoints(decoded.source) : null;
    const reservations = source.tables
      .find((table) => table.name === 'public.reservation_agreements')!
      .rows.map((raw) => {
        const row = JSON.parse(raw);
        if (
          typeof row.id !== 'string' ||
          typeof row.customer_id !== 'string' ||
          (row.sale_id !== null && typeof row.sale_id !== 'string')
        )
          throw new Error();
        return {
          id: row.id as string,
          customer_id: row.customer_id as string,
          sale_id: row.sale_id as string | null,
        };
      });
    const finance = decoded.ready ? reconcileSourceFinance(decoded.source, reservations) : null;
    const forms = decoded.ready ? reconcileSourceForms(decoded.source) : null;
    const imports = decoded.ready ? reconcileSourceImports(decoded.source) : null;
    const identityHeaders = source.tables
      .find((table) => table.name === 'auth.users')!
      .rows.map((raw) => {
        const row = JSON.parse(raw);
        if (typeof row.id !== 'string' || typeof row.email !== 'string') throw new Error();
        return { id: row.id as string, email: row.email as string };
      });
    const legacyOst = decoded.ready
      ? reconcileSourceLegacyOst(decoded.source, identityHeaders)
      : null;
    const documents = decoded.ready ? reconcileSourceDocumentMetadata(decoded.source) : null;
    const audit = decoded.ready ? reviewSourceAuditHistory(decoded.source, identityHeaders) : null;
    const rulesAndPolicies = decoded.ready ? reconcileSourceRulesAndPolicies(decoded.source) : null;
    const fileBindings = reviewSourceFileBindings(source);
    const reviewed = new Set(tables.map((table) => table.source));
    const coverage = reviewMigrationSourceCoverage(source);
    const report = {
      reviewedAt: new Date().toISOString(),
      snapshotCapturedAt: source.capturedAt,
      archiveSha256: backupChecksum(encrypted),
      sourceConnectionUsed: false,
      typedDecodeReady: decoded.ready,
      pointsSourceReconciliation: points,
      financeSourceReconciliation: finance,
      formsSourceReconciliation: forms,
      importsSourceReconciliation: imports,
      legacyOstSourceReconciliation: legacyOst,
      documentMetadataReconciliation: documents,
      auditHistoryReview: audit,
      rulesAndPolicyReconciliation: rulesAndPolicies,
      privateFileBindings: fileBindings,
      nativeImportReady: false,
      sourceCoverage: coverage,
      sourceImportJobStates: Object.fromEntries(
        source.tables
          .find((table) => table.name === 'public.customer_import_jobs')!
          .rows.map((raw) => JSON.parse(raw))
          .reduce(
            (counts: Map<string, number>, row: { status: string }) =>
              counts.set(row.status, (counts.get(row.status) ?? 0) + 1),
            new Map<string, number>(),
          ),
      ),
      reviewedTables: tables.length,
      reviewedRows: Object.values(decoded.source).reduce((count, rows) => count + rows.length, 0),
      issues: decoded.issues,
      remainingTables: source.tables
        .filter((table) => !reviewed.has(table.name))
        .map((table) => ({ name: table.name, rows: table.rows.length })),
    };
    await writeFile(
      path.join(repository, 'docs/mongodb/SOURCE-TYPED-REVIEW-2026-11-02.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(JSON.stringify(report));
    if (
      !decoded.ready ||
      !points?.ready ||
      !finance?.ready ||
      !forms?.ready ||
      !imports?.ready ||
      !legacyOst?.ready ||
      !documents?.ready ||
      !audit?.ready ||
      !rulesAndPolicies?.ready ||
      !coverage.allTablesAccountedFor ||
      !fileBindings.ready
    )
      process.exitCode = 1;
  } else if (mode === 'review-target') {
    stage = 'read-only-native-target-review';
    const source = openSourceArchive(await readFile(path.join(backupRoot, filename!)), key);
    const env = parseEnv(await readFile(path.join(repository, '.env.local'), 'utf8'));
    const mongo = createMongoClient(env);
    try {
      await mongo.client.connect();
      const result = await reviewNativeMigrationTarget(mongo.client.db(mongo.database), source);
      await writeFile(
        path.join(repository, 'docs/mongodb/NATIVE-MIGRATION-TARGET-REVIEW-2026-11-02.json'),
        JSON.stringify(result, null, 2) + '\n',
      );
      console.log(JSON.stringify(result));
      if (!result.identitiesReady || !result.mappingReady) process.exitCode = 1;
    } finally {
      await mongo.client.close();
    }
  } else if (mode === 'verify-native') {
    stage = 'archive-authentication';
    const encrypted = await readFile(path.join(backupRoot, filename!));
    const source = openSourceArchive(encrypted, key);
    stage = 'source-free-native-rehearsal';
    const replica = await createTestReplica({ timeoutMS: 15_000 });
    try {
      const result = await rehearseNativeMigration(replica.client.db('afhomes_native_rehearsal_' + randomUUID().replaceAll('-', '')), source);
      const report = { ...result, verifiedAt: new Date().toISOString(), archiveSha256: backupChecksum(encrypted), sourceConnectionUsed: false, atlasImport: false };
      await writeFile(path.join(repository, 'docs/mongodb/SOURCE-NATIVE-REHEARSAL-2026-11-02.json'), JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify(report));
      if (!result.ready) process.exitCode = 1;
    } finally { await replica.stop(); }
  } else if (mode === 'verify-documents') {
    stage = 'source-free-document-rehearsal';
    const encrypted = await readFile(path.join(backupRoot, filename!));
    const source = openSourceArchive(encrypted, key);
    const decoded = decodeMigrationSourceRows(source, {
      tables: reviewedBusinessMigrationTables(),
    });
    if (!decoded.ready) throw new Error();
    const replica = await createTestReplica();
    try {
      const result = await rehearseMigratedDocuments(
        replica.client.db('afhomes_document_rehearsal_' + randomUUID().replaceAll('-', '')),
        decoded.source,
        source.files,
      );
      const report = {
        ...result,
        verifiedAt: new Date().toISOString(),
        archiveSha256: backupChecksum(encrypted),
        sourceConnectionUsed: false,
        remainingPrivateFilesOutsideScope: source.files.length - result.copied,
        atlasImport: false,
      };
      await writeFile(
        path.join(repository, 'docs/mongodb/SOURCE-DOCUMENT-REHEARSAL-2026-11-02.json'),
        JSON.stringify(report, null, 2) + '\n',
      );
      console.log(JSON.stringify(report));
    } finally {
      await replica.stop();
    }
  } else if (mode === 'verify') {
    stage = 'archive-authentication';
    const encrypted = await readFile(path.join(backupRoot, filename!));
    const source = openSourceArchive(encrypted, key);
    stage = 'source-free-disposable-staging';
    const replica = await createTestReplica();
    try {
      const result = await verifySourceArchiveLocally(
        replica.client.db('afhomes_source_rehearsal_' + randomUUID().replaceAll('-', '')),
        source,
      );
      const report = {
        ...result,
        verifiedAt: new Date().toISOString(),
        file: filename,
        sha256: backupChecksum(encrypted),
        encrypted: true,
        credentialsPrinted: false,
        atlasImport: false,
        offDeviceCopy: false,
      };
      await writeFile(
        path.join(repository, 'docs/mongodb/SOURCE-CAPTURE-VERIFICATION-2026-10-31.json'),
        JSON.stringify(report, null, 2) + '\n',
      );
      console.log(JSON.stringify(report));
    } finally {
      await replica.stop();
    }
  } else {
    stage = 'source-configuration';
    const env = parseEnv(await readFile(path.join(repository, '.env.local'), 'utf8'));
    const url = new URL(env.AFHOMES_MIGRATION_SOURCE_DATABASE_URL ?? env.DATABASE_URL ?? '');
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !(
        url.hostname === `db.${project}.supabase.co` ||
        (url.hostname.endsWith('.pooler.supabase.com') &&
          decodeURIComponent(url.username) === `postgres.${project}`)
      )
    )
      throw new Error();
    for (const parameter of [...url.searchParams.keys()])
      if (parameter.startsWith('ssl')) url.searchParams.delete(parameter);
    const storageUrl = new URL(env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '');
    if (
      storageUrl.href !== `https://${project}.supabase.co/` ||
      !env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    )
      throw new Error();
    const storage = createClient(storageUrl.href, env.SUPABASE_SERVICE_ROLE_KEY.trim(), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: (input, init) => {
          const destination = new URL(input instanceof Request ? input.url : String(input));
          if (
            destination.origin !== storageUrl.origin ||
            !destination.pathname.startsWith('/storage/v1/object/') ||
            (init?.method ?? 'GET').toUpperCase() !== 'GET'
          )
            throw new Error('Only source object GET permitted');
          return fetch(input, {
            ...init,
            redirect: 'error',
            cache: 'no-store',
            signal: AbortSignal.timeout(30000),
          });
        },
      },
    });
    client = new pg.Client({
      connectionString: url.href,
      ssl: {
        rejectUnauthorized: true,
        ca: await readFile(path.join(repository, '.git/supabase-source-ca.crt'), 'utf8'),
      },
      connectionTimeoutMillis: 10000,
      statement_timeout: 30000,
    });
    stage = 'source-readonly-connection';
    await client.connect();
    const pass = async () => {
      const database = await captureDatabase();
      const buckets = new Map(
        database.tables
          .find((table) => table.name === 'storage.buckets')!
          .rows.map((raw) => {
            const row = JSON.parse(raw);
            return [row.id, row.public] as const;
          }),
      );
      const files: SourceArchive['files'] = [];
      let total = 0;
      for (const raw of database.tables.find((table) => table.name === 'storage.objects')!.rows) {
        const row = JSON.parse(raw);
        if (!buckets.has(row.bucket_id)) throw new Error();
        if (buckets.get(row.bucket_id)) continue;
        if (row.is_versioned === true || row.archived_at != null || row.is_delete_marker === true)
          throw new Error('Versioned object requires separate inventory');
        checkKey(row.name);
        if (
          !Number.isSafeInteger(row.metadata?.size) ||
          row.metadata.size < 0 ||
          row.metadata.size > 10 * 1024 * 1024
        )
          throw new Error('Object size limit');
        const result = await storage.storage
          .from(row.bucket_id)
          .download(row.name, { cacheNonce: randomUUID() });
        if (result.error || !result.data) throw new Error('Source download failed');
        const bytes = Buffer.from(await result.data.arrayBuffer());
        total += bytes.length;
        if (total > 16 * 1024 * 1024 || bytes.length !== row.metadata.size)
          throw new Error('Object integrity or batch size limit');
        files.push({
          bucket: row.bucket_id,
          key: row.name,
          version: row.version ?? null,
          contentType: result.data.type.toLowerCase().split(';')[0]!,
          size: bytes.length,
          sha256: backupChecksum(bytes),
          bytes: bytes.toString('base64'),
        });
      }
      return { ...database, files };
    };
    stage = 'source-capture-first-pass';
    const first = await pass();
    stage = 'source-capture-consistency-pass';
    const second = await pass();
    if (
      backupChecksum(Buffer.from(JSON.stringify(first))) !==
      backupChecksum(Buffer.from(JSON.stringify(second)))
    )
      throw new Error('Source changed during capture');
    stage = 'source-encryption';
    const source: SourceArchive = { ...first, capturedAt: new Date().toISOString() };
    const encrypted = sealSourceArchive(source, key);
    const name = `supabase-source-${new Date().toISOString().replace(/[^0-9]/g, '')}-${randomUUID().replaceAll('-', '')}.afsource`;
    await writeFile(path.join(backupRoot, name), encrypted, { flag: 'wx', mode: 0o600 });
    const stored = await readFile(path.join(backupRoot, name));
    if (backupChecksum(stored) !== backupChecksum(encrypted)) throw new Error();
    openSourceArchive(stored, key);
    const report = {
      capturedAt: source.capturedAt,
      file: name,
      backupRoot,
      encrypted: true,
      sha256: backupChecksum(stored),
      encryptedBytes: stored.length,
      tables: source.tables.length,
      rows: source.tables.reduce((sum, table) => sum + table.rows.length, 0),
      privateFiles: source.files.length,
      privateBytes: source.files.reduce((sum, file) => sum + file.size, 0),
      verifiedTLS: true,
      sourceReadOnly: true,
      captureMethod: 'two matching database/object passes; no enforced write freeze',
      authProjection: 'credential and provider/state only; no sessions, recovery tokens or MFA',
      nativeImport: false,
      credentialsPrinted: false,
      offDeviceCopy: false,
    };
    await writeFile(
      path.join(repository, 'docs/mongodb/SOURCE-CAPTURE-2026-10-31.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(JSON.stringify(report));
  }
} catch (error) {
  const databaseCode = error && typeof error === 'object' && 'code' in error && typeof error.code === 'number' ? error.code : undefined;
  console.error(
    JSON.stringify({ sourceCapture: false, stage, databaseCode, credentialsAndRawErrorsWithheld: true }),
  );
  process.exitCode = 1;
} finally {
  key?.fill(0);
  await client?.end();
}
