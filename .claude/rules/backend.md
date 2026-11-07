---
paths:
  - "api/**"
  - "packages/contracts/**"
  - "packages/shared/**"
---

# Backend rules

- One router: `api/router.ts` → `api/_lib/router.ts`; handlers in `api/_handlers/`; native Mongo
  logic in `api/_lib/*.mongo.ts`. Keep underscore dirs (not separate functions).
- Every mutation: parse with the `@afhomes/contracts` Zod schema, authorize per request
  (staff RBAC `afhomes-access*.ts`; customers by ownership `customer-access*.ts` — never mix).
- Client never sends prices, balances, statuses or actor ids; derive them server-side.
- Writes that touch several collections use a Mongo transaction with an idempotency key; audit inside it.
- Error responses never include raw Mongo errors, stack traces, secrets or connection strings.
- Business dates use Asia/Manila (see 2026-11-03 UTC/Manila defect).
- Respect `FEATURE_FLAGS` / `isFeaturePathEnabled` (`packages/shared/src/features.ts`); never widen it.
- Never mount the Better Auth admin handler.
- New contract types live in `packages/contracts`, never re-declared in apps.
