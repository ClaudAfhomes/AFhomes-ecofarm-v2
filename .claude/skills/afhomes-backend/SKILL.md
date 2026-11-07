---
name: afhomes-backend
description: Work on the AF Homes API — /api/v1 routing, handlers, Better Auth sessions, staff RBAC vs customer ownership, Zod contracts, error contracts and audit logging on the native MongoDB runtime. Use for any api/ change.
---

# Backend (api/)

## Map
- Dispatch: `api/router.ts` → `api/_lib/router.ts`; hosted `api/server.ts` → `api/_lib/hosted-runtime.ts`;
  local `api/scripts/dev-mongodb-admin.ts` (`pnpm dev`, API :3084).
- Handlers `api/_handlers/`; native logic `api/_lib/*.mongo.ts`; shared plumbing `handler-kit.mongo.ts`.
- Staff authz `api/_lib/afhomes-access.mongo.ts`; customer ownership `customer-access*`; auth `auth*.ts`.
- Contracts `packages/contracts/src/schemas/`; features `packages/shared/src/features.ts`.
- Supabase handlers/fake (`api/_lib/testing/supabase-fake.ts`) are legacy; Mongo tests use `testing/mongo-replica.ts`.

## Procedure
1. `rg -n "<route or family>" api/_lib/router.ts api/_handlers` to find the handler.
2. Read the handler + its `.mongo.ts` + spec. Check the contract schema.
3. Write/extend a failing spec (HTTP-level where one exists).
4. Implement: validate → authorize (per request) → transaction (idempotent) → audit → response.
5. `pnpm --filter api exec vitest run <specs>`; `pnpm --filter api typecheck`; `pnpm check:env`.

## Rules
- Errors: stable codes/messages, never raw Mongo errors or secrets.
- Unported/blocked writes fail closed (501/403); do not "complete" them by bypassing gates.
- Mutations audit field names, never values of private fields.
- Never mount the Better Auth admin handler; never add MFA/invitations back without approval.

## Done when
Focused specs + typecheck pass; authorization regressions untouched or extended.
