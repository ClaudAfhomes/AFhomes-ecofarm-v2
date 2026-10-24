# Public IST/OST result design and settings verification

Branch: `claud/clean-develop`. User approved the scoped shared migration apply and commit/push on 2026-10-24. No manual deployment was performed.

The approved design is implemented by one result component for IST and OST: circular photo/fallback, masked identity with copyable AA number, Registration Status, pale-blue support/payment panel, local bank wordmarks, editable bank/check details, and blue agent reminder. Mobile stacks contacts/bank cards without horizontal overflow. No unmasked surname is introduced.

All displayed payment/support copy comes from saved Public Verification Settings. Edited bank names use text rather than an unrelated bank wordmark. Source/rights pointers accompany the local SVG assets.

## Defect corrected

Local preview previously skipped the saved settings RPC and always selected the draft privacy text. It now reads saved settings, including saved privacy text; explicit loopback preview defaults remain only when no saved settings can be loaded. Hosted privacy approval, automatic cleanup readiness, production-key enforcement, CAPTCHA, contact validation and masking remain enforced.

## Fresh evidence

- Public-result UI: 8 tests passed, including both identity kinds, photo behavior and edited support/bank content.
- Admin settings UI: 6 tests passed (existing jsdom scrollTo notices).
- API/search/config: 25 tests passed, including saved settings in local preview, no search/contact RPC on bad CAPTCHA and hosted fail-closed gates.
- Disposable PostgreSQL: 139 checks passed, including every support/payment field persisted/read back and stale revision refusal.
- Web/API typecheck, scoped lint and Web production build passed.
- Authenticated local Admin: VD denied; Super Admin changed support heading/email, saved, reloaded and saw persisted values. Production result component with real public config showed those changed values; originals restored via Admin.
- Desktop and 390px mobile component previews: both logos loaded, masked identity and copy button rendered, no horizontal overflow and no captured console errors.
- Full browser search remains NOT VERIFIED: the Cloudflare test widget rendered blank and kept Verify disabled. No CAPTCHA token was injected or security bypass introduced. Layout screenshots use the production component with a synthetic identity and real saved public configuration; they are not proof of a completed lookup. Temporary preview HTML/TSX removed after verification.

## Approved shared application

The two never-applied settings drafts were consolidated into unique version `20261225000001_afhomes_public_verification_settings.sql`. The already-applied `20261212000005_afhomes_public_search_readiness.sql` was not changed. The consolidated file lets the guarded runner commit DDL and history atomically.

Applied exactly `20261224000001` (reporting) and `20261225000001` (settings) to `ikaevepedpqygdlipsei`; live history increased 125 -> 127. All original settings and customer/points/commission aggregate fingerprints remained unchanged. All eleven content fields are returned and persisted by the replacement SQL functions. Browser roles cannot execute the RPCs. Application RLS audit passed; the two pre-existing platform cron policies remain unchanged. No live customer import or settings edit was used as a mutation test.

See [migration application record](supabase/MIGRATION-APPLICATIONS.md) for hashes and verification boundaries. This does not claim complete hosted browser acceptance or deployment success.

## Commit verification

Fresh release checks: complete API 2705/2705; contracts 313/313; focused Admin 30/30; focused Web 9/9; seven workspace typechecks, both app builds and lint passed (existing warnings). Search/settings real-PostgreSQL 139 checks and ten-customer import/reporting integration passed. Full disposable DB suite reproduced the same four documented purchase/reservation failures: 1453 passed / 4 failed. No business validation was weakened to make those fixtures green.
