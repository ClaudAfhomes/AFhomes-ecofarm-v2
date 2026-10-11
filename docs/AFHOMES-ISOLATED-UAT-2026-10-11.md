# AF Homes isolated managed UAT plan ? 2026-10-11

**Prepared only. No project, account, seed, migration or deployment was created.** Local PostgreSQL and offline tests cannot replace managed Supabase Auth, PostgREST, Storage and real browser/hardware evidence. Current connector exposes only an unrelated inactive project; do not reuse it or infer AF Homes target health from it.

## Owner approvals required before setup

1. Resolve the partial-refund earned-award ordering decision identified in the audit; implement the approved rule with RED/GREEN evidence. Legacy claims without reliable snapshots remain blocked for partial refund. Supported options are documented adjudication using verified original commercial evidence, or a separately approved forward-only snapshot migration/backfill restricted to provable values; never infer historical eligibility from today's rule.
2. Approve the exact local commit allowlist and commit. Exclude packages/db-testing/scripts/probe-tmp.mjs, .tmp-bin, logs, environment files and secrets. Deploy only from the approved committed revision, never a dirty CLI upload.
3. Authorize creation of a separate synthetic-only Supabase test project and separate Vercel test project, precise migration allowlist, test invitations/seed and Preview deployment. These are separate approvals; this plan supplies no authorization.
4. Record target refs/URLs and compare guards against production. Never attach test credentials to the production Vercel project or mutate shared customer records. Leave production disabled for this test release.

## Environment and migration preparation

Use the entire ordered inventory in AFHOMES-MIGRATION-INVENTORY-2026-10-11.md. For a new empty managed project, platform Auth/Storage objects already exist; do not apply the local shim. For any nonempty target, first reconcile migration history and current function bodies; protected Nov01/Nov02 and legacy Nov04 cutover must never be replayed. Keep the application inaccessible until the whole approved sequence and effective ACL/RLS checks pass. Runner transactions are per file, not a guarantee of one atomic batch.

Configure only the separate Vercel project's Preview environment:

- Public: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, VITE_API_BASE_URL using this test project and application origin.
- Server-only: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AFHOMES_TARGET_PROJECT_REF; DATABASE_URL only in the authorized local migration runner, never browser bundle.
- Invitation origins: AFHOMES_WEB_URL and AFHOMES_ADMIN_URL must resolve to the approved test deployment; inspect resolveCustomerPortalOrigin/resolveAdminUrl before invitations. Allowlist actual test Auth redirects.
- Build origin: scripts/prepare-vercel-env.mjs derives VITE_WEB_URL and VITE_ADMIN_URL from VERCEL_URL for Preview. Do not pin those public URLs to production. Verify generated public values and invitation links against the actual deployment before use.
- Any email-provider or DOCUMENT_HASH_PEPPER configuration must use isolated test credentials and existing integrations; do not install OTP providers, expose values in reports, or change global network/credential settings.

Fresh managed validation must include real PostgREST privilege denials (including column grants), Auth claim/link/expiry flows, private Storage signed delivery, function permission checks and supabase/security/rls_invariants.sql. Local shim grants do not prove platform defaults such as auth.users exposure. Run read-only probes against the authorized test target and retain redacted evidence.

## Synthetic actors and configuration

Create distinctly labelled UAT Admin, GSD, Finance and Customer accounts through existing invitation/onboarding flows. No second authentication system and no preset privileged password. Use two unrelated customer identities plus Bronze/Silver/Gold memberships. Activate via fully verified synthetic VIP-card purchase flow; activation creates no automatic new earning grant under the current model. Obtain balances through eligible completed service purchases and customer claims. Any direct opening adjustment/seed requires separate approval and an auditable existing path.

Admin configures synthetic accommodation services, a staycation/hotel rule with a deliberately non-unit rate (for example PHP0.50 per point, entered explicitly), a non-accommodation service with no promotion, an eligible promotion for that service, and an explicit stacking promotion. Include inactive, future and expired rules, quantity/value thresholds and tier exclusions. These are test configurations, not production defaults. Annual caps must read Bronze25,000/Silver40,000/Gold60,000.

## Human test checklist and evidence

Every final financial confirmation is a **human handoff**, including customer claim, points authorization, payment verification, purchase completion and Finance refund. Automation may navigate, inspect and prepare forms; it must stop before final confirmation. Do not bypass the handoff with an API or SQL mutation. The automated disposable SQL suite is synthetic regression evidence and is separate from managed browser UAT.

For each case record actor, test identifiers, server response, pre/post balance and reserved/debt position, immutable ledger/audit events, reload persistence and redacted console/network errors. Never record passwords, claim tokens, QR payloads, service keys or government ID values.

- [ ] Public Experiences lists all three original destinations from published CMS; open each detail route, media and fallback/error state. Draft content stays private.
- [ ] Admin services, earning rules and redemption promotions load; permissions match hidden navigation and direct routes; mutations reload persistently.
- [ ] GSD service sales use server prices; VIP percentage versus points choice is clear; absent conversion rule blocks accommodation points checkout; other services require promotion; stacking is refused except the explicit applicable promotion.
- [ ] Earn: no eligible rule means no claim; only verified full net cash/valid zero-cash settlement completes; Bronze/Silver/Gold caps limit earned capacity without activation grants.
- [ ] Claim: customer camera and manual code both reach review; wrong customer cannot review/claim; human confirms once; duplicate response/reload cannot credit twice; expiry and renewed credentials behave correctly.
- [ ] Use: GSD prepares exact transaction/service/points/peso/final amount; customer sees and authorizes from their own signed-in portal; staff has no equivalent approval path.
- [ ] After approval: ledger balance unchanged, available-to-spend reduced. Competing customer tabs cannot reserve beyond balance. Changed price/promotion/tier/ownership invalidates approval.
- [ ] Human verifies partial cash: purchase remains incomplete and points untouched. Human verifies remainder and completes: exactly one debit. Legitimately zero-cash checkout succeeds without fabricated cash receipt.
- [ ] Customer rejection, expired approval and abandoned/cancelled draft release availability without debit. Expired holds are excluded from availability and cleaned lazily on next authorized read/mutation; there is no background expiry job.
- [ ] Finance human reviews consumed-service state and full/partial refund attribution. Restoration is a compensating ledger entry, pays debt first, cannot exceed original deduction, cannot convert to cash, and cannot repeat. Same-reference retry returns existing result; changed-reference amounts cannot exceed cumulative base.
- [ ] Full refund/below-threshold refund reverses linked earned award; spent awards generate reversal debt without a negative raw balance; later eligible credits settle debt before spendability. Legacy missing-snapshot partial refund stays refused.
- [ ] Execute the owner-approved earned-points partial-refund ordering rule in both orders; compare earned amounts, ledger and cap consumption. Current implementation has a known ordering discrepancy, so this item cannot pass yet.
- [ ] VIP-card Finance payment queue/activation and existing sales remain separate from operational receipts and redemption refunds.
- [ ] Customer points historical periods and activity show completed deductions/restorations after reload; unauthorized customer cannot fetch another customer's approval/history.
- [ ] At360/768/1440 widths: skeleton settles to data/empty/retryable error, button spinner prevents repeat actions, SweetAlert cancel/confirm behaves correctly, focus/keyboard/labels work, no horizontal overflow.
- [ ] Physical Android/iOS HTTPS camera permission, denied permission, manual fallback, scanner accuracy and camera cleanup. Browser fixtures cannot establish hardware proof.
- [ ] Managed Auth invitations/recovery/logout/cache clearing and revoked/deactivated access; managed private Storage access denial and signed URL expiry; no unexpected public bucket.

## Acceptance and rollback

Require all applicable human cases, reload persistence, denied-path evidence, clear console/network and owner signoff before any shared release. Preserve migrations/audit/ledger; rollback application exposure by disabling the test deployment or reverting app code to an approved revision, not by deleting financial history or replaying older migrations. No production promotion is included. Keep a redacted evidence index and list unresolved items explicitly.
