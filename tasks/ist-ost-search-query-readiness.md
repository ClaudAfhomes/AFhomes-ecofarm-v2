# IST/OST search local verification

Branch: **`claud/clean-develop`**, base `33f500f`.
Checkout: `C:\Users\SSD-CLAUD\Documents\AFhomes-ecofarm-v2-1\AFhomes-clean`.

## Delivered behavior

Public verification uses Cloudflare Turnstile, a required privacy acknowledgment and Name / Email / Mobile form before disclosing a masked current result. Search opens the notice; Continue opens the contact/security dialog; Verify calls start then reveal. The notice can also be read before starting. Failed widgets offer a retry control.

The complete normalized contact combination is saved once privately and reused across IST/OST and later sessions while retained. Browser sessionStorage contains only a random session ID and signed contact receipt. A cached contact never skips acknowledgment, CAPTCHA, current eligibility or quota checks. Format validation does not establish ownership of an email/phone; no marketing use is authorized.

Service-only SQL functions atomically deduplicate contacts, serialize allowance per IP, enforce three successful disclosures per rolling 24 hours and reuse a signed delivery retry without charging twice. Retries still recheck current eligibility. Starts/reveals share attempt limits and cooldowns. Cleanup deletes at most 1,000 expired rows per table per call; the scheduler must repeat and monitor backlog. Browser roles cannot access the private contact/security tables or execute write RPCs. Anonymous legacy GET disclosure is closed when v2 is enabled.

IST employee identity remains date-free; OST retains term expiry. The new migration corrects the later photo migration's IST regression while preserving issued identifiers and history. CURRENT-SCHEMA.sql was regenerated from all 127 migration files.

## Verification

| Check | Result |
| --- | --- |
| Focused API/helper and existing sale-team handler tests | PASS: 27 tests, including rejection of test keys on hosted targets |
| Existing and new contract tests | PASS: 20 tests |
| Full public SPA suite | PASS: 257 tests |
| Latest public-search workflow | PASS: 5 tests |
| Turnstile failure/retry and stale callbacks | PASS: 1 regression test |
| Repaired existing sale-team PostgreSQL suite | PASS: 95 checks |
| New PostgreSQL concurrency, quota, cleanup and ACL suite | PASS: 48 checks; includes RLS invariants |
| Root typecheck, build, lint and environment isolation | PASS; existing build-size/fast-refresh warnings remain |
| Real local HTTP API + PostgREST + PostgreSQL + test-mode Siteverify | PASS: IST/OST, cached receipt, equivalent contact deduplication, fourth disclosure 429, replay, tampered token, anonymous legacy denial and missing challenge token |
| Private disposable DB counts after HTTP acceptance | Exactly 1 contact and 3 disclosures |

Chrome completed an IST search with contact entry, followed by an OST search reusing the receipt with fresh acknowledgment and CAPTCHA. Masked results and correct validity labels appeared; the browser error log was empty. These two browser flows saved one contact and two disclosures. The initial challenge placement intermittently returned Cloudflare error 300030; the contact-dialog placement was verified successfully. The final restored Turnstile widget displayed Success. This uses official test keys and does not prove live bot detection.

A temporary Google CAPTCHA experiment was removed at the user's request. Cloudflare Turnstile is the final provider.

## Existing unrelated failures

The full root test run is not green. Two finance-queue assertions in `api/_handlers/phase2.spec.ts` also fail in the unchanged original checkout (139 pass, 2 fail there). The general disposable DB suite reproduces two baseline import/search-path failures (2697/2699 pass); cleanup and injected nonzero-exit checks run but the harness remains red. The unchanged admin suite baseline has 14 failures. No unrelated import/payment/address business behavior was modified to hide these failures.

## Run locally

With Docker available, run `corepack pnpm dev:search:local` from this checkout. It starts disposable local PostgreSQL/PostgREST plus the real API/public SPA at **http://localhost:5183/sale-team-search**. Synthetic AA numbers: `AAI26100001` and `AAO26100001`. Use synthetic contact details only. The normal ports 5173/5174 are separate and may use hosted data.

Run `corepack pnpm test:db:search` for the isolated 48-check SQL suite. Runtime credentials are ephemeral and never printed; no hosted credentials are required. Ctrl+C in the owning terminal stops the preview; its cleanup removes only its own containers/processes.

## Live migration and publication

Required migration: `supabase/migrations/20261212000001_afhomes_public_sale_team_search.sql`. It has only been applied to disposable local databases during this work. Committing/pushing the file does not apply it live. Before a live apply, separately approve the exact file/target, verify migration history and dependencies, then run authorized post-apply checks. Do not blindly replay history-missing migrations.

The owner must finalize privacy identity, DPO/contact details, lawful basis, dates/version and retention/deletion periods. Hosted activation also needs registered Turnstile keys/hostnames, stable signing/deduplication secret, verified company telephone and working scheduled cleanup. Hosted configuration fails closed with dummy keys or an unapproved notice. No legal approval or production-readiness assertion is made.

The user authorized a scoped local commit and normal push to `origin/claud/clean-develop` on 2026-10-21. Live migration/configuration and production deployment remain outside that authorization; commit/push evidence is reported separately.
