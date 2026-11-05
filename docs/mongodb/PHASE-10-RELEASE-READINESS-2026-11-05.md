# Phase 10 release-readiness review — 5 November 2026

**NO-GO for production release.** Phase 9 remains accepted; this review identifies release gates rather than undoing its changes. Local functional proof is strong, but the complete test gate, heavy-read capacity, public-search proxy handling and operational recovery are not ready.

Reviewed working tree: `ClaudAfhomes/AFhomes-ecofarm-v2`, `claud/mongodb-conversion`, HEAD `d89023d` plus the preserved uncommitted changes. No product code, Customer ID behavior, credentials or environment files were changed in this review. No Atlas writes, index installation, commit, push or deployment occurred. Atlas access was a read-only index plan. Disposable probes and logs stay ignored.

## Prioritized release blockers and required fixes

| Priority | Finding and evidence | Required before release |
| --- | --- | --- |
| P0 | **Backup capture is failing.** Current Task Scheduler result is `1`; last run 5 Nov 09:41, sanitized result `success:false`, stage `capture`, failure 09:42 Singapore time. Newest encrypted archive is from 3 Nov 07:11. | Diagnose the failed capture without exposing secrets, restore successful scheduled capture plus independent restore, and alert on failure/stale backups. Do not assume the Oct 31 setup result describes current health. |
| P0 | **Recovery depends on this PC and Windows profile.** Archives and DPAPI-protected key are on the same computer; no independent key recovery or off-device copy is established. The task requires this user signed in. Repeat-pass capture detects observed changes but does not enforce a coordinated Atlas/file snapshot. | Approve and prove an encrypted independent destination, separate key recovery, coordinated capture consistency, retention and measured RPO/RTO. Restore into an independent environment. Existing synthetic recovery tests do not establish disaster recovery. |
| P0 gate, deferred | **U9 remains explicitly deferred.** Quarantined scripts previously contained the app database credential, auth secret and administrator password. Quarantine prevents accidental staging; it does not revoke exposure. | Keep the documented rotation plan deferred during this review. Production must not reuse exposed credentials; any replacement/revocation/password change needs separate authorization. Preserve the existing administrator and assignments. |
| P1 | **Hosted public-search visitors share an IP key.** `sale-team-public-search.ts:117` calls `searchIp(req, env.VERCEL === '1')`; the DigitalOcean template is not Vercel and the socket peer is Nginx at loopback. An independent HTTP probe sent two different Nginx-style forwarded IPs and obtained **one** search limiter key. Auth's separate proxy fix does not fix this path. | Add an explicit trusted-loopback proxy path to public search, with Nginx overwriting the single validated client IP. Test separate visitors, spoofed headers, direct/non-loopback requests and token-IP binding. Do not enable a fake `VERCEL` flag as a workaround. Otherwise visitors share short-term limits, cooldowns and, when enabled, the three-disclosure allowance. |
| P1 | **Finance/Sales/Payment History are expensive under mixed load.** At 100k customers, Finance queue examined 219,702 documents; Sales list used 215 commands; one 200-payment history used 416 commands. At concurrency 32, the recorded completed requests took about 30–39 seconds. | Batch page enrichment and payment-actor lookups; reduce repeated queue joins/count/sort work; push equivalent filters and bounded paging into MongoDB. Review targeted indexes from actual explain plans. Preserve exact money, verified-payment totals, frozen terms and permissions. Re-measure before sizing a server. |
| P1 | **Analytics remains proportional to history size.** Global/Finance single reads examined 402,864/323,965 documents, despite reduced transfer and hybrid aggregation. Their recorded concurrency-32 latency reached about 30 seconds. | Bound repeated work using semantically equivalent aggregation/window filtering. If caching is approved, bind it to authorization scope and explicit invalidation. Financial mutation/activation decisions must continue to read authoritative transactional data. No unreviewed customer-summary backfill or cache was introduced. |
| P1 | **The final test gate is not clean.** The application recommender-dropdown test fails reproducibly in isolation. Its holder fixture omits the address required by the shared holder schema, so Next cannot reach the recommender step. Backend scoped lint also has one introduced unused parameter plus pre-existing debt. | Correct the fixture to satisfy the actual contract and rerun the suite without weakening holder validation. Remove the new lint error. Classify remaining failures separately; do not call a root lint pass a backend lint pass. |
| P1 | **Production installation and operations are unverified by this review.** The owner subsequently confirmed an existing Droplet deployment; fetched `develop`/`release/v2.0` contain a separate production entry point and release helper (see correction below). This working tree's templates still contain a reserved staging domain. The running revision, Linux/TLS/firewall/Atlas configuration, monitoring and rollback were not inspected. | Reconcile this branch's changes with the actual production implementation before any release. Verify the real domain/origin, Turnstile hostnames/keys, database namespace, private-file paths, monitoring, drain/rollback and restore against the running target. Do not reinitialize or overwrite existing deployment configuration. |

## Four client failures: investigation result

Original raw result files were found in the local Claude scratchpad `p9/stress/out/`, not in the repository. The original harness increments a counter in a bare `catch`; it **discarded error codes, elapsed times and socket state**. The original four failures therefore cannot be assigned a proven individual cause retrospectively:

| Original run | Concurrency | Failed scenario | Failures |
| --- | --- | --- | --- |
| 50k customers | 32 | Referrals SM | 1 |
| 100k customers | 32 | 200-payment history; session check; Finance analytics | 1 each |

All four were read scenarios; none was attributed to the composite payment-record/reject scenario. This is not evidence that a lost mutation response can safely be replayed without its idempotency key.

Existing instrumented follow-up artifacts were independently inspected:

- `p10-ka-A.json`: 100k customers, 48 workers, 5-second keep-alive; **four `ECONNRESET` failures on reused sockets** and five 60-second client timeouts. Socket-timeout events were recorded.
- `p10-ka-B.json`: same seeded scale, 65-second keep-alive; **zero resets, six client timeouts**. Changing keep-alive did not solve overload.
- This supports a keep-alive/close race as a failure class, **not proof that every original exception had that cause**. There is no request-to-socket correlation sufficient to establish that claim. Node documents this race and its timeout buffer in the [HTTP documentation](https://nodejs.org/docs/latest-v24.x/api/http.html#requestreusedsocket).
- The original error-rate denominator excludes thrown requests: e.g. the 100k run had 41 completed responses plus three exceptions, so the exception fraction is `3/44`, not `3/41`. Preserve attempted, completed and failed counts separately.
- These harnesses use MongoDB operation timeout **120 seconds**; the actual client uses **15 seconds**. Several follow-up artifacts also report default HTTP receive timeouts of 60/300 seconds rather than the entry point's 15/60 seconds. They are diagnostic evidence, not an exact production configuration pass. Node's `requestTimeout` limits receipt of a request, not handler execution ([reference](https://nodejs.org/docs/latest-v24.x/api/http.html#serverrequesttimeout)).

Required closure: retain sanitized method/route/request correlation, error code, reused-socket state, server close/abort events and operation outcomes; rerun with the actual driver/HTTP settings and reverse proxy. Retry only safe/idempotent operations with a bounded policy. Do not hide failures by raising timeouts or retrying financial writes blindly.

## Independent Phase 9 compatibility/security review

The reviewed changes preserve opt-in paging and existing unpaged response behavior. Cursor MACs are domain-separated, caller/filter bound, and do not replace fresh authorization. Genealogy falls back to the original all-edges read when an index is absent/unusable, a hinted query fails or traversal bounds are reached. The index cache stores index metadata, not permissions. Analytics uses exact decimal classification and falls back for unprovable inputs. Official-form date/search fixes retain the API contract. No financial mutation, activation rule or Customer ID generator was changed by this review.

- **U8 verified:** current referral edges require both endpoints inside the caller's genealogy; retired edges require the caller to be a party. Anonymous/inactive and foreign-branch denial is exercised.
- **U11 verified:** masked upline email cannot be discovered through paged or unpaged search; authorized detail readers retain email search.
- **U10 retained:** approved upline and downline contacts remain available inside the projected genealogy; unknown and unauthorized IDs receive indistinguishable empty entries. No downline-only change was made.
- **U9 deferred:** no rotation, bootstrap, reset or disposal performed. Production exposure remains a separate gate.
- **Customer ID behavior preserved:** D16's future sequential-ID policy remains on hold. U13's legacy random-generator test can collide; a passing run does not fix that pre-existing test-quality issue. Do not weaken issued-ID uniqueness or silently change numbering.

No new Phase 9 business-rule/API/security regression was established in the exercised backend paths. This conclusion is bounded by the tests below and does not claim exhaustive correctness or complete browser acceptance.

## Relationship indexes: validated, not installed

Read-only Atlas plan during this review: `afhomes_dev`, **19 entries: 17 present, exactly two missing**, no conflict:

- `referral_relationships/read_relationship_subject_upline` — `{ subject_staff_id: 1, upline_staff_id: 1 }`.
- `referral_relationships/read_relationship_upline_subject` — `{ upline_staff_id: 1, subject_staff_id: 1 }`.

An independent new loopback-replica probe passed **19 assertions**: both-index presence gate, only these two pending, wrong-database/stale-digest refusal, additive installation, exact non-unique/unfiltered definitions, IXSCAN for both hinted lookups, unchanged documents, index-count +2, rollback and planted name-conflict refusal. The existing active-subject partial unique index was retained. This complements the existing parity evidence; the large Phase 9 fuzz campaigns were inspected, not all rerun.

The [installation plan](RELATIONSHIP-INDEX-PLAN-2026-11-04.md) remains conditional on **separate final confirmation**. Re-read the plan immediately before applying. The installer installs every missing candidate in its digest-bound plan, so stop if anything other than these two is pending or if any conflict appears. Index DDL is resumable, not transactional; account for disk/build resources. Rollback is also a separately approved operation. Nothing was installed here.

## Deployment and capacity assessment

**Owner correction and branch inspection after review (5 Nov).** The system is already deployed on DigitalOcean according to the owner. A fresh fetch verified `origin/develop` at `f9bb3b85` and `origin/release/v2.0` at `77e37ac8`; `staging/v1.0` was deleted remotely. `develop` is 22 commits ahead of this review's base `d89023d` and includes that base. It contains `api/_server.ts`, `api/_lib/production-server.ts`, `docs/mongodb/PRODUCTION-API-DEPLOYMENT.md` and the manual `scripts/afhomes-release.sh` helper. The helper accepts release branches and restarts the service only when explicitly run. No GitHub Actions deployment workflow was found on this branch or fetched `develop`.

This corrects the earlier assertion that no Droplet exists. It does **not** establish the running server's revision or configuration. Production code there passes an options object (`clientIp`, `mediaStore`) into `createMongoPhase5Runtime`; this working tree currently passes a boolean for proxy trust. Integration must preserve the production options and public-media behavior, rather than overwrite that interface with the older form. Neither branch was merged or deployed during this follow-up. The following hosting controls and performance evidence describe the reviewed working tree, not a certification of the deployed artifact.

Prepared controls are useful: loopback Node listener, canonical HTTPS origin checks, secure auth cookies, explicit four-setting production database selection, no startup seed/bootstrap/DDL, private files outside releases, signed downloads, non-root systemd restrictions, separate persistent directories and code-only rollback. Production scope is permitted by code, **not initialized by that permission**. Authentication can write session/rate-limit records even when business writes are disabled.

Remaining operational proof includes real Linux/Nginx/TLS validation, approved Atlas network and least-privilege access, private-file/key transfer, measured rollback/drain behavior and a source-independent restore. Configure actionable health/5xx/latency/event-loop/RSS/pool/disk/backup-age alerts and exercise delivery. Nginx access logs omit query arguments; error-log redaction/access/retention still needs validation because signed file URLs contain sensitive grants.

The measured light workload (10k customers, 2,400 requests, 20 workers, zero failures, p95 141 ms) is **not** the mixed commercial workload. Phase 9's heavier runs completed about **8.2 requests/second at 10k** and **1.1–2.9 at 100k**, with saturation and client failures. The overload follow-ups reached roughly **1.4–1.45 GiB process RSS**. Client/API/MongoDB shared one Windows host; Atlas latency, real TLS/Cloudflare and Linux scheduling were absent. These short closed-loop runs do not establish a sustained arrival-rate SLO or a maximum user count.

Do not approve a 1 GiB server from these numbers. A 2-vCPU/4-GiB app-only staging host is a **test candidate**, not a demonstrated production capacity recommendation; allow OS/proxy/file-cache and growth headroom. Keep Atlas separate. More workers/cores are not a substitute for removing scans and N+1 reads, and multiplying workers also multiplies pools and process memory. Before sizing production, define dataset growth, peak active users/arrival rates, operation mix, upload sizes, latency/error targets and backup overlap; then run a sustained target-equivalent load and recovery/soak test after the read-path fixes.

## Verification evidence

| Check | Result and limit |
| --- | --- |
| Full API suite, immediately preceding independent review on the same source | **3,338 tests / 230 files passed**; `.git/claude-review-api.log`. Reviewed backend files predate that run; source hash manifest retained for this review. |
| Fresh Phase 10 security/runtime/index/recovery selection | **57 tests / 8 files passed**; `.git/phase10-security-runtime-tests.log`. Real disposable MongoDB/HTTP where applicable; CAPTCHA is synthetic and recovery fixtures are synthetic. |
| Independent review probes | **19 index-plan assertions passed**; public-search shared-IP defect reproduced with two synthetic forwarded visitors. `.git/phase10-review-probes.log`. |
| Fresh non-API workspace suite | **1,924 passed, one failed**: config 7, contracts 319, shared 59, UI 238, web 275, Admin 1,026 passed. Admin: 111 files passed, one failed; 1,027 tests in 596 seconds. `.git/phase10-workspace-tests.log`, overall exit 1. |
| Admin isolated failure | Recommender-dropdown test **fails**, 16 other tests intentionally filtered out; `.git/phase10-application-fixture-failure.log`. No product changes made to force a pass. |
| Workspace typecheck | **7/7 tasks plus root script check passed** in the preceding independent run; isolated hosted build also reran API/Admin/Web typechecks. |
| Isolated hosted build/static assembly | **PASS**, both Vite builds, 12 prerendered routes, built environment isolation; `.git/phase10-hosted-build.log`. Reserved origin and synthetic public key; not a deployment or live Turnstile test. Large-chunk warnings remain. |
| Repository lint | **PASS**, two configured app tasks, 32 Admin warnings; `.git/phase10-repository-lint.log`. Root command does not lint backend/contracts. |
| Explicit changed-backend/contracts lint | **30 errors: 29 pre-existing, one introduced** unused `_` parameter in `members.mongo.ts:169`; baseline comparison from the preceding independent review. `.git/claude-review-lint.log`. |
| Diff whitespace | **PASS**; line-ending conversion notices are warnings. |
| Current real backup health | **FAIL**, scheduled capture failed; existing encrypted archives remain untouched. Synthetic restore tests pass, independent disaster/key recovery is unproven. |

The Admin suite completed with exactly the same one reproducible application-fixture failure; there were no reported test timeouts. The focused 57 tests are a subset of the full API suite, not an additional 57 distinct tests. The review verdict remains NO-GO.

Evidence logs, source-hash manifest, disposable probes and original stress artifacts are local/ignored; they are not a published operational service or durable backup. Large stress campaigns and browser acceptance were not rerun in full during this review. Phase 10 ends at review: fixes, credentials, shared schema applies, production preparation, commit/push and deployment each retain their existing authorization boundaries.
