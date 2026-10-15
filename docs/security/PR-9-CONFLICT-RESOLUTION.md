# PR 9 conflict resolution

Source: `claud/develop` at `6f176ed795b12d81f4e077387ecb53f8200570e5`.
Target integrated: `develop` / `orly/develop` at
`6b40d352dca7d0583997c1212032a3447d812da6`.

## Release scope

Retain the completed stored AA display, search and copy feature, acceptance of
official and historical AA identifiers, existing staff-role relationship fixes
for reports and OST sponsors/imports, the public search route rewrite, and
deployment environment validation. No new numbering is allocated for display.
Existing authorization, disclosure and accreditation approval paths remain.

Exclude the paused Customer/VIP numbering rollout and migration-dependent
application hierarchy/recommender changes from this merge's resulting tree.
Their preparation remains in the original commits and the separate local
`release/local-numbering-reconciliation` worktree. This merge does not rewrite
history, execute SQL, renumber existing records or authorize that release.

## Nine conflicts

| File | Resolution |
| --- | --- |
| `api/_handlers/customers.ts` | Keep current develop customer creation, company fields, lookup, update and import compatibility. Exclude proposed numbered-creation RPC integration. |
| `api/_handlers/official-forms.ts` | Keep current develop application/reservation workflows and contributor aliases. Exclude proposed numbering and alternate hierarchy integration. |
| `api/_handlers/phase2.spec.ts` | Keep develop's tests for the retained customer/sale implementation. |
| `api/_handlers/sales.ts` | Keep develop's sale submission, payment verification and commission behavior. Exclude proposed VIP RPC integration. |
| `apps/admin/src/features/business/official-forms-applications.tsx` | Keep develop's current form and submitted fields. |
| `apps/admin/src/features/business/official-forms-fields.tsx` | Keep develop's field components and reference behavior. |
| `docs/security/evidence/checkpoint-vercel-verification.json` | Preserve the source bytes under `evidence/archive/checkpoint-vercel-verification-2026-10-14.json`. Historical observation only; not current deployment or release-readiness evidence. |
| `docs/supabase/CURRENT-SCHEMA.sql` | Keep develop's schema reference; do not combine unverified snapshots. |
| `packages/contracts/src/schemas/official-forms.ts` | Keep develop's matching form contracts and validation. |

All other contributor changes are retained through the merge. The resulting
`supabase/migrations` tree must equal develop exactly. No numbering migration,
new RPC dependency, company-field installer or database deployment is included.
In particular, source-only migrations `20261203000001`, `20261203000002`,
`20261204000001` and `20261204000002` are excluded from the resulting release tree;
their original SQL remains available in the source history and preparation work.

## Verification

Local checks completed on 2026-10-15:

- `pnpm test`: PASS, 3,853 tests across 272 files (API 2,255; Admin 809;
  Web 252; contracts 269; UI 221; shared 41; config 6).
- Coverage includes staff/customer/OST login, password recovery, session
  restoration/clearing, authorization, customer company fields/imports,
  applications, sales, payments, commissions, memberships and stored AA display.
- `pnpm typecheck`: PASS, including the local Supabase TypeScript scripts.
- `pnpm lint`: PASS, no errors; existing warnings remain.
- `pnpm build`: PASS for both SPAs; existing large-chunk warnings remain.
- No unmerged index entries; the proposed PR diff passes `git diff --check`.
- Migration tree and the nine retained develop files match the target exactly
  (except the evidence file, which is archived as documented above).
- Archived evidence matches the original source Git blob byte-for-byte.

The suites also log existing test-environment `scrollTo`/navigation notices and
nested skeleton markup warnings; they do not fail this run. These unrelated
warnings are preserved rather than hidden or used to expand this patch.

Preview is published only by pushing the verified reconciliation to
`claud/develop`. Production and shared database changes remain out of scope.
Automated tests do not establish authenticated live customer or staff acceptance.
