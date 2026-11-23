# Final test and benchmark assessment — 6 November 2026

Branch: `claud/mongodb-conversion`, base `c96ac3bd984b224941db66556f26645cf9ea9f6a` plus preserved working-tree changes. This assessment covers local test gates and performance only. No Atlas writes, persistent environment changes, deployment, commit or push.

**Status: scoped verification complete; production NO-GO.** All configured workspace tests pass, but the heavy mixed-load gate still has one payment 503 and changed-backend lint retains existing errors. Browser acceptance and live Droplet inspection are separate pending gates.

This full-suite result was captured before the later SSD-5 customer-purge change. That change has separate targeted verification in `SSD-5-CUSTOMER-PURGE.md`; do not treat this earlier 5,272-test run as a full-suite rerun of SSD-5.

## Test gates

Fresh full-suite invocation: `pnpm.cmd exec turbo run test --force --concurrency=1 --continue=always -- --maxWorkers=1`. Force bypasses test caches; continue runs independent workspaces even if another fails. Log: `.git/remediation-final-tests.log`.

- Full workspace suite: **PASS: 5,272 tests across 435 files**, seven workspaces, exit 0, zero cached test tasks, 31 minutes 41.6 seconds.

| Workspace | Passing tests | Passing files |
| --- | ---: | ---: |
| API | 3,347 | 232 |
| Admin | 1,027 | 112 |
| Web | 275 | 25 |
| Contracts | 319 | 23 |
| Shared | 59 | 7 |
| UI | 238 | 35 |
| Config | 7 | 1 |

- The prior Admin recommender-dropdown failure is covered by the now-passing 17-test `final-blockers.spec.tsx` file. The required address fixture was corrected; production validation was preserved.
- Typecheck: **PASS**. Initial run caught an overly narrow UUID-array type in the new orphan regression; corrected with an explicit `string[]`, then rerun successfully. Log: `.git/remediation-final-typecheck.log`.
- Configured repository lint: **PASS**, zero errors and 41 warnings (9 Web, 32 Admin); the unchanged Web task was cached. Log: `.git/remediation-final-lint.log`.
- Environment isolation: **PASS**, including the built public artifacts. Log: `.git/remediation-final-env.log` and hosted-build log.
- Hosted build: **PASS** using process-only `AFHOMES_PUBLIC_ORIGIN=https://release-check.example.invalid` and Cloudflare's public dummy Turnstile site key. The first invocation correctly refused missing build configuration; no environment file was edited. Both SPAs, 12 prerendered public routes and assembled artifact isolation pass. This does not verify the real site's origin or Turnstile configuration. Log: `.git/remediation-final-build.log`.
- Explicit changed-backend lint: six errors, all existing in HEAD: three in `members.mongo.ts` and three unused destructuring bindings in `public-search-integration.mongo.spec.ts`. The previously introduced unused callback argument is removed. The root lint command only covers the configured app tasks; it is not evidence that backend lint is clean. Log: `.git/remediation-final-backend-lint.log`.

The configured Vitest suites include real disposable-Mongo integration and retained legacy/mocked tests. They do not substitute for browser acceptance, an opt-in real PostgreSQL harness, live credentials/configuration or a deployment check. No legacy database harness, untracked experimental integration script or shared-database test was run.

The new commercial regression passes all four cases: 50-sale enrichment uses seven read commands including cursor continuation, the 200-payment history uses one staff query, and Finance uses one aggregate for each source collection. It also checks exact verified-money totals, omitted private fields, search, missing-reference exclusion, deep pagination and activation filtering. Those fixture counts exclude real authentication queries; the HTTP benchmark counts later in this report include them.

## Benchmark method and limits

New disposable MongoDB 8.0.0 replica sets only; no environment files or existing data loaded. Node 24.19.0, Windows, 12 logical processors, approximately 15.7 GiB RAM. Client, API and MongoDB share this computer. Both runs use the production HTTP server factory from fetched `origin/develop`, with a synthetic loopback TLS proxy and authentication fixture. This is not an actual Nginx/TLS/Droplet/Atlas benchmark.

Each run seeds 100,001 customers, 59,954 sales, 124,012 payments, 25,457 staff, 27,989 relationships and 10,000 sessions. The same seeded distribution and local read-index plan are used, with independently generated synthetic UUIDs. Before selects HEAD versions of the six snapshotted read/runtime modules; after selects the edited modules. Other dependencies are shared current code. This compares the read optimizations, not two complete deployed revisions.

The driver operation timeout is 15 seconds, matching the application; HTTP request/header/keep-alive settings are 60/20/5 seconds. Each load level starts work for 20 seconds, then drains in-flight operations. The weighted UI mix has 250 ms nominal randomized think time and no client keep-alive reuse. A payment scenario comprises recording **and** rejecting a fictional payment, so scenario counts/throughput below are not raw HTTP-request counts. Expected authorization denials and login throttles are allowed outcomes, not errors.

Single-request measurements are one measured request after warm-up, not p95 values. Baseline ran first; cache/OS variation and a single repetition limit timing precision. Command counts and examined-document reductions are stronger evidence of structural improvement.

## Single-request results

| Operation | Before | After | Commands before → after | Documents examined before → after |
| --- | ---: | ---: | ---: | ---: |
| Sales list | 574.2 ms | 108.2 ms | 215 → 19 | 120,233 → 120,184 |
| 200-payment history | 476.8 ms | 21.2 ms | 416 → 17 | 277 → 277 |
| Finance queue | 10,156 ms | 1,537.3 ms | 13 → 11 | 209,711 → 104,928 |
| Global Analytics | 2,254.2 ms | 2,278.0 ms | 24 → 24 | 392,864 → 392,864 |
| Finance Analytics | 2,230.7 ms | 1,740.5 ms | 15 → 15 | 313,962 → 313,962 |

Sales/history batching and Finance join reduction have measurable benefit. Global Analytics has **no meaningful measured single-request improvement**. The linear grouping regression prevents a known quadratic JavaScript path, but these global aggregates still examine large histories; that fix is not proof of overall Analytics scalability.

## Mixed-load results

| Workers | Before: completed scenarios / errors | After: completed scenarios / errors | Before → after scenarios/s |
| ---: | ---: | ---: | ---: |
| 8 | 92 / 3 | 146 / 0 | 2.6 → 6.5 |
| 32 | 67 / 11 | 193 / 1 | 1.6 → 8.0 |

No thrown client exceptions, connection resets or server `clientError` events occurred in these two runs. This does **not** prove the earlier reused-socket race is fixed: this realistic profile disables client keep-alive reuse, and the original four exceptions lack diagnostic detail.

Before at eight workers: three Finance queue 503s. Before at 32: eight customer-search 503s, one Finance queue 503 and two payment-scenario 503s. After at 32: one payment-scenario 503 among six attempts at that composite scenario. The after run has 192 expected outcomes out of 193 completed scenarios; it is **not a clean load pass**.

The remaining 503 was not captured with its record-versus-reject stage or internal driver cause. Do not label it a proven connection reset, database timeout, write conflict or lost commit. The shared `sales-write` transaction counter and fresh transactional authorization reads are investigation candidates, not established causes. No automatic mutation retry or timeout increase was added.

After-run latency also remains material:

| Operation | 8-worker observed p95 | 32-worker observed p95 |
| --- | ---: | ---: |
| Sales list | 1,036.88 ms (8 samples) | 3,400.52 ms (13 samples) |
| Finance queue | 3,352.84 ms (9 samples) | 5,310.80 ms (5 samples) |
| Global Analytics | 4,170.57 ms (5 samples) | 7,986.38 ms (4 samples) |
| Payment record/reject composite | 1,306.54 ms (6 samples) | 17,842.47 ms (6 samples, includes failure) |

These short-run per-route sample sizes are too small for stable tail-latency estimates; many nearest-rank p95 values equal the maximum. Zero errors at eight workers does not mean every operation is fast or establish a supported concurrent-user limit.

At 32 workers after: Node peak RSS 1,300 MiB, MongoDB sampled resident memory 871 MiB, event-loop p99 943.7 ms, maximum checked-out connections 47, pool-checkout p99 84 ms and zero checkout failures. These indicate significant pressure; they neither establish a production capacity nor justify simply increasing the connection pool. No requests-per-user capacity claim or Droplet sizing approval follows from this short local run.

Artifacts, ignored locally: `.git/remediation-load-before.json`, `.git/remediation-load-after.json` and corresponding `.log` files. Builder: `.tmp-bin/build-remediation-benchmark.mjs`; its snapshots and harnesses remain ignored, not production code.

## Outstanding release gates

This is a scoped test/performance assessment, not a replacement for `PHASE-10-RELEASE-READINESS-2026-11-05.md`. Existing operational/security gates, including deferred U9 and backup/recovery readiness, remain open unless separately verified.

1. Resolve the six existing changed-backend lint errors if a clean backend lint gate is required; configured app lint passing does not close that gate. The full workspace tests, typecheck, hosted build and environment-isolation checks above are complete and pass.
2. Trace and resolve the remaining 32-worker payment 503, then repeat the quiet workload with explicit HTTP-error and driver-failure diagnostics.
3. Validate keep-alive behavior separately; original error identity cannot be reconstructed.
4. Complete browser acceptance and approved live server inspection separately. This report authorizes no service, schema, credential or deployment action.

Machine-readable local summary: `.git/remediation-final-results.json`. No test failures/timeouts occurred in the completed suite; expected denial/fault-injection logs and jsdom unsupported-browser warnings are not failed tests. Tests exercise no actual shared-database migration or production release.
