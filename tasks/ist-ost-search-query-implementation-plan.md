# Local IST/OST search implementation plan

Spec: [reviewed design](ist-ost-search-query-specification.md), including the latest saved-contact and CAPTCHA decisions. User authorized local implementation on 2026-10-21. Execute inline on `claud/clean-develop`; no agents, shared database writes or deployment. Subsequent user authorization allows a scoped commit and normal push to origin/claud/clean-develop.

1. Add strict public contracts and tested server helpers: trusted IP, purpose-separated signatures, name masking, contact digest, Cloudflare Siteverify and fail-closed configuration.
2. Add forward-only SQL for contact deduplication, shared attempt counters, exact rolling successful-disclosure ledger, service-only RPCs and explicit cleanup. Correct the latest IST/photo function composition. Prove transactions, concurrency, retries, expiry and ACLs on disposable PostgreSQL; regenerate schema index.
3. Integrate start/reveal/config into the existing handler. Preserve authorized staff history and self/admin reads; close the anonymous legacy bypass. Verify challenges before lookup, receipts before disclosure and photos after allowance.
4. Replace the public page's immediate lookup with the accessible staged flow using existing primitives. Preserve layout; cached contact receipt never skips CAPTCHA, acknowledgment, current-status or quota checks.
5. Run focused tests, typecheck, lint/build/env isolation and disposable DB proof. Exercise local browser flows without hosted fixture writes. Record any unavailable real-service proof honestly.

Review focus: late canceled responses; first-IP concurrency; lost-response replay and subsequent revocation; concurrent normalized contact submissions; invalid/deleted receipts; missing configuration; fixed-window boundary confusion; old anonymous GET disclosure; IST without expiry.

Local preview may use a clearly marked draft notice only against loopback Supabase. Hosted activation stays unavailable until final privacy copy, retention, keys, hostnames and scheduled cleanup are configured. No test CAPTCHA key is accepted with a hosted Supabase target.

## Progress

- Planning and code baseline inspected. Existing spec/readiness edits preserved.
- Ruling: user authorization to implement locally supplies execution direction; continue inline without another plan approval. No optional reviewer agents because repository instructions prohibit them without explicit request.

## Implementation evidence

All five implementation steps are present locally. The [readiness report](ist-ost-search-query-readiness.md) records the successful scoped tests, real API/SQL proof, baseline suite failures and outstanding browser/publication checks. Official Cloudflare Turnstile testing keys are limited to the disposable loopback preview. The latest user request restores Cloudflare Turnstile; the temporary Google integration has been removed. Privacy copy remains draft pending owner-supplied publication details.
