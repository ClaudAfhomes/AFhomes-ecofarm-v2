/**
 * Structural tripwires for the Phase 4 redemption migration.
 *
 * These are TEXT assertions, and they are not sufficient - `pnpm test:db:local`
 * is what proves the transaction, the locking and the concurrency. What these
 * buy is fast feedback on the things that are easy to break while editing SQL by
 * hand: a dropped `for update`, a lock taken in the wrong order, a removed
 * `security definer`, a grant that crept back.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MIGRATION = fileURLToPath(
  new URL('../../supabase/migrations/20260928000001_afhomes_phase4_redemption.sql', import.meta.url),
);
const sql = readFileSync(MIGRATION, 'utf8');

/** The file with every `--` comment line removed, so prose cannot satisfy a
 *  structural assertion (or trip one). */
const code = sql
  .split('\n')
  .map((line) => (line.trimStart().startsWith('--') ? '' : line))
  .join('\n');

const header = sql.slice(0, sql.indexOf('create table'));

/** Everything from `function <name>(` through its closing `$$`. */
function functionBody(name: string): string {
  const start = code.indexOf(`function public.${name}(`);
  expect(start, `${name} is missing`).toBeGreaterThan(-1);
  const open = code.indexOf('$$', start);
  const close = code.indexOf('$$', open + 2);
  expect(close, `${name} has no closing $$`).toBeGreaterThan(open);
  return code.slice(start, close);
}

const tableBody = (name: string): string => {
  const start = code.indexOf(`create table if not exists public.${name} (`);
  expect(start, `${name} is missing`).toBeGreaterThan(-1);
  return code.slice(start, code.indexOf(');', start));
};

describe('phase 4 migration: file discipline', () => {
  it('states its validation queries and a down note, per migration discipline', () => {
    expect(header).toMatch(/validation before apply/i);
    expect(header).toMatch(/select[\s\S]*has_table_privilege\('authenticated','public\.redemptions'/);
    expect(header).toMatch(/^-- down:/im);
  });

  it('is forward-only: it amends nothing from an earlier migration', () => {
    // Phase 1-3 are proven and shipped. Phase 4 adds; it never rewrites.
    expect(code).not.toMatch(/drop table public\.(customers|memberships|points_accounts|points_ledger|redemptions)/i);
    expect(code).not.toMatch(/drop column/i);
    expect(code).not.toMatch(/alter table public\.(customers|memberships)\b/i);
  });
});

describe('redemption_items catalog', () => {
  const body = tableBody('redemption_items');

  it('has every column the catalogue screen needs', () => {
    for (const column of [
      'id',
      'code',
      'name',
      'description',
      'category',
      'points_cost',
      'is_active',
      'sort_order',
      'created_at',
      'updated_at',
    ]) {
      expect(body, column).toMatch(new RegExp(`\\b${column}\\b`));
    }
  });

  it('prices in whole points, bounded, and never in money', () => {
    // bigint, NOT numeric/text: points are not currency and must not go through
    // `private.money` or a decimal text column.
    expect(body).toMatch(/points_cost bigint not null check \(points_cost > 0 and points_cost <= \d+\)/);
    expect(body).not.toMatch(/points_cost\s+(numeric|text)/);
    expect(body).not.toMatch(/private\.money/);
  });

  it('has a unique code and an active-first sort index', () => {
    expect(body).toMatch(/code text not null unique/);
    expect(code).toMatch(
      /create index if not exists redemption_items_active_sort_idx\s*\n\s*on public\.redemption_items \(is_active, sort_order, name\)/,
    );
  });

  it('is never deleted, only deactivated', () => {
    // There is deliberately no `on delete cascade` from redemptions to items.
    expect(tableBody('redemptions')).toMatch(
      /redemption_item_id uuid not null references public\.redemption_items\(id\) on delete restrict/,
    );
  });
});

describe('redemptions transaction model', () => {
  const body = tableBody('redemptions');

  it('snapshots the item so later catalog edits cannot rewrite history', () => {
    expect(body).toMatch(/item_code_snapshot text not null/);
    expect(body).toMatch(/item_name_snapshot text not null/);
    expect(body).toMatch(/points_cost_snapshot bigint not null check \(points_cost_snapshot > 0\)/);
    // The snapshots are independent copies, not a live reference for display.
    expect(body).not.toMatch(/item_name\s+text/);
  });

  it('snapshots the balance so a receipt is reproducible on a retry', () => {
    expect(body).toMatch(/balance_before_snapshot bigint not null check \(balance_before_snapshot >= 0\)/);
    expect(body).toMatch(/balance_after_snapshot bigint not null check \(balance_after_snapshot >= 0\)/);
    // Arithmetic is enforced by the database, not recomputed in a client.
    expect(body).toMatch(/check \(total_points = points_cost_snapshot \* quantity\)/);
    expect(body).toMatch(
      /check \(balance_after_snapshot = balance_before_snapshot - total_points\)/,
    );
  });

  it('bounds quantity to a positive integer with no discount rule', () => {
    expect(body).toMatch(/quantity integer not null default 1 check \(quantity > 0 and quantity <= \d+\)/);
    // A bulk rule would be invented policy; there is none.
    expect(body).not.toMatch(/discount|bulk|volume/i);
  });

  it('records the acting staff member, and cannot be a caller-supplied id', () => {
    expect(body).toMatch(/redeemed_by uuid not null references public\.staff_users\(id\) on delete restrict/);
    expect(body).toMatch(/redeemed_by_name text not null/);
  });

  it('uses explicit states', () => {
    expect(body).toMatch(/status text not null default 'completed' check \(status in \('completed', 'voided'\)\)/);
  });

  it('makes a half-recorded void impossible', () => {
    // The void columns exist so a future, explicitly-specified rule has a home,
    // but the CHECK ties all three to the state, so no row can be half voided.
    expect(body).toMatch(/voided_at timestamptz/);
    expect(body).toMatch(/voided_by uuid references public\.staff_users\(id\) on delete restrict/);
    expect(body).toMatch(/void_reason text/);
    expect(body).toMatch(
      /check \(\s*\(status = 'completed' and voided_at is null and voided_by is null and void_reason is null\)\s*\n\s*or\s*\n\s*\(status = 'voided' and voided_at is not null and voided_by is not null and void_reason is not null\)/,
    );
  });

  it('has a per-staff de-duplication index, not a global one', () => {
    // A global key would let one staff member collide with - and read - another
    // member's receipt.
    expect(code).toMatch(
      /create unique index if not exists redemptions_actor_idempotency_uidx\s*\n\s*on public\.redemptions \(redeemed_by, idempotency_key\)/,
    );
    expect(code).not.toMatch(/unique index[\s\S]{0,80}on public\.redemptions \(idempotency_key\)/);
  });

  it('indexes the columns the history filters actually use', () => {
    for (const index of [
      'redemptions_membership_idx',
      'redemptions_item_idx',
      'redemptions_redeemed_by_idx',
      'redemptions_created_idx',
    ]) {
      expect(code, index).toContain(`create index if not exists ${index}`);
    }
  });
});

describe('redeem_membership_points', () => {
  const body = functionBody('redeem_membership_points');

  it('is security definer with a pinned search_path', () => {
    expect(body).toMatch(/security definer/i);
    expect(body).toMatch(/set search_path = public, private, pg_temp/i);
  });

  it('re-validates the actor instead of trusting the caller', () => {
    // The handler resolves the actor from the session, but a SECURITY DEFINER
    // function must not take an id on faith.
    expect(body).toMatch(/if p_actor_id is null then[\s\S]*?raise exception 'ACTOR_REQUIRED'/i);
    expect(body).toMatch(/from public\.staff_users s where s\.id = p_actor_id/);
    expect(body).toMatch(/if v_actor\.status <> 'active' then/);
    expect(body).toMatch(/raise exception 'ACTOR_NOT_ACTIVE/);
  });

  it('locks membership, customer, item and points account, in that fixed order', () => {
    const order = [
      'from public.memberships m\n  where m.id = p_membership_id for update',
      'from public.customers c\n  where c.id = v_membership.customer_id for update',
      'from public.redemption_items i\n  where i.id = p_redemption_item_id for update',
      'from public.points_accounts a\n  where a.membership_id = p_membership_id for update',
    ];
    let cursor = -1;
    for (const fragment of order) {
      const at = body.indexOf(fragment);
      expect(at, `missing or reordered lock: ${fragment.slice(0, 40)}`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it('locks the points account BEFORE reading the balance', () => {
    // This ordering IS the concurrency control. Read first and the check is a
    // time-of-check/time-of-use race that lets two terminals overspend.
    const lock = body.indexOf('from public.points_accounts a');
    const read = body.indexOf('if v_account.balance < v_total then');
    expect(lock).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(lock);
  });

  it('locks the membership and the customer, so the lifecycle cannot change mid-flight', () => {
    expect(body).toMatch(/for update;/);
    expect((body.match(/for update;/g) ?? []).length).toBe(4);
  });

  it('reads the price from the catalog and never from a parameter', () => {
    expect(body).toMatch(/v_total := v_item\.points_cost \* p_quantity/);
    // There is no parameter that could carry a price.
    expect(body).not.toMatch(/p_(price|cost|amount|total|balance)\b/);
  });

  it('validates every precondition with a distinct refusal', () => {
    for (const reason of [
      'ACTOR_REQUIRED',
      'IDEMPOTENCY_KEY_REQUIRED',
      'INVALID_QUANTITY',
      'ACTOR_NOT_STAFF',
      'ACTOR_NOT_ACTIVE',
      'MEMBERSHIP_NOT_FOUND',
      'CUSTOMER_NOT_FOUND',
      'CUSTOMER_NOT_ACTIVE',
      'MEMBERSHIP_NOT_ACTIVE',
      'MEMBERSHIP_EXPIRED',
      'REDEMPTION_ITEM_NOT_FOUND',
      'REDEMPTION_ITEM_INACTIVE',
      'POINTS_ACCOUNT_NOT_FOUND',
      'INSUFFICIENT_POINTS',
    ]) {
      // The raised text may carry a detail suffix (`'X:%'`, `'X:need %'`, ...);
      // the reason must always be the LEADING token, because the handler maps
      // refusals by splitting on the first colon.
      expect(body, reason).toMatch(new RegExp(`raise exception '${reason}[:']`, 'i'));
    }
  });

  it('refuses an insufficient balance without disclosing the balance', () => {
    expect(body).toMatch(/if v_account\.balance < v_total then[\s\S]*?INSUFFICIENT_POINTS:need %/i);
    // The balance itself is never in the message.
    expect(body).not.toMatch(/INSUFFICIENT_POINTS:[^']*balance/i);
  });

  it('does NOT flip membership status on expiry', () => {
    // Expiry is a refusal. What happens to a lapsed membership afterwards is an
    // unresolved renewal policy and must not be defined as a side effect here.
    expect(body).toMatch(/if v_membership\.expires_at <= now\(\) then[\s\S]*?'MEMBERSHIP_EXPIRED'/i);
    expect(body).not.toMatch(/update public\.memberships\s*\n\s*set status/);
  });

  it('is idempotent per (actor, key), and checks AFTER the locks', () => {
    const lock = body.indexOf('from public.points_accounts a');
    const check = body.indexOf('where r.redeemed_by = p_actor_id and r.idempotency_key = p_idempotency_key');
    expect(check).toBeGreaterThan(lock);
    // A retry returns the ORIGINAL receipt from its own snapshots.
    expect(body).toMatch(/v_existing\.balance_before_snapshot, v_existing\.balance_after_snapshot/);
  });

  it('writes the redemption, exactly one ledger row, the debit and the cache, then audits', () => {
    const insertRedemption = body.indexOf('insert into public.redemptions');
    const insertLedger = body.indexOf('insert into public.points_ledger');
    const debitAccount = body.indexOf('update public.points_accounts');
    const cache = body.indexOf('update public.memberships');
    const audit = body.indexOf("insert into public.audit_events");
    expect(insertRedemption).toBeGreaterThan(-1);
    expect(insertLedger).toBeGreaterThan(insertRedemption);
    expect(debitAccount).toBeGreaterThan(insertLedger);
    expect(cache).toBeGreaterThan(debitAccount);
    expect(audit).toBeGreaterThan(cache);
    // Exactly one ledger insert: a reversal must APPEND, never this row edited.
    expect((body.match(/insert into public\.points_ledger/g) ?? []).length).toBe(1);
  });

  it('appends a NEGATIVE ledger row with the post-debit balance', () => {
    expect(body).toMatch(
      /v_account\.id, 'redemption', -v_total, v_after,\s*\n\s*'redemption', v_existing\.id::text/,
    );
  });

  it('accumulates lifetime_redeemed and never lets the balance go negative', () => {
    expect(body).toMatch(/lifetime_redeemed = lifetime_redeemed \+ v_total/);
    // The debit is computed from the already-validated balance, so the account's
    // own `balance >= 0` CHECK (declared in Phase 2) can never be reached.
    expect(body).toMatch(/set balance = v_after,\s*\n\s*lifetime_redeemed = lifetime_redeemed \+ v_total/);
    expect(body).toMatch(/v_after := v_account\.balance - v_total/);
  });

  it('audits with ids and points only - no credential can reach the payload', () => {
    const auditBlock = body.slice(body.indexOf("insert into public.audit_events"));
    expect(auditBlock).toMatch(/jsonb_build_object\([\s\S]*'totalPoints', v_total/);
    for (const forbidden of ['qr_token', 'fallback_code', 'password', 'government']) {
      expect(auditBlock, forbidden).not.toMatch(new RegExp(forbidden, 'i'));
    }
  });

  it('returns a receipt-safe row and nothing more', () => {
    const returns = body.slice(0, body.indexOf('as $$'));
    for (const field of [
      'redemption_id',
      'redemption_number',
      'item_code',
      'item_name',
      'unit_points',
      'quantity',
      'total_points',
      'balance_before',
      'balance_after',
      'customer_name',
      'membership_number',
      'completed_at',
    ]) {
      expect(returns, field).toMatch(new RegExp(`\\b${field}\\b`));
    }
    // No credential, no Auth internals, no contact details on the receipt.
    for (const forbidden of ['email', 'phone', 'address', 'auth_user', 'government', 'token_hash']) {
      expect(returns, forbidden).not.toMatch(new RegExp(forbidden, 'i'));
    }
  });

  it('is not callable by a browser role', () => {
    expect(code).toMatch(
      /revoke all on function public\.redeem_membership_points\(uuid, uuid, integer, text, uuid\)\s*\n\s*from public, anon, authenticated;/i,
    );
  });
});

describe('memberships.points_balance cache repair', () => {
  it('backfills the cache from the authoritative points account', () => {
    // Phase 2's activation wrote 0 here and only ever credited points_accounts,
    // so the column has read 0 for every member and the staff identifier lookup
    // reported `pointsBalance: 0` for a member holding 60,000 points.
    expect(code).toMatch(
      /update public\.memberships m\s*\n\s*set points_balance = coalesce\(a\.balance, 0\)/,
    );
    expect(code).toMatch(/select membership_id, balance from public\.points_accounts/);
  });

  it('is documented as a repair, not a reversal target', () => {
    expect(sql).toMatch(/was wrong|has read 0/i);
  });
});

describe('RLS and grants', () => {
  it('enables RLS on both new tables', () => {
    expect(code).toMatch(/alter table public\.redemption_items enable row level security/);
    expect(code).toMatch(/alter table public\.redemptions enable row level security/);
  });

  it('gives a browser role NO privilege on either table', () => {
    // Un-exposed, not exposed-and-filtered. There is no policy left to get wrong,
    // and therefore no way for a customer - or any staff member - to reach the
    // tables directly. Every read goes through the service-role API.
    expect(code).toMatch(/revoke all on public\.redemption_items from anon, authenticated/);
    expect(code).toMatch(/revoke all on public\.redemptions from anon, authenticated/);
  });

  it('writes SELECT-only policies, gated on the existing module keys', () => {
    expect(code).toMatch(
      /create policy redemption_items_read on public\.redemption_items\s*\n\s*for select to authenticated\s*\n\s*using \(\s*\n\s*private\.has_permission\('operations\.catalog'\)\s*\n\s*or private\.has_permission\('operations\.redemption'\)/,
    );
    expect(code).toMatch(
      /create policy redemptions_read on public\.redemptions\s*\n\s*for select to authenticated\s*\n\s*using \(private\.has_permission\('operations\.redemption'\)\)/,
    );
  });

  it('creates no INSERT, UPDATE or DELETE policy', () => {
    for (const verb of ['insert', 'update', 'delete']) {
      expect(code, verb).not.toMatch(new RegExp(`for ${verb} to`, 'i'));
    }
  });

  it('never writes a USING (true) policy', () => {
    expect(code).not.toMatch(/using\s*\(\s*true\s*\)/i);
  });

  it('reuses the Phase 1 module keys and adds no new module', () => {
    expect(code).not.toMatch(/insert into (public\.)?modules/i);
    // No new vocabulary: `operations.redemption` / `operations.catalog` already exist.
    expect(code).toMatch(/has_permission\('operations\.redemption'\)/);
    expect(code).toMatch(/has_permission\('operations\.catalog'\)/);
  });
});

describe('no NFC, and nothing this phase must not define', () => {
  it('mentions no NFC, tag or card-reader concept', () => {
    expect(code.toLowerCase()).not.toMatch(/\bnfc\b|ndef|tagid|tag_id|card.?reader/);
  });

  it('does not create a loyalty tier, cash value or expiry job', () => {
    // Tiering, cash redemption and automated expiry are all explicitly out of
    // scope, and none may be smuggled in as a side effect.
    for (const forbidden of [
      'loyalty_tier',
      'tier',
      'cash_value',
      'pgx_cron',
      'cron.schedule',
      'expires_at = now() +',
    ]) {
      expect(code.toLowerCase(), forbidden).not.toMatch(new RegExp(forbidden, 'i'));
    }
  });

  it('writes no void, refund or reversal path', () => {
    expect(code.toLowerCase()).not.toMatch(/refund/);
    // `reversal` appears only as the ledger entry type a future void would use.
    const reversals = [...code.matchAll(/reversal/gi)].length;
    expect(reversals).toBeLessThanOrEqual(1);
  });

  it('touches no commission, qualification or payout state', () => {
    expect(code.toLowerCase()).not.toMatch(/commission|final_qualification|payout/);
  });
});
