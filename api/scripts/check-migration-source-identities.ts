import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import pg from 'pg';

const project = 'ikaevepedpqygdlipsei';
let stage = 'configuration';
let client: pg.Client | undefined;
try {
  if (process.argv.length !== 2) throw new Error();
  const env = parseEnv(
    await readFile(fileURLToPath(new URL('../../.env.local', import.meta.url)), 'utf8'),
  );
  const value = env.AFHOMES_MIGRATION_SOURCE_DATABASE_URL ?? env.DATABASE_URL;
  const url = new URL(value ?? '');
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !(
      url.hostname === `db.${project}.supabase.co` ||
      (url.hostname.endsWith('.pooler.supabase.com') &&
        decodeURIComponent(url.username) === `postgres.${project}`)
    )
  )
    throw new Error();
  url.searchParams.delete('ssl');
  url.searchParams.delete('sslmode');
  client = new pg.Client({
    connectionString: url.href,
    ssl: {
      rejectUnauthorized: true,
      ca: await readFile(
        fileURLToPath(new URL('../../.git/supabase-source-ca.crt', import.meta.url)),
        'utf8',
      ),
    },
    connectionTimeoutMillis: 10000,
    statement_timeout: 15000,
  });
  stage = 'source-connection';
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const guard = (await client.query("SELECT current_setting('transaction_read_only') AS enabled"))
    .rows[0];
  if (guard.enabled !== 'on') throw new Error();
  stage = 'aggregate-identity-review';
  const state = (
    await client.query(
      `SELECT count(*)::int AS identities,
    count(*) FILTER (WHERE email IS NULL OR btrim(email)='')::int AS missing_email,
    count(*) FILTER (WHERE email_confirmed_at IS NULL)::int AS unconfirmed,
    count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS deleted,
    count(*) FILTER (WHERE banned_until IS NOT NULL)::int AS ban_state_requires_review,
    count(*) FILTER (WHERE is_anonymous)::int AS anonymous,
    count(*) FILTER (WHERE is_sso_user)::int AS sso,
    count(*) FILTER (WHERE raw_app_meta_data->>'provider' IS DISTINCT FROM 'email'
      OR raw_app_meta_data->'providers' IS DISTINCT FROM '["email"]'::jsonb)::int AS non_email_provider,
    count(*) FILTER (WHERE encrypted_password IS NULL OR encrypted_password !~ $1)::int AS unsupported_password
    FROM auth.users`,
      ['^\\$2[aby]\\$(0[4-9]|1[0-4])\\$[./A-Za-z0-9]{53}$'],
    )
  ).rows[0];
  const costs = (
    await client.query(
      `SELECT substring(encrypted_password from 5 for 2) AS cost, count(*)::int AS identities
    FROM auth.users WHERE encrypted_password ~ $1 GROUP BY 1 ORDER BY 1`,
      ['^\\$2[aby]\\$[0-9]{2}\\$'],
    )
  ).rows;
  const bindings = (
    await client.query(`WITH bindings AS (
      SELECT id AS identity_id,email FROM public.staff_users
      UNION ALL SELECT auth_user_id,email FROM public.customers WHERE auth_user_id IS NOT NULL
    ) SELECT
      (SELECT count(*)::int FROM auth.users u LEFT JOIN bindings b ON b.identity_id=u.id WHERE b.identity_id IS NULL) AS unbound,
      (SELECT count(*)::int FROM bindings b LEFT JOIN auth.users u ON u.id=b.identity_id WHERE u.id IS NULL) AS missing_auth,
      (SELECT count(*)::int FROM bindings b JOIN auth.users u ON u.id=b.identity_id WHERE lower(btrim(coalesce(b.email,'')))<>lower(btrim(coalesce(u.email,'')))) AS email_mismatches,
      (SELECT count(*)::int FROM (SELECT identity_id FROM bindings GROUP BY identity_id HAVING count(*)>1) x) AS multiple_principals,
      (SELECT count(*)::int FROM (SELECT lower(btrim(email)) FROM auth.users GROUP BY 1 HAVING count(*)>1) x) AS duplicate_emails`)
  ).rows[0];
  await client.query('ROLLBACK');
  const report = {
    capturedAt: new Date().toISOString(),
    sourceProject: project,
    readOnly: true,
    verifiedTLS: true,
    state,
    bcryptCosts: costs,
    bindings,
    credentialsExported: false,
    sourceRecordsModified: false,
    authenticationAcceptance: false,
  };
  await writeFile(
    fileURLToPath(
      new URL('../../docs/mongodb/SOURCE-IDENTITY-STATE-REVIEW-2026-10-31.json', import.meta.url),
    ),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report));
} catch (error) {
  console.error(
    JSON.stringify({
      sourceIdentityReview: false,
      stage,
      serverCode:
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
              .replace(/[^A-Z0-9]/g, '')
              .slice(0, 12)
          : null,
      credentialsAndRawErrorsWithheld: true,
    }),
  );
  process.exitCode = 1;
} finally {
  await client?.end();
}
