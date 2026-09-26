# `legacy/` — retired JAD Realty platform

Everything in this folder is **frozen historical reference for the JAD Realty
platform**, which AF Homes Ecofarm replaced. Nothing here is built, imported,
type-checked, deployed, or applied to any database.

It is **not** a workspace member. `pnpm-workspace.yaml` globs `apps/*`,
`packages/*`, and `api` at the repo root, so `legacy/jad-application/apps/*` is
never resolved by pnpm, Turborepo, or TypeScript.

## Contents

| Folder | What it is |
|---|---|
| `jad-application/` | The full JAD SPA pair (`apps/web`, `apps/admin`) — realty catalog, member registration, MLM genealogy, e-wallet, commissions, withdrawals, vouchers, CMS. |
| `jad-migrations/` | 72 JAD SQL migrations (2026-08-29 → 2026-10-20). Defines the JAD schema: `Member`, `Role`, `MemberRole`, `Commission`, `Wallet`, `LedgerEntry`, `Voucher`, `SystemConfig`, `ph_provinces/cities/barangays`, and the money functions (`sale_qualify`, `withdraw_reserve`, `commission_clear_batch`, …). |
| `jad-supabase/` | JAD seed, PSGC location importer, and provisioning scripts. |

## Why it is kept

The AF Homes schema shares **no tables** with JAD — every JAD table name
(`Member`, `Commission`, `Wallet`, `LedgerEntry`, `SystemConfig`, …) is absent
from `supabase/migrations/`. The JAD code was therefore dead weight that
inflated the build, the router, and the contract surface, and it has been
removed from the live tree.

The JAD schema and app are preserved here for two reasons:

1. **Precedent.** The JAD work encodes hard-won lessons worth not re-deriving
   (exact-decimal money handling, atomic DB-function money transitions,
   RLS-invariant auditing, the single-Vercel-function deploy shape).
2. **Provenance.** If a JAD production database must ever be reconciled or
   decommissioned, the exact schema that was deployed is here.

## Rules

- **Never** copy a file from here into the live tree without re-deriving it
  against the AF Homes schema and `AGENTS.md` invariants. JAD DTOs, table
  names, statuses, and permission models do not carry over.
- **Never** apply anything in `jad-migrations/` to an AF Homes database. The
  runner enforces this: `supabase/apply-migrations.ts` throws if any file in
  `supabase/migrations/` lacks an `afhomes_` prefix.
- Do not edit these files. If something here is wrong for reference purposes,
  note it in the AF Homes docs instead.
