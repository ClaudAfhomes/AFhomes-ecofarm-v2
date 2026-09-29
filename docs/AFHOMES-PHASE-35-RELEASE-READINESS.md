# AFHOMES Phase 35 — Release Readiness

## 1. Release candidate overview

AF Homes Ecofarm V2 on branch `preview/afhomes-rebuild`: React 19 + Vite 8 SPAs (public + customer portal on `/`, staff console on `/admin`), one Vercel Function (`api/router.ts`) serving `/api/v1/*` and `/health`, Supabase Postgres + Auth. Phases 18–33 PASS, Phase 34 PASS WITH BUSINESS DECISIONS REQUIRED. No feature work in this phase; this document is the go/no-go record.

## 2. Current branch/commit state

- HEAD `cbc61ed` ("feat: complete phase 25 role-specific dashboards"), in sync with `origin/preview/afhomes-rebuild` (no ahead/behind).
- Last pushed checkpoint before this work: `cbc61ed` itself; earlier confirmed push `3a9c6a9` (phases 19–24).
- Uncommitted: 32 modified + 20 untracked files, all Phase 26–35 work (no unrelated work mixed in). Classes: (C) modified/untracked phase work; (D) local-only build output (`dist/`, `vercel-static/`, `.tmp-bin/`, untracked and gitignored); (E) nothing secret is staged — only `.env.example` files are tracked and the secret scanner is green. Nothing has been committed or pushed in this phase.

## 3. Phase status summary

18 PASS · 19 PASS · 20 PASS · 21 PASS · 22 PASS · 23 PASS · 24–29 PASS WITH NON-BLOCKING ISSUES (documented flakes/fake limitations, none load-bearing) · 30 PASS · 31 PASS (887-check E2E) · 32 PASS (55-item security UAT) · 33 PASS (responsive, browser UAT deferred) · 34 PASS WITH BUSINESS DECISIONS REQUIRED (register + decision sheet, one wording fix).

## 4. Test summary

`pnpm test`: api 1081 · admin 252 · web 145 · ui 59 · shared 22 · contracts 32 · config 6 — all green. `pnpm test:db:local`: 887/887 on disposable PostgreSQL 18.4 (all 19 migrations from clean). `pnpm test:db:harness`: 13/13 (clean run + injected-fault non-zero path with cleanup). Typechecks, lint (0 errors), env isolation (source + built), and production build all green.

## 5. Migration state

Local: 19 `afhomes_` migrations (listed in §9 of the dry-check output; `pnpm db:migrate -- --check` valid, nothing applied). Remote: **unverifiable from this environment** (no `SUPABASE_ACCESS_TOKEN`, no `SUPABASE_DB_PASSWORD`, no linked project). Last confirmed remote state was 18/18 before the Phase 19 migration, so the release plan assumes remote is at 18 and must apply exactly `20261013000001_afhomes_phase19_card_plan_description.sql` with explicit approval. That migration is additive/widening-only and idempotent (nullable `description` column; two CHECKs relaxed, never tightened; header validation queries; documented down path), proven from clean by `test:db:local`.

## 6. Supabase readiness

Project ref `ikaevepedpqygdlipsei`. Reachability, Auth config, redirect URLs, buckets, SMTP state, advisors: **unverifiable from this environment** (no credentials, no CLI session). Code-side posture is proven: RLS invariants return empty on real PG, private buckets stay private (only `afhomes-cms-media` public by design), SELECT-only browser grants, no routine grants to anon. Operator must verify the hosted project per the manual-actions list before migration + deploy.

## 7. Vercel readiness

No Vercel CLI in this environment; production/preview deployment states, env scopes, and domain config are **unverifiable here**. Repository side is correct: `vercel.json` pins the exact build chain (`pnpm typecheck:deploy && node scripts/prepare-vercel-env.mjs && pnpm exec turbo run build && node scripts/assemble-vercel-output.mjs`), `VITE_API_BASE_URL=/api/v1`, single function with `includeFiles: packages/**`, rewrites for `/api/v1/*`, `/health`, `/admin/*`, public routes with marketing catchall, and the single daily `/health` cron. Local `pnpm build` succeeds for both SPAs. Operator must confirm Vercel-side state per manual actions.

## 8. Auth readiness

Code paths proven (invite, recovery without enumeration, activation claim, redirect validation in `admin-url`). Hosted values — Site URL `https://afhomes-ecofarm-v2.vercel.app`, redirect allowlist (`https://afhomes-ecofarm-v2.vercel.app/**`, `https://*-afhomes.vercel.app/**`, `http://localhost:5173/**`), Super Admin `af@admin.com` profile/assignment state — **require operator verification** in the dashboard. Do not reset credentials blindly.

## 9. SMTP readiness

**NOT VERIFIED — treat as not ready.** Last known state: Supabase Auth logs showed `550 "The afhomesecofarm.com domain is not verified"`, blocking staff invitations. Intended sender `no-reply@afhomesecofarm.com` via `resend` user + Resend API key. No credentials exist in this environment to re-check Resend DNS or Supabase SMTP settings, and the key is never printed. Email-dependent flows (staff invite, password recovery) must be re-proven live before launch; application code needs no change (mocked-transport tests green).

## 10. Storage readiness

Code + disposable-DB posture proven (private customer/OST/receipt buckets, 10 MiB image/pdf allowlists, per-request signed URLs, no path leakage). Hosted bucket/policies state requires the same operator check as §6.

## 11. Security readiness

Phase 32 PASS: 55-item UAT green (26 new handler tests + existing regression suites), RLS invariants empty on real PG, secret scanner green (planted-secret liveness), env boundary green in source and built bundles. One action: a service-role key was once pasted in conversation history — treat it as compromised; rotation status **cannot be confirmed here** and is a release-gating manual action.

## 12. Business-decision gates

Per `docs/AFHOMES-PHASE-34-BUSINESS-RULES-REGISTER.md`: D-12 is the single conditional code blocker (one membership per customer is schema-enforced; a fully-paid second sale strands at activation). All other P0s are procedure/confirmation gates, not code blockers (manual qualification gate, no-refund fails-closed, persist-forever points, terminal validity). Required: (a) D-12 policy + launch restriction notice if repeat purchase is out of scope; (b) written refund, payout, and qualification procedures; (c) confirmations on D-04/D-05/D-18. Decision sheet in the register is blank pending management.

## 13. Browser UAT status

**NOT RUN — no desktop browser is connected to this session** (browser tooling reports disconnected; repeating calls cannot help). Structural responsive coverage is strong (50 render tests across shell, 10 table pages, portal, and public routes at 320–1440 widths; Phase 33 PASS), but pixel-perfect screenshot UAT at 390×844 / 768×1024 / 1440×900 for the 14 representative screens was deferred and remains a manual gate. Exact checklist is in §18 below.

## 14. Release blockers

1. Worktree uncommitted (Phases 26–35) — commit per §16, push, Preview deploy first. Procedural.
2. D-12 decision if repeat purchase is in launch scope — management.
3. Migration 19 not yet applied to production (assumed remote 18; verify, then apply with explicit approval). Procedural.
4. SMTP unverified since the 550 domain failure — re-verify or launch with email flows declared out-of-scope. Managed-service.
5. Service-role key rotation unconfirmed after past exposure — rotate + confirm. Security.
6. Live browser UAT not run (no browser in this environment). Manual gate.
7. Hosted Supabase/Vercel/Auth state unverified from here (no credentials/CLI). Operator checks.

## 15. Non-blocking watch items

Management sign-offs on P1/P2 register items; screenshot UAT pending (covered by blocker 6 procedurally); `overdue` dead status value; free-text payment methods; unlimited free reprints; manual-only OCR (resourcing preference); public `overflow-x:clip` masking future over-wide elements.

## 16. Deployment sequence

1. Record management decisions (D-12 + procedures + confirmations).
2. Commit the worktree per boundaries below; push `preview/afhomes-rebuild`; tag `v2.0.0-rc.1` (proposal only).
3. Preview deploy; run Preview smoke + browser UAT (§18).
4. Verify SMTP/Auth live (invite + recovery to a designated test address).
5. Confirm Supabase backup position for the project plan (do not assume PITR).
6. `pnpm db:migrate -- --check`, then apply migration 19 with explicit approval.
7. Promote/deploy production app; run production smoke (§18, read-only + designated records only).
8. Monitor first 30 minutes (§19); roll back per §17 on any blocker symptom.

Recommended commit boundaries (or one squashed RC if history cleanliness is secondary): Phase 26 finance/commission · Phase 27 documents/OCR · Phase 28 CMS · Phase 29 analytics · Phase 30 reports/audit · Phase 31 E2E harness · Phase 32 security UAT · Phase 33 responsive · Phase 34 register/wording · Phase 35 release docs. Do NOT auto-commit; owner reviews each boundary first.

## 17. Rollback plan

- App: redeploy the previous production deployment in Vercel (identify it before promoting); release tag `v2.0.0-rc.1` marks the candidate.
- Database: migration 19 is the only pending change; its down path is documented in-file (drop `description`, re-tighten two CHECKs — fails if widened-rule rows exist, so snapshot `card_plans` first). No data migration is involved; snapshots and ledger rows are untouched by the file.
- Auth/edge: no Auth config change is part of this release.

## 18. Smoke-test plan

Public: homepage, contact, published CMS content, OST registration (no submit unless test path), footer/nav. Auth: admin login, recovery request (test address only), customer login. Admin (read-only): dashboard, staff, roles, card plans, sales, finance queues, memberships, redemption catalog + POS load (no deduction without a designated test member), genealogy, reports + export, CMS read. Customer: own dashboard/card/points/payment/redemption history. Security: customer token on `/admin/*` denied; logged-out admin routes redirect. Browser matrix 390×844 / 768×1024 / 1440×900: no blank pages, no blocking console errors, no broken chunks, no overflow, no dead nav, no permission-hidden-link regression, correct hosts in email links.

## 19. Monitoring plan

First 30 minutes: `/health` (200, no secret leakage), API 5xx rate, Auth invite/reset errors, RPC/DB errors, storage grant errors, payment verify/activation/redemption error spikes, Vercel function logs, Supabase Auth logs, `audit_events` for the release window. No new monitoring infrastructure is required.

## 20. Final go/no-go checklist

- [ ] D-12 decided + launch restriction notice published if single-card
- [ ] Refund, payout, qualification procedures written and signed
- [ ] Worktree committed, pushed, tagged `v2.0.0-rc.1`
- [ ] Preview deploy green + full browser UAT executed
- [ ] SMTP re-verified live (or email flows scoped out in writing)
- [ ] Service-role key rotated + confirmed
- [ ] Supabase project verified (migrations at 18, Auth URLs, buckets, advisors triaged)
- [ ] Backup position confirmed for the project plan
- [ ] Migration 19 applied with explicit approval; app tables verified
- [ ] Production deploy + smoke matrix executed
- [ ] 30-minute monitoring clean

**Verdict: NOT READY FOR RELEASE** — the code is green and fails closed, but blockers 1–7 above are all outside the code and unverified from this environment. The correct next state after the listed manual actions is READY, with no further engineering expected.
