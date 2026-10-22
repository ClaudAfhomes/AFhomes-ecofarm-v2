# SESSION.md — Chat Handoff Context

> **Protocol:** This file holds the latest handoff only. When the user says
> `handoff context to @SESSION.md`, REPLACE this entire file with the new
> session's context (do not append; delete stale sections). Keep it dense:
> decisions, patterns, open threads, and verification state. No prose essays.

## Stack (unchanging)

pnpm + Turborepo. `apps/web` (:5173; marketing + `/customer/**` + `/ost/**`) |
`apps/admin` (:5174, `/admin/`) | single Vercel Function `api/router.ts` →
`api/_lib/router.ts` (`BUSINESS_FAMILIES`) → `api/_handlers/**` → Supabase
Postgres + Auth. `packages/contracts` (Zod SSOT; `lifecycle.ts` statuses;
`afhomes.ts` module catalog; `customer-ssot.ts` 62-col registry;
`member.ts` sales-network Members) | `packages/shared` (BigInt money) |
`packages/config` (`VITE_`-only) | `packages/ui` (tokens + primitives).
`SESSION.md`, `docs/security/`, `docs/testing/` are user items — do not touch.
`docs/supabase/CURRENT-SCHEMA.sql` refreshes BY AGENT only on explicit
"update schema" trigger.

## Standing user preferences (apply without asking)

- `@ponytail` active (full): smallest complete change, house components first,
  no new deps, finish callers/tests/fixtures. End replies with skipped + risk.
- UI rounds are UI-only: no handler/contract/SQL/history edits, no new deps;
  preserve every flow and permission; inspect before implementing; desktop/
  tablet/mobile; gate on focused vitest + `tsc` + `eslint` + admin build; end
  with a short report. ONE named surface at a time — wait for the next.
- Added copy gets reviewed and stripped. User-facing copy: every sentence max
  5–6 words. Surface rules the user states win.
- User edits in parallel — and commits mid-session. Re-check `git status`/
  `git log` before assuming state; re-read shared files before editing; leave
  foreign diffs alone; never restore what the user deliberately removed.
- Version control: never stage/commit/push/branch/tag/stash/reset or GitHub
  actions unless explicitly commanded in-session. Working-tree edits are work.
- Passwords/TIN/gov-IDs never returned, never in audits (masked reads only).
- No `select('*')` on wide rows; filter in SQL; Free-quota rules per
  `docs/supabase/SUPABASE-FREE.md`.
- Prettier NOT a gate (CRLF artifact). Gate on `tsc` + `eslint`.

## Repo state (verified 2026-10-23)

- Branch `orly/develop` @ `d4b186f "enhance: reservation page"`. Production
  project `ikaevepedpqygdlipsei`, last applied migration `20261212000004`.
- **Untracked migrations (unapplied, in working tree):**
  - `20261214000001_afhomes_auto_reservation_on_approval.sql` — application
    approval auto-creates reservation (draft→submitted→executed) + ₱10,000
    recorded payment; idempotent via parent + derived child request IDs.
  - `20261215000001_afhomes_company_customer_id_format.sql` — user WIP.
  - `20261215000001_afhomes_search_path_canonical.sql` — search_path hardening
    for `reconcile_external_customer_import`.
  - `20261216000001_afhomes_remove_reservation_signatures.sql` — drops
    reservation signature columns + execute gate; redefines save/reserve/
    transition/decide/build/fields_valid.
  - `20261217000001_afhomes_remove_schedule_remarks.sql` — user WIP.
- **Working tree:** extensive user WIP (CustomerDetailPage, CustomerRecordActions,
  official-forms-applications/fields/reservations, genealogy, sale-team, etc.)
  plus agent changes (official-forms.ts, BusinessFinanceQueuePage, activation
  page, db-integration.ts). Leave foreign diffs alone.
- **Pre-existing failures (NOT from this session):**
  - admin `src/features/business`: 30 failed (application-actions 16,
    PurchasePaymentsPage 11, final-blockers 3) — byte-identical baseline.
  - DB: section 48 (customer import referral hierarchy) + section 58 (purchase
    terms reason refusal ×3) — pre-existing; section 77 (OST team transfer)
    still blocks `pnpm test:db:harness`.
  - admin lint: 1 error (user WIP `CustomerRecordActions.tsx:36`) + 24 warnings.
- **Gates this session:** `pnpm typecheck` clean (7/7 + supabase); `pnpm lint`
  0 errors (admin) + 24 warnings; admin build green; `pnpm check:env` PASS;
  `pnpm test:db:local` 1602/1606 (4 pre-existing failures). Admin focused
  specs green (OfficialFormsPages, reservation-detail-panel, reservation-source-panel,
  responsive-cards, official-form-list-contract, reservation-finance-queue,
  finance-lifecycle badges).

## Last session's work (UNCOMMITTED)

- **Application → reservation → payment auto-flow:** approval auto-creates
  reservation (draft→submitted→executed) + ₱10,000 recorded payment; idempotent.
  Frontend invalidates application/reservation/payment/finance/report caches.
- **Removed reservation agreement signature tracking** (signature ≡ approval):
  dropped DB columns + execute gate + contract fields + UI column + editor inputs.
- **Reservations list:** Status column → Payment status (Cancelled/Fully Paid/
  Partial/Pending/—); handler now computes `verified_total` + `fully_paid`.
- **Finance queue:** row click → view details (not record payment); Status chip →
  payment-derived status; payment modal closes on success + page loading skeleton.
- **Activation queue:** Activate button spinner + success alert + loading
  skeleton after success.
- **Removed "New Agreement" button** + manual "Create reservation" next-action.
- **Full reservation editing:** editable on draft/submitted/executed.
- **Search-path hardening:** canonical order for `reconcile_external_customer_import`.
- **DB test cleanup:** payment-keyed purchase-document-evidence deleted before
  payments.

## Test gotchas (admin)

- `(Optional)` marker renders WITHOUT a space → query `'AA Number(Optional)'`.
- SweetAlert sets `aria-hidden` on the rest of the page while open.
- Admin specs: no per-test mock reset — `vi.fn()` implementations persist.
- Load flakes: re-run a flaked suite solo before believing it; root `pnpm test`
  pins `--maxWorkers=2`. Never two admin suites in parallel in one workspace.
- Prettier NOT a gate. Gate on `tsc` + `eslint`.
- `formatMoneyInput` (user WIP) now strips invalid chars from the Amount field —
  the "blocks invalid payment amount 1e3" tests are stale against it (8 failures).

## Open threads

- **Pre-existing DB failures** (section 48, 58, 77) — unrelated to this work;
  reconcile in a separate pass.
- **Customer-purge review** (committed but unapplied migration) — 8 verified
  SQL defects, never tested. User declined the delete/deactivate UI.
- **RF Only / Refunded / Installment** payment statuses — not defined; deferred.
- **Finance queue Status chip** changed from lifecycle to payment-derived; lifecycle
  info still in details panel. Consider showing both if needed.
- **aria-label** on finance queue rows still says "Record a … payment" though
  click now opens details — accessibility follow-up.
- **Live authenticated visual pass** not done (no staff session).
- Production apply of `20261213…`+ migrations — approval-gated, not run.

## Verify (from root)

```sh
pnpm test                     # canonical gate
pnpm typecheck                # turbo 7 + tsc -p supabase (clean)
pnpm lint                     # 1 error (user WIP) + 24 warnings
pnpm check:env                # PASS
pnpm build                    # admin build green
pnpm test:db:local            # 1602/1606 (4 pre-existing failures)
pnpm test:db:harness          # blocked by pre-existing section 77
```
