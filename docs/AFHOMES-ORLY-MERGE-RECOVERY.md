# Orly merge and authentication recovery checkpoint

Date: 2026-10-11 (Asia/Singapore).
Worktree: `C:\Users\SSD-CLAUD\Documents\AFhomes-ecofarm-v2-claud-promote`.
Branch: `claud/develop`; HEAD remains `0a2bd52`.
Merged source: `origin/orly/develop` at `c6c357691bddf66087fa140f56075d6928f3f83c`.

## Actual integration result

The non-committing merge is active. Its 87 changed paths are staged, including Orly's UI and compatible backend changes. No merge commit or push was made.

One content conflict was resolved in `apps/admin/src/features/business/final-blockers.spec.tsx`: retained Claud's SweetAlert focus-restoration wait and Orly's `await user.selectOptions(select, '')`, removed the undefined input references, and kept final assertions once. `OfficialFormsPages.spec.tsx` merged automatically. No unmerged index entries or source conflict markers remain.

All 15 previously uncommitted recovery files were saved in `stash@{0}` (`pre-orly-merge-auth-recovery-preserved`), restored identically, and remain separate from the staged merge. The stash is retained. The debug probe remains untracked and must not be committed.

A newly introduced cancellation race was reproduced RED: a concurrent payment changed a draft to payment-in-progress, but cancellation returned 200 and overwrote that status. GREEN repair in `api/_handlers/sales.ts` uses an atomic status-conditional update and returns 409 when the draft changed. The regression is in `api/_handlers/sale-cancel.spec.ts`. No financial policy or migration was changed for this repair.

## Configuration and HTTP evidence

The core committed staff authentication/configuration files match between the branches. The customer portal differs because Claud has additional points/refund functionality; it was preserved.

Both inspected local configurations use `https://ikaevepedpqygdlipsei.supabase.co`, API base `/api/v1`, and have existing public and server variable names configured. The second checkout is a comparison candidate, not verified as Orly's actual local machine/configuration.

Vercel's AF Homes project uses the same public Supabase URL and API base for Preview and production. Public auth keys are configured in both. `SUPABASE_SERVICE_ROLE_KEY` exists only for production. No key values were printed or copied, and no environment variables were modified.

| Boundary | Actual result |
|---|---|
| Local API port 3000 before recovery | Unreachable; backend not running |
| Local API after starting with existing config | Health 200; both auth endpoints 401 for synthetic invalid token |
| Both local Vite API proxies, ports 5174 and 5173 | Both auth endpoints return JSON 401 |
| Supabase Auth health | 200 |
| Current Orly Preview `afhomes-ecofarm-v2-p8wyvpxch-afhomes.vercel.app` | Both auth endpoints 500, missing server configuration |
| Orly branch alias `afhomes-ecofarm-v2-git-orly-develop-afhomes.vercel.app` | Both auth endpoints 500 |
| Current Claud Preview `afhomes-ecofarm-v2-73becjlni-afhomes.vercel.app` | Both auth endpoints 500 |
| Production `afhomes-ecofarm-v2.vercel.app` | Health 200, staff session 401 for invalid token, portals endpoint 404 on older router |

The initial checks above are connectivity/denial checks. Following the owner's real local logins, sanitized API logs confirmed staff session and portal requests returned 200, followed by staff analytics and sales-trend 200. Customer portal verification, profile, membership and points ledger returned 200. This confirms actual local account access without extracting session tokens or passwords; browser layout and reload persistence were not independently observed. The user's reported working Orly online URL was not supplied.

The saved blank-key fallback and URL-aware client cache fixes remain useful: each has a demonstrated RED/GREEN regression. The keyless read-only session repair also remains relevant to Preview. It requires the prepared auth-only `20261122000001_afhomes_readonly_auth_recovery.sql` plus release of the local code; neither has been applied/deployed. It does not depend on the pending financial migration chain. Financial operations still require an appropriately configured backend.

## Verification

- Focused UI conflict/forms tests: 67 passed across 2 files.
- Affected navigation/authorization/customer/cards/reservation UI: 138 passed across 9 files.
- Final affected API tests, including points, ownership, cancellation and auth: 400 passed across 15 files.
- `pnpm typecheck`: PASS, including API and Supabase script types.
- `pnpm lint`: PASS; existing warnings, zero errors.
- `pnpm build`: PASS for both SPAs; initial merged build uncached, final unchanged SPA build used Turbo cache.
- `test-vip-chain.mjs`: 95 checks PASS with real disposable SQL and mocked-Auth HTTP. Includes concurrency, compensation, repayment limits, four-decimal conversion and RLS invariants. Disposable cluster removed.
- `test-auth-recovery.mjs`: 31 disposable SQL checks PASS, including own-session permissions, denials, idempotent migration application and transaction rollback. Disposable cluster removed.
- Staged and unstaged `git diff --check`: PASS.
- Historical database migrations: unchanged by the merge.

## Remaining gates

Real local Staff and Customer account access is VERIFIED through the owner's sign-in and successful authenticated server requests. Managed Storage and complete authenticated financial browser E2E remain NOT VERIFIED.

The real customer session exposed the exact schema blocker: GET /customer/points/position returned 500/PGRST202 because public.customer_points_position(p_membership_id) is absent from the managed PostgREST schema cache. The RPC is introduced by 20261104000001, corrected by 20261115000002 and extended for reservations by 20261118000001. These depend on the pending points schema; applying the November 15/18 function alone is not a safe remedy. November 4 contains the prohibited legacy points reset, so no shared apply was attempted. Existing ledger reads succeeded; no balance was fabricated or reset. Local pages are available at `http://127.0.0.1:5174/admin/login` and `http://127.0.0.1:5173/customer/login`.

Preview still needs approved read-only auth schema/code release; do not restore privileged production-write credentials there. Shared schema changes require the owner's explicit gate and verified backup. The pending November 4 migration contains a legacy points reset; do not run it as part of a bulk migration.

Merge conflicts are resolved and local checks pass. Commit/push/deployment remains gated; the tested working tree includes saved auth changes which are currently unstaged. A merge commit using only the present index would exclude them. No Supabase writes, migrations, balance resets, production data exports, backup cleanup, commit, push or deployment occurred.
