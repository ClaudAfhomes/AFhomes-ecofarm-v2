---
name: afhomes-sales-finance
description: AF Homes card sales, reservations/applications, payments (record/verify/reject/void), activation queue, commissions and payout markers, imported-payment claims. Use for any change touching money, sale lifecycle, Finance screens or commission logic.
---

# Sales and finance

## Sources
- Lifecycle SSOT: `packages/contracts/src/schemas/lifecycle.ts` (statuses + legal transitions)
- Pure rules: `api/_lib/commerce.ts` (+ spec); money helpers `packages/shared`
- Native: `api/_lib/*sale*.mongo.ts`, `commissions.mongo.ts`, `import-claims.mongo.ts`; `rg --files api/_lib | rg -i "sale|payment|commission|purchase"`
- Reports: `docs/mongodb/PURCHASE-NATIVE-VERIFICATION.md`, `CORE-WORKFLOWS-REPORT.md`,
  `IMPORT-CLAIM-RECONCILIATION-REPORT.md`, `LEGACY-FINANCIAL-IMPORT-REPORT.md`
- Policy status: `docs/business-rules/` (QLF, RATE, AUTH, CTL) — mostly SOURCE_DOCUMENTED, not approved.

## Invariants
- Exact-decimal text money; no floats. Only `verified` payments count; `recorded` is not money yet.
- Sales freeze price/down-payment/points/commission-rate snapshots; never recompute from catalog.
- Activation re-checks full verified payment server-side; idempotent.
- Claim recording reuses the purchase recorder and cannot verify money.
- Commission `final_qualification_pending → earned` is manual, permission-gated, audited, notes required.
- Payout is a reference marker (when/by whom), not money movement. No automatic clawbacks.
- Client sends no figures (price, balance, status, actor).

## Required checks before editing
Business-rules skill → lifecycle transition map → existing spec for the path → write failing spec.
Run `pnpm --filter api exec vitest run api/_lib/commerce.spec.ts` plus the handler spec.

## Never
Create real payment/commission records, alter financial history, or use mock results as production data.
