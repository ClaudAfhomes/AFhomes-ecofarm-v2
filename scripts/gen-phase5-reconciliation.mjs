/**
 * One-shot generator for the Phase 5 reconciliation migration.
 *
 * The two corrected Phase 2 function definitions are EXTRACTED from the
 * amended Phase 2 RPC file rather than retyped, so the reconciliation carries
 * byte-identical SQL to the file it is reconciling. A hand-copied second copy
 * of a security-relevant function is exactly the kind of drift this repository
 * keeps recording as a defect.
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..');
const SRC = path.join(REPO, 'supabase/migrations/20260927000003_afhomes_phase2_rpc.sql');
const OUT = path.join(
  REPO,
  'supabase/migrations/20260929000001_afhomes_phase5_reconcile_phase2_fixes.sql',
);

const HEADER = `-- ===========================================================================
-- Phase 5 reconciliation: deliver the Phase 2 execution-found fixes
-- ===========================================================================
--
-- WHY THIS FILE EXISTS
--
-- Two Phase 2 migrations were corrected in the working tree AFTER they were
-- first written:
--
--   20260927000001_afhomes_phase2_business_foundation.sql
--   20260927000003_afhomes_phase2_rpc.sql
--
-- The corrections are not cosmetic. Each of the four defects fixed here was
-- found by EXECUTING the SQL on a real PostgreSQL, while text assertions and
-- the in-memory fake both passed against a broken database:
--
--   1. private.money() wrapped its result in rpad(x, 1, '0'). rpad TRUNCATES,
--      so every formatted total collapsed to its first character: 60,000.00
--      rendered as the string '6'. Every sale_financial_summary figure and
--      every verify_card_payment receipt was wrong.
--   2. verify_card_payment declared OUT parameters named \`sale_id\` and \`status\`,
--      so its own unqualified \`where sale_id = ... and status = 'verified'\` was
--      ambiguous and the function raised on EVERY call.
--   3. verify_card_payment set
--      spot_cash_started_at = v_sale.spot_cash_started_at - a self-assignment
--      that copied the existing NULL straight back, so the instant the spot-cash
--      window opened was never recorded.
--   4. commissions.ost_id was NOT NULL from Phase 1, while the new Phase 2
--      beneficiary CHECK also permits a STAFF beneficiary. The two constraints
--      contradicted each other and no commission could be created for a
--      VD/SSM/SM/Admin sale.
--
-- THE PROBLEM THIS MIGRATION SOLVES
--
-- A migration runner records the version (the timestamp prefix) and SKIPS any
-- version it has already recorded. If the production project already recorded
-- 20260927000001 and 20260927000003, it will skip them permanently and the
-- corrected bodies in those files will NEVER be applied. Production would then
-- run with broken money formatting, a payment-verification function that fails
-- on every call, an unrecorded spot-cash start, and no way to create a
-- commission for a staff sale.
--
-- The fixes are therefore re-delivered here as a NEW, forward-only, idempotent
-- migration. This is deliberately NOT another edit to the two amended files:
-- those stay as the historical record of what Phase 2 was, and this file
-- guarantees the corrected definitions exist no matter which versions any given
-- database has recorded.
--
-- IDEMPOTENCE
--
-- \`create or replace function\` and \`alter column ... drop not null\` are both no-ops
-- when the corrected definition is already in place. Applying this file to an
-- already-correct database changes nothing. That is what makes it safe to apply
-- unconditionally, without first having to know whether any target recorded
-- the defective versions.
--
-- ORDERING
--
-- Must run AFTER 20260927000003. It redefines functions over Phase 2 tables;
-- if Phase 2 has never been applied, the runner applies Phase 2 first because
-- migrations run in filename order.
--
-- VALIDATION (run after applying; all must hold)
--
--   -- 1. money formatting is exact, never truncated to one character
--   select private.money(60000)  = '60000.00'  as money_ok,
--          private.money(0.5)     = '0.50'      as money_half_ok,
--          private.money(1234.5)  = '1234.50'   as money_pad_ok;
--
--   -- 2. a staff-beneficiary commission is insertable
--   select is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'commissions'
--      and column_name = 'ost_id';               -- expect: YES
--
--   -- 3. verify_card_payment exists as plpgsql
--   select p.proname, l.lanname
--     from pg_proc p join pg_language l on l.oid = p.prolang
--    where p.proname = 'verify_card_payment';    -- expect: plpgsql, one row
--
--   -- 4. the self-assignment is gone from the INSTALLED definition
--   select prosrc from pg_proc where proname = 'verify_card_payment';
--     -- must contain 'coalesce('
--     -- must NOT contain 'spot_cash_started_at = v_sale.spot_cash_started_at'
--
-- DOWN NOTE
--
-- There is no down migration, by design. Reverting private.money() would
-- reintroduce a defect that silently misreports every money total, and
-- reverting the other three would reintroduce hard failures. Roll back by
-- re-applying the corrected definitions - this file is idempotent - not by
-- restoring the defective bodies.
-- ===========================================================================

`;

const lines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/);

/** Lines are 1-based in the comments below; slice() is 0-based. */
function block(firstLine, lastLine) {
  return lines.slice(firstLine - 1, lastLine).join('\n');
}

/** private.money: L20..L29 */
const money = block(20, 29);
/** verify_card_payment: L224..L352 (ends with 'end $$;') */
const verify = block(224, 352);

if (!money.startsWith('create or replace function private.money')) {
  throw new Error('private.money extraction failed: unexpected first line');
}
if (!verify.startsWith('create or replace function public.verify_card_payment')) {
  throw new Error('verify_card_payment extraction failed: unexpected first line');
}
if (!verify.trimEnd().endsWith('end $$;')) {
  throw new Error('verify_card_payment extraction failed: unexpected last line');
}
// Guard against extracting a stale range: the three fixes must be present.
for (const [label, needle] of [
  ['qualified payment filter', "where p.sale_id = v_sale.id and p.status = 'verified'"],
  ['qualified commission update', "where c.sale_id = v_sale.id and c.status = 'pending'"],
  ['qualified sale status subquery', 'select s.status from public.card_sales s where s.id = v_sale.id'],
  ['coalesce spot cash', 'coalesce(v_sale.spot_cash_started_at, now())'],
]) {
  if (!verify.includes(needle)) throw new Error(`extracted verify_card_payment is missing the ${label}`);
}
if (!money.includes("rpad(coalesce(nullif(split_part(v, '.', 2), ''), '0'), 2, '0')")) {
  throw new Error('extracted private.money does not pad the fraction to exactly two digits');
}

const out = `${HEADER}

-- ---------------------------------------------------------------------------
-- 1. private.money - exact two-decimal text, never length-capped
-- ---------------------------------------------------------------------------
-- NEVER wrap a formatted value in rpad(x, n, c) with n shorter than the value:
-- rpad TRUNCATES. The rpad call below is the only one, and it pads the
-- FRACTIONAL part to exactly two digits, which is the only correct use.

${money}

comment on function private.money(numeric) is
  'Exact-decimal money text with exactly two decimals. numeric is arbitrary
precision, so no float ever participates. Never wrap the result in
rpad(x, n, c) with a length shorter than the value: rpad TRUNCATES, which
silently turned every total into its first character. Found by executing this
on a real PostgreSQL.';

-- ---------------------------------------------------------------------------
-- 2. commissions.ost_id - a staff beneficiary is legal
-- ---------------------------------------------------------------------------
-- Phase 1 declared this NOT NULL because the only seller it modelled was an
-- OST. Phase 2 widened the beneficiary CHECK to also allow a staff member, and
-- the two constraints contradicted each other, so no commission could be
-- created for a VD/SSM/SM/Admin sale. This is a no-op when already nullable.

alter table public.commissions
  alter column ost_id drop not null;

-- ---------------------------------------------------------------------------
-- 3. verify_card_payment - qualified references and a real coalesce
-- ---------------------------------------------------------------------------
-- This function declares OUT parameters named \`sale_id\` and \`status\`. Every table
-- column referenced inside it MUST therefore be qualified, or the reference is
-- ambiguous and the function raises on EVERY call. The previous definition had
-- three unqualified references and was therefore completely unusable.
--
-- spot_cash_started_at is set with coalesce(), never self-assigned.

${verify}

comment on function public.verify_card_payment(uuid, text, text, uuid) is
  'Verifies or rejects a RECORDED payment inside one transaction. Every table
reference is qualified because this function declares OUT parameters named
sale_id and status; an unqualified reference is ambiguous and raised on every
call. spot_cash_started_at is set with coalesce(), never self-assigned.';
`;

fs.writeFileSync(OUT, out);
console.log(`  wrote ${path.relative(REPO, OUT)} (${out.split('\n').length} lines)`);
console.log(`  private.money        : ${money.split('\n').length} lines extracted`);
console.log(`  verify_card_payment  : ${verify.split('\n').length} lines extracted`);
console.log('  all four fixes verified present in the extracted SQL');
