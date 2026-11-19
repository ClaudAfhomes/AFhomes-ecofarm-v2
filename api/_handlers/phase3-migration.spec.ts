/**
 * Structural tripwires for the Phase 3 customer-portal migration.
 *
 * These are TEXT assertions and they are NOT sufficient - a schema that compiles
 * is not a schema that works. The live proof is `pnpm test:db:local`, which
 * executes every statement against a real PostgreSQL. What these tests buy is
 * fast feedback on the things that are easy to break by editing SQL casually:
 * a dropped `for update`, a missing `security definer`, a removed column revoke,
 * a `select` grant that crept back in.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MIGRATION = fileURLToPath(
  new URL('../../supabase/migrations/20260927000005_afhomes_phase3_customer_portal.sql', import.meta.url),
);
const sql = readFileSync(MIGRATION, 'utf8');

/** Everything from `function public.<name>(` through its closing `$$` - signature,
 *  security attributes and body. Comments stripped so prose cannot satisfy a
 *  structural assertion. */
function functionBody(name: string): string {
  const start = sql.indexOf(`function public.${name}(`);
  expect(start, `${name} is missing`).toBeGreaterThan(-1);
  const bodyStart = sql.indexOf('$$', start);
  const bodyEnd = sql.indexOf('$$', bodyStart + 2);
  expect(bodyEnd, `${name} has no closing $$`).toBeGreaterThan(bodyStart);
  return stripComments(sql.slice(start, bodyEnd));
}

/** The `-- ===` header comment block at the top of the file. */
const header = sql.slice(0, sql.indexOf('create or replace'));

/** The file with every `--` comment line removed. */
const code = stripComments(sql);

function stripComments(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.trimStart().startsWith('--') ? '' : line))
    .join('\n');
}

describe('phase 3 migration: file discipline', () => {
  it('is prefixed afhomes_ and numbered after phase 2', () => {
    expect(MIGRATION).toContain('20260927000005_afhomes_phase3_customer_portal.sql');
  });

  it('states its validation queries and a down note, per migration discipline', () => {
    expect(header).toMatch(/validation before apply/i);
    expect(header).toMatch(/select[\s\S]*government_id_number/i);
    expect(header).toMatch(/^-- down:/im);
  });
});

describe('claim_customer_onboarding_token', () => {
  const body = functionBody('claim_customer_onboarding_token');

  it('is security definer with a pinned search_path', () => {
    expect(body).toMatch(/security definer/i);
    expect(body).toMatch(/set search_path = public, private, pg_temp/i);
  });

  it('locks the token row, so two concurrent redemptions cannot both win', () => {
    // Regression guard: without `for update` the compare-and-set on consumed_at
    // is a read-then-write race and a token could be consumed twice.
    expect(body).toMatch(/from public\.customer_onboarding_tokens t[\s\S]*?for update;/i);
  });

  it('locks the customer row too, so two Auth users cannot be linked', () => {
    expect(body).toMatch(/from public\.customers c where c\.id = v_token\.customer_id for update;/i);
  });

  it('refuses on every precondition, each with an explicit errcode', () => {
    for (const reason of [
      'TOKEN_NOT_FOUND',
      'TOKEN_WRONG_PURPOSE',
      'TOKEN_ALREADY_CONSUMED',
      'TOKEN_EXPIRED',
      'CUSTOMER_NOT_ACTIVE',
      'CUSTOMER_HAS_NO_ACTIVE_MEMBERSHIP',
      'CUSTOMER_ALREADY_CLAIMED',
    ]) {
      // The raised text may carry a detail suffix (`'X:%', value`); the reason
      // itself must always be the leading token so the handler can map it.
      expect(body, reason).toMatch(new RegExp(`raise exception '${reason}(:%|')`, 'i'));
    }
    expect(body).toMatch(/if p_auth_user_id is null then[\s\S]*?raise exception 'ACTOR_REQUIRED'/i);
  });

  it('requires the purpose to match, so a password_reset token cannot activate', () => {
    expect(body).toMatch(/if v_token\.purpose <> p_purpose then/i);
  });

  it('treats an already-linked identical Auth user as success, not an error', () => {
    expect(body).toMatch(/if v_customer\.auth_user_id = p_auth_user_id then[\s\S]*?'ALREADY_LINKED'/i);
  });

  it('never re-assigns a customer to a different Auth user', () => {
    const claimed = body.indexOf("'CUSTOMER_ALREADY_CLAIMED'");
    const update = body.indexOf('update public.customers');
    // The refusal is raised BEFORE the link is written.
    expect(claimed).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(claimed);
  });

  it('consumes the token in the same transaction as the link', () => {
    const link = body.indexOf('set auth_user_id = p_auth_user_id');
    const consume = body.indexOf('set consumed_at = now()');
    expect(link).toBeGreaterThan(-1);
    expect(consume).toBeGreaterThan(link);
    // `consumed_by` records who consumed it.
    expect(body).toMatch(/set consumed_at = now\(\), consumed_by = p_auth_user_id/i);
  });

  it('writes all three audit events with no secret in the payload', () => {
    for (const action of [
      'CUSTOMER_AUTH_ACTIVATED',
      'CUSTOMER_ONBOARDING_TOKEN_CONSUMED',
      'CUSTOMER_ACCOUNT_LINKED',
    ]) {
      expect(body, action).toContain(`'${action}'`);
    }
    // A token, hash or password must never reach an audit payload.
    expect(body).not.toMatch(/jsonb_build_object\([^)]*token_hash/i);
    expect(body).not.toMatch(/jsonb_build_object\([^)]*password/i);
  });

  it('never stores or receives the plaintext token', () => {
    // Only the hash crosses the boundary; there is no column and no parameter
    // for a plaintext token.
    expect(body).not.toMatch(/insert into public\.customer_onboarding_tokens/i);
    expect(body).not.toMatch(/p_token\s+text/i);
    expect(body).toMatch(/p_token_hash text/i);
  });

  it('is not callable by a browser role', () => {
    const revoke = sql.slice(sql.indexOf('revoke all on function public.claim_customer_onboarding_token'));
    expect(revoke).toMatch(
      /revoke all on function public\.claim_customer_onboarding_token\(text, uuid, text\)\s*\n?\s*from public, anon, authenticated;/i,
    );
  });
});

describe('reissue_membership_credentials', () => {
  const body = functionBody('reissue_membership_credentials');

  it('is security definer with a pinned search_path', () => {
    expect(body).toMatch(/security definer/i);
    expect(body).toMatch(/set search_path = public, private, pg_temp/i);
  });

  it('re-checks ownership in SQL, so a handler bug cannot rotate another card', () => {
    expect(body).toMatch(/if v_membership\.customer_id <> p_customer_id then/i);
    // The refusal is indistinguishable from "not found": no existence oracle.
    expect(body).toMatch(/if v_membership\.customer_id <> p_customer_id then\s*\n\s*raise exception 'MEMBERSHIP_NOT_FOUND'/i);
  });

  it('only rotates an active membership', () => {
    expect(body).toMatch(/if v_membership\.status <> 'active' then/i);
  });

  it('generates fresh random values with the approved helpers', () => {
    expect(body).toMatch(/private\.new_fallback_code\(\)/i);
    expect(body).toMatch(/private\.new_qr_token\(\)/i);
  });

  it('stores only hashes, so the old hashes are replaced and the old codes die', () => {
    expect(body).toMatch(
      /set fallback_code_hash = private\.hash_token\(v_fallback\),\s*\n\s*qr_token_hash = private\.hash_token\(v_qr\)/i,
    );
    expect(body).not.toMatch(/fallback_code\s*=/i);
    expect(body).not.toMatch(/qr_token\s*=\s*v_qr_token\b.*insert/i);
  });

  it('locks the membership row so a rotation cannot interleave', () => {
    expect(body).toMatch(/from public\.memberships m where m\.id = p_membership_id for update;/i);
  });

  it('audits the re-issue and states that the previous codes were invalidated', () => {
    expect(body).toContain("'CUSTOMER_CREDENTIALS_REISSUED'");
    expect(body).toMatch(/jsonb_build_object\('previousCodesInvalidated', true\)/i);
  });

  it('returns the plaintext exactly once and stores nothing readable', () => {
    expect(body).toMatch(/return query select v_membership\.id, v_fallback, v_qr;/i);
    expect(body).not.toMatch(/insert into public\.memberships/i);
  });

  it('is not callable by a browser role', () => {
    expect(sql).toMatch(
      /revoke all on function public\.reissue_membership_credentials\(uuid, uuid, uuid\)\s*\n?\s*from public, anon, authenticated;/i,
    );
  });
});

describe('column-level grants', () => {
  const tables = ['customers', 'memberships', 'points_ledger', 'points_accounts'];

  it.each(tables)('replaces the table-wide SELECT grant on %s', (table) => {
    expect(sql, table).toMatch(new RegExp(`revoke select on public\\.${table} from authenticated;`, 'i'));
    expect(sql, table).toMatch(new RegExp(`grant select \\([^;]*\\) on public\\.${table} to authenticated;`, 'i'));
  });

  it('withholds the government ID columns from every browser role', () => {
    const customers = sql.slice(sql.indexOf('grant select (', sql.indexOf('revoke select on public.customers')));
    const list = customers.slice(0, customers.indexOf(') on public.customers'));
    expect(list).not.toMatch(/government_id_number/);
    expect(list).not.toMatch(/government_id_type/);
    // ...and the staff id that created the record.
    expect(list).not.toMatch(/created_by/);
  });

  it('withholds the membership credential hashes from every browser role', () => {
    const start = sql.indexOf('revoke select on public.memberships from authenticated;');
    const list = sql.slice(start, sql.indexOf(') on public.memberships', start));
    expect(list).not.toMatch(/fallback_code_hash/);
    expect(list).not.toMatch(/qr_token_hash/);
    expect(list).not.toMatch(/activated_by/);
  });

  it('withholds the internal actor id and metadata from the points ledger', () => {
    const start = sql.indexOf('revoke select on public.points_ledger from authenticated;');
    const list = sql.slice(start, sql.indexOf(') on public.points_ledger', start));
    expect(list).not.toMatch(/actor_id/);
    expect(list).not.toMatch(/metadata/);
  });

  it('never grants a mutating privilege to a browser role', () => {
    // The whole migration is read-only plus two service-role functions.
    const grants = [...code.matchAll(/grant\s+(.*?)\s+on\s/gis)].map((m) => m[1]!);
    expect(grants.length).toBeGreaterThan(0);
    for (const privilege of grants) {
      expect(privilege.toLowerCase()).toMatch(/^select\s*\(/);
    }
    expect(code).not.toMatch(/grant\s+(insert|update|delete|all)\s/i);
    expect(code).not.toMatch(/grant\s+execute/i);
  });
});

describe('no NFC and no staff coupling', () => {
  it('mentions no NFC, tag or card-reader concept', () => {
    expect(sql.toLowerCase()).not.toMatch(/\bnfc\b|tagid|ndef|card.?reader|emulat/);
  });

  it('adds no module row, so customer access is ownership, not a permission', () => {
    expect(sql.toLowerCase()).not.toMatch(/insert into (public\.)?modules/);
    expect(sql.toLowerCase()).not.toMatch(/has_permission/);
    expect(sql).not.toMatch(/staff_users|staff_role_assignments/);
  });

  it('does not touch the staff resolver or the staff permission model', () => {
    expect(sql).not.toMatch(/role_permissions|staff_permission_restrictions/);
  });
});
