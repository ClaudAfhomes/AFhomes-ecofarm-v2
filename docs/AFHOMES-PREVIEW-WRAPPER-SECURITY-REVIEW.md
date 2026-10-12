# Preview Caller Wrappers — Security & Release-Readiness Review

Branch: `claud/develop`. Scope: `20261125000001_afhomes_preview_caller_wrappers.sql` + keyless handler branches. Local review only; no shared database was touched.

## Verdict: PASS (local implementation)

The implementation is minimal, correctly routed, and ready for owner review. No blocker before commit. Shared-database preflight/apply still needs separate approval and live history verification.

## 1. Migration-count reconciliation (repo evidence only)

| # | Measure | Value |
|---|---|---|
| a | Migration files in release range (`>= 20261102`) | **28**, zero unlisted, zero missing |
| b | Entries in `legacy-points-allowlist.json` | **28** (27 prior + wrappers), 28/28 SHA-256 match |
| c | Pending if live history holds 40 records incl. `20261122` auth repair | **27** (26 legacy + 1 wrappers), ordered Nov 02 → Nov 25 |

Do not call this a 26- or 28-file apply: the pending set is 27 **only if** live history contains exactly the 39 pre-existing records plus the Nov 22 repair. Final pending count must be confirmed by live read-only history verification (`select version from supabase_migrations.schema_migrations`, plus balance/ledger re-checks) immediately before any apply. The two orphan migrations (`20261030`, `20261031`) remain excluded and on disk.

## 2. Wrapper inventory (41 public + 3 private, 0 duplicates, 0 unused)

Every public wrapper has a real handler caller (verified by search over `api/_handlers`).

### Customer (8): identity is `auth.uid()` → `customers.auth_user_id`, never a parameter

| Wrapper | Route / handler | Check | Delegates to |
|---|---|---|---|
| `preview_customer_claim` | POST `/points/claim` (`points.ts`) | active customer | `claim_earning_points` (customer id bound) |
| `preview_customer_claim_preview` | POST `/points/claim/preview` | active customer | own-row SELECT (hash match server-side) |
| `preview_customer_decide` | POST approvals `:id/decision` (`_point-approvals.ts`) | active customer | `decide_point_redemption_approval` (ids bound) |
| `preview_customer_position` | GET `customer/points/position` | active customer | own membership + `customer_points_position` |
| `preview_customer_ledger` | GET `customer/points/ledger` | active customer | own account page + owned reference joins |
| `preview_customer_approvals` | GET `earning/approvals` | active customer | own quotes (limit 50) |
| `preview_customer_refunds` | GET `customer/refunds` | active customer | `service_refund_history(null, own id)` |
| `preview_customer_reissue` | POST `customer/membership/credentials` | active customer | `reissue_membership_credentials` (ids bound) |

### Staff writes (20): `mutation_actor_role(auth.uid(), module, action)`, actor bound

`save_service` (catalog create/update), `service_photo` (catalog update; op allowlisted, append path needs Storage so Preview upload 503s first), `set_policy_active` (catalog update; kind allowlisted), `tier_discount_create` / `earning_rule_create` / `redemption_rule_create` / `redemption_rule_patch` (catalog create/update; direct inserts with the same audits the handlers emit), `create_purchase` (sales create; gross fixed `'0.00'`), `record_payment` (sales create), `verify_payment` (payments update; decision allowlisted), `prepare_quote` (redemption create), `complete_purchase` (sales create), `reverse_purchase` / `adjust_points` (redemption update), `create_claim` / `reissue_claim` (redemption create), `refund_points` / `cancel_reserved` / `manage_refund` (payments update; refund op allowlisted) / `reconcile_receipt` (payments update).

### Staff reads (13): `has_permission_for_user(auth.uid(), module, 'view')`, scoped queries

`purchases` (sales-customers/payments view → all; else sales view → own), `payments`, `claim`, `claims`, `summary`, `settlement` (payments-view-else-sales-view, mirroring the handlers), `services`, `tier_discounts`, `earning_rules`, `redemption_rules` (sales-or-catalog view), `point_refunds`, `refund_history` (payments view), `resolve_member` (redemption view; hashes server-side, returns no-PII preview + authoritative balance).

### Private helpers (3, `service_role`-only, never browser-reachable)

`preview_require_staff`, `preview_require_customer`, `preview_customer_membership`.

Deliberately no wrapper: `request_point_redemption_approval` (called only inside `prepare_customer_point_redemption`), governance writes, invitation/password rotation (need Auth admin API), Storage byte paths, Phase-4 till redeem (retired product surface).

## 3. Grant model (verified on real PostgreSQL)

- All 44 functions: fixed `set search_path = pg_catalog, extensions, private, public, pg_temp` (44/44 checked).
- The only dynamic `EXECUTE` is the one-time grant loop over `regprocedure` (owner, migration time) — no caller-influenced dynamic SQL anywhere.
- All 41 public wrappers: revoked from `public, anon`, granted to `authenticated` only (82 privilege checks green). No table/RLS grant changed.
- No wrapper accepts actor/customer/price/rate/balance/permission inputs: verified by signature audit (receipt amounts, refund values and configuration payloads are domain inputs validated by contracts + trusted RPCs, same as the service path; photo/receipt bytes stay service-side).
- Denials raise `42501`/`P0002` with generic codes before any row access; stranger-customer probes return nothing; hash columns and government IDs are never selected for output (hash usages are match-only).

## 4. Verified denied paths (all green on disposable PG + handler specs)

No-permission staff (each module), stranger customer (claim/preview/decide/position/reissue), anon on all 41, direct authenticated `INSERT`/`UPDATE` on VIP tables, forged actor/amount params (no such parameters exist), duplicate references replay idempotently, unknown identifiers resolve null. Keyless non-covered paths answer explicit user-safe 503s: photo/receipt upload/download, public catalog, retired Phase-4 catalog/history, admin mutations, customer membership reads fall back to caller RLS.

## 5. Test evidence (exact)

- `packages/db-testing/scripts/test-preview-wrappers.mjs`: **165/165 PASS**, disposable loopback PG, exit 0.
- `api`: **106 files, 2114/2114 PASS** (incl. 15 keyless-branch pins).
- `test-legacy-points-recovery.mjs`: **51 checks PASS** (wrappers ride the atomic batch; cutover/preservation intact).
- `test-vip-chain.mjs`: **95 checks PASS** (harness regression).
- `pnpm typecheck` exit 0 (7 turbo tasks + supabase half), `pnpm lint` exit 0, `turbo run build` exit 0, `git diff --check` clean.

## 6. Deliberate Preview limitations (not defects)

No photo/receipt bytes, no public service list, no staff invitation/password rotation, no governance writes, no forced-password-change completion, no Phase-4 till redeem, catalog rows without signed image URLs, customer membership/payment reads via caller RLS (needs owner browser confirm).

## 7. Environment finding (local-only, recorded)

The disposable PG 18 beta does not exit on `RETURN QUERY` (proven: sequential return-queries both execute). Every `return query` in the new migration is followed by a bare `return;` (documented in-file). Shared PG 17 is unaffected; no historical SQL was changed for this.

## 8. Remaining manual gates (owner)

1. Live read-only history/balance/ledger revalidation (counts above assume 40 records incl. Nov 22).
2. Fresh encrypted backup + checksum before any apply.
3. Explicit approval for the 27-file atomic apply (single transaction, preservation runner).
4. Post-apply verification (10 accounts, 167000, ledger hash, 41 wrapper grants, history rows).
5. Owner browser sign-in on Preview (passwords never leave the owner); financial QA with synthetic records only.
