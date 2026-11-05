# Per-customer directory summaries - consistency risks (design review only) - 4 November 2026

Status: **deferred, not approved, not implemented.** No stored summary field, backfill, index or
schema change exists. This document records what any future design must solve first.

## What a summary would cache

The customer directory derives, per customer, at query time (`api/_lib/customer-directory.mongo.ts`):
VIP tier (catalog `card_plans.code` of the latest purchase's `plan_id`), membership status, derived
category, payment status and total verified payments. At 10,000 customers these filters take about
1.2 s locally after Phase 2; a stored summary would make them indexable.

## Source of truth

Payments, sales, reservations, applications, memberships and plans stay authoritative. A summary
would be a rebuildable cache, never an input to money, activation or commission decisions.

## Consistency risks by event

| Event | Writers (evidence) | Risk for a stored summary |
| --- | --- | --- |
| Payment recorded / verified / rejected / voided | `sales.mongo.ts:588, :642, :680`; `purchase-records.mongo.ts:585, :638, :782`; imports `historical-import.mongo.ts:345-388`, `legacy-member-create.mongo.ts:92-96` | Every path must recompute totals and payment status in the same transaction. Verification also sets `payment_verified_at`/`fully_paid_at` on the sale, so the summary depends on two documents changing together |
| Sale confirmation, cancellation | `sales.mongo.ts:918-927`; official-forms submit/execute (`official-forms.mongo.ts:1911-1941`) | Category and "latest purchase" change; cancelled sales and non-submitted reservations are excluded by the directory, so the recompute must apply the same filters (status not `cancelled`; reservations `submitted`/`executed` without `sale_id`) |
| Membership activation | `sales.mongo.ts:807, :849`; `historical-membership.mongo.ts:120, :144`; `legacy-member-create.mongo.ts:156` | Activation must stay idempotent and server-checked; a summary must never drive activation. Historical activations derive `activated_at` from a Manila date |
| Membership expiry / suspension / cancellation | membership transitions (`lifecycle.ts` MEMBERSHIP_TRANSITIONS); customer suspension `customers.mongo.ts:174` | **EXPIRED is time-dependent** (`expires_at <= $$NOW`, `customer-directory.mongo.ts:244`, `:296`): it changes with no write. Store `expires_at` and status; derive EXPIRED at query time. Never store "expired" |
| Tier | catalog `card_plans.code` via the sale's `plan_id` | Catalog edits would silently change history if a code were copied or recomputed from a mutable catalog; store the frozen `plan_id` and resolve the code, or decide explicitly that tier follows the catalog |
| Payment reversal / refund | none: verified payments are terminal (`PAYMENT_TRANSITIONS.verified = []`); no refund state exists | A future reversal/refund flow must recompute in its own transaction and needs its own business approval |
| Historical / workbook imports | `historical-import`, `import-source`, `import-claims`, `import-continuation`, `purchase-records`, `legacy-member-create` (most accept a caller session) | Bulk paths must call the same recompute function per affected customer inside their transactions; partial imports must not leave summaries ahead of or behind source rows |

## Cross-cutting risks

- **Concurrency.** Two transactions changing different payments of one customer could each write a
  summary computed from a stale snapshot. Recompute-from-source inside the transaction (not
  delta increments) plus MongoDB write-conflict retry avoids lost updates; the summary document
  must be written in every such transaction so conflicts are detected.
- **Coverage.** About 15 modules write the source collections. Any missed writer silently
  produces stale filters; a single shared recompute function and a test that enumerates writers
  are required.
- **Reconciliation.** A read-only reconcile command must compare stored summaries with fresh
  derivation and report drift; any repair/rebuild is a separately approved data write.
- **Failure recovery.** Transaction aborts roll the summary back with the source change. A
  partially applied backfill must be resumable and idempotent.
- **Index maintenance.** New compound indexes (tier/status/category with `created_at`) need their
  own Atlas approval and size review after a backfill.
- **Privacy / RBAC.** Summaries hold no PII; directory access rules are unchanged; the summary must
  never be exposed to customers or used for authorization.
- **Historical accuracy.** Summaries describe current state only; historical sale snapshots and
  financial records are never rewritten.

## Prerequisites before any implementation approval

1. Owner decision on tier source (frozen plan vs current catalog code).
2. Inventory test of every writer of the source collections.
3. Shared recompute function with parity tests against the current derivation.
4. Read-only reconcile tool.
5. Separate approvals for schema fields, backfill and indexes.
