# AF Homes database testing and execution lessons

> Relocated verbatim from `AGENTS.md` (sections "Database integration suite", "Defects that only real PostgreSQL execution found", "False passes") on 2026-11-13 to reduce
> always-loaded context. `AGENTS.md` remains the authority; it keeps every
> invariant and points here. Package names updated from `@jad/*` to `@afhomes/*`.

## Database integration suite

The unit suite is **fully offline** and never needs a database. The SQL, however,
is only truly proven by executing it, so there is a second, opt-in suite:

| Command | Target |
|---|---|
| `pnpm test:db:local` | Boots a **disposable local PostgreSQL**, applies `supabase/db-testing/supabase-shim.sql` then every migration, runs the suite, deletes the server. Loopback only. |
| `pnpm test:db` | An explicitly approved development database, via `AFHOMES_TEST_DATABASE_URL`. |

Safety, all fail-closed with exit code 2:

- No `AFHOMES_TEST_DATABASE_URL` → refuses, explains both commands.
- A `*.supabase.co` / `*.pooler.supabase.com` host with **no** `AFHOMES_TEST_PROJECT_REF` → refuses; the suite never guesses its target.
- `AFHOMES_TEST_PROJECT_REF` equal to the production ref → refuses by name.
- Only synthetic, per-run-prefixed data; removed on exit. No real customer data.
- No connection string, password, key or token value is ever printed.

`supabase/db-testing/supabase-shim.sql` reproduces the Supabase platform objects
the migrations assume but never create (`auth.users`, `auth.uid()`, the
`anon`/`authenticated`/`service_role` roles, `storage.buckets`/`storage.objects`).
**It is a test fixture and must never be applied to a real Supabase project.**
`pnpm db:migrate` does not read it.


### Defects that only real PostgreSQL execution found

Text assertions and the in-memory Supabase fake both passed while the database was
broken. These were found by running the SQL, and each now has a tripwire:

- `private.money()` wrapped its result in `rpad(x, 1, '0')`. **`rpad` truncates**,
  so every formatted total collapsed to its first character — `60,000.00` became
  `"6"`. Every `sale_financial_summary` figure was wrong. Never length-cap a
  formatted value with `rpad`.
- `verify_card_payment` declared OUT parameters named `sale_id` and `status`, so
  its own unqualified `where sale_id = ... and status = 'verified'` was ambiguous
  and the function failed on **every** call. **Alias and qualify every table
  inside a `returns table` function.**
- `verify_card_payment` set `spot_cash_started_at = v_sale.spot_cash_started_at`,
  a self-assignment that copied the existing `NULL` straight back, so the instant
  the window opened was never recorded. Use `coalesce(col, now())`.
- `commissions.ost_id` was `NOT NULL` from Phase 1 while Phase 2's new beneficiary
  CHECK allows a **staff** beneficiary. The two constraints contradicted each
  other and no commission could be created for a VD/SSM/SM/Admin sale. When a
  migration generalises a column's meaning, re-read the old constraints.
- **Phase 3:** `authenticated` held a table-wide `SELECT` on `public.customers`,
  so a customer who legitimately passed the self-read policy could read their own
  `government_id_number` through PostgREST. **RLS is row-level; it says nothing
  about columns.** Narrow browser grants to an explicit column list on every
  table a browser role can read.
- **Phase 3:** `claim_customer_onboarding_token` checked `consumed_at` before the
  already-linked branch, which made its `ALREADY_LINKED` outcome **unreachable
  code** — a client retrying after a lost response got "already used" instead of
  the success it had earned. Idempotency must be decided **before** the
  consumption and lifecycle checks.
- **Phase 3:** `reissue_membership_credentials` gated on the *membership* status
  but not the *customer* status. A suspended member's membership row is still
  `active`, so the database would have accepted a rotation that the handler
  refused. A `SECURITY DEFINER` function must re-check every precondition the
  handler checks — the handler is not the security boundary it appears to be.
- **Phase 4:** `memberships.points_balance` was written as `0` by Phase 2's
  activation and never maintained, while `points_accounts.balance` held the real
  figure. The staff identifier lookup had therefore been reporting
  `pointsBalance: 0` for a member holding 60,000 points. Repaired in Phase 4 and
  kept in step. **A denormalized column nobody maintains is worse than none.**
- **Phase 4:** `findNavSubItem` in `apps/admin/src/app/navigation.ts` used
  first-match prefix matching. Once a dropdown held both `/admin/redemption` and
  `/admin/redemption/items`, the catalog screen resolved to the *workflow's*
  module key and checked the wrong permission. The longest match now wins. This
  was UX-only (the server still refused), but the guard must not check the wrong
  permission.

### False passes: harness bugs that hid real behaviour

Recorded because each one let a suite be green while testing nothing:

- A denied statement aborts the enclosing transaction, so every probe after the
  first in a shared transaction reported "current transaction is aborted"
  instead of its own reason. Wrap each write-denial probe in its own
  `SAVEPOINT`.
- The in-memory Supabase fake's `splitTopLevel` did not trim, so
  `"a, customers!inner(status)"` produced a spec with a **leading space**: the
  embed key became `" customers"` and the table name `" customers"` matched no
  declared link. Every embed in the codebase resolved to `undefined` in silence
  and callers read a `?? {}` fallback. Phase 2 and Phase 3 tests passed only
  because none of them asserted an embedded value. **The fake now trims, and its
  embed resolution tries both directions of a relation.**
- The fake never returned `count` at all, so `meta.total` silently fell back to
  the page size and pagination was untestable. It now returns the pre-pagination
  total, as PostgREST does.
- A test fixture used an all-lowercase QR token, so a "does not case-fold" case
  passed for the wrong reason. A real QR token is base64 and mixed case.
- **Phase 5:** section 37 of the DB suite — the reconciliation checks — lived in
  the `catch` for sections 1-36, so on a green run it **never executed**. 493
  checks passed with zero assertions about the migration the phase exists for.
  Section 37 now runs on the successful path, and `pnpm test:db:harness` asserts
  it appeared in the output. **A check that only runs once something else has
  already broken is not a check.**
- **Phase 5:** the abort report sat *inside* section 37's own `catch`, so a
  throw anywhere in sections 1-36 produced a short, entirely green run and
  **exit code 0**. The report now lives in the outer `catch`, and the injection
  flag plus the harness prove the non-zero exit. **Silence is not a pass.**
- **Phase 5:** two of section 37's three assertions were invalid and *failed
  against a correct database* — a `length === 9` check on `'60000.00'` (it is 8),
  and a self-assignment regex that matched the **comment inside the function**
  documenting the old defect, because `pg_proc.prosrc` retains comments. A third
  compared `prosrc` byte-for-byte, measuring hand-typed whitespace rather than
  behaviour. All three now assert semantics, and one guards that the migration's
  explanatory comments are never deleted to satisfy a regex.
- **Phase 5:** cleanup asserted only `count(customers) == 0`, and the synthetic
  **inactive** staff member was never pushed onto `createdStaffIds` — so it
  survived every run, forever, while the check passed. Cleanup now resolves its
  id sets from the database (recorded ids **union** run-prefix marker) and
  verifies every table is back to its **pre-run row count**. **A cleanup check
  that inspects one table is not a cleanup check.**

The lesson is recorded deliberately: **a schema that compiles is not a schema that
works, and a test that cannot fail is not a test.** `pnpm test:db:local` and
`pnpm test:db:harness` are the only things that would have caught these.

