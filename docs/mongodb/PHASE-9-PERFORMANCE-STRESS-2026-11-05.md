# Phase 9 - final performance pass and stress testing (5 November 2026)

Local work only. No Atlas write or index change, deployment, credential change, new dependency or
git operation. All measurements were taken on disposable loopback replicas on one Windows machine
(12 CPUs, 16 GB). Client, API and `mongod` share that machine, so absolute times are indicative
only. Phase 8 and Phase 9 comparisons run in the same process on the same data, alternating.

## 1. Test stability (Phase 8 timeouts)

| Run (full API suite, quiet machine) | Result | Duration |
| --- | --- | --- |
| One worker (the project's official `pnpm test` setting) | 3,333 / 3,333 passed | 419 s |
| Two workers (the setting the Phase 8 run used) | 3,333 / 3,333 passed | 237 s |

The five Phase 8 failures under suite conditions:

| Test | 1 worker | 2 workers | Limit |
| --- | --- | --- | --- |
| customer-imports: persists 5,000 rows | 4.6 s | 5.4 s | 30 s |
| customer-imports: collects bad guided values | 1.1 s | 1.1 s | 5 s |
| import-continuation: retains workbook formats | 1.3 s | 1.4 s | 5 s |
| member-company-workbook: accepts 500 rows | 1.0 s | 1.1 s | 5 s |
| runtime-load: 10,000-customer workload | 7.9 s | 10.7 s | 60 s |

**Cause:** the Phase 8 suite ran while review agents and benchmark replicas were using the same
CPUs, which inflated those tests 4-6x. It was not a regression and not a test defect. Measured
times leave at least 5x headroom, so **no timeout was raised, and no test was skipped or weakened.**
Rule adopted: release-gate suite runs happen only on a quiet machine.

Separate, pre-existing flake (U13): `business-ids.spec.ts` asserts no collision among 1,000 random
25-bit suffixes from the legacy SQL-generator mirror. The birthday bound gives about a 1.48%
failure chance per run. It is unrelated to the MongoDB Customer ID generator (unchanged), and it is
left as is because fixing it means changing the assertion.

## 2. Changes

| Area | Change | Behaviour |
| --- | --- | --- |
| Genealogy (sellers) | Indexed traversal reads only in-scope edges. It needs both relationship indexes, confirmed by a cached gate plus a per-traversal re-check, with every query hinted. Limits: 32 walk steps or levels, 64 queries, 100,000 members; any limit reached means the Phase 8 path. An edge validity probe is added. | Identical responses (fuzz below). Without the indexes, exactly the Phase 8 path |
| Index plan | `read_relationship_subject_upline`, `read_relationship_upline_subject` added (19 entries) | Proposal only; final guarded plan in `RELATIONSHIP-INDEX-PLAN-2026-11-04.md` |
| Referrals | Opt-in `?limit=&cursor=` pages; shared U8 visibility function; names for page rows only | Unpaged response unchanged (8 roles compared) |
| Members (paged) | Filter and order use 8-field keys instead of full views; page rows are still built and validated in full | Identical pages (30 walks compared) |

Mutations keep full validation (unchanged code).

## 3. Verification

- **Phase 8 vs Phase 9, same data** (~15k staff, 17k relationships): 166/166 scenarios identical,
  both without and with the relationship indexes. Covers auth resolution, every genealogy view and
  contact lookup, unpaged referrals for 8 roles, Member lists and details, and paged Member walks.
- **Genealogy parity fuzz** (random worlds; modes: no indexes, both indexes, partial index under the
  planned name, index dropped after confirmation): 19,200 requests, 0 differences, 0 gate
  violations.
- **Planted bugs** (genealogy fuzz): 6 of 7 detected. Ignoring the active-first walk rule, reversing
  the edge order, skipping the edge probe, skipping the caller's own edges, dropping the hint, and
  letting the gate accept a partial index were all caught. The seventh (dropping the walk check) is
  an equivalent mutant: it over-includes members whose walk leaves the scope, and they never
  receive a display parent, so the output is the same at a higher cost.
- **Index replaced after confirmation** (fuzz mode E: the subject index is swapped for a partial
  one under the same name): 9,600 requests across all five modes, 0 differences. The planted bug that
  skips the per-traversal re-check is caught (9 differences).
- **Final gates (quiet machine):** API and contracts typechecks pass; the full API suite passes
  3,338/3,338 with one worker (618 s). The 5,000-row import test took 10.9 s of its 30 s limit.
  The api and contracts packages have no lint script.
- **Referral pagination spec:** 5 tests. Four planted bugs (U8 bypass on pages, reversed order,
  unbound cursor, names for all rows) each fail it.
- **Verification-quality finding:** the random generator shared by the Phase 6-9 fuzzers lost
  precision past 2^53 and cycled after about 1,000 draws, so earlier fuzz runs explored far fewer
  worlds than reported. All fuzzers were switched to a 32-bit generator and re-run against their
  original snapshots, with 0 differences:

  | Fuzzer | Cases |
  | --- | --- |
  | Customer directory vs Phase 5 | 3 x 1,440 |
  | Genealogy model vs Phase 6 | 45,000 |
  | Genealogy handler vs Phase 6 | 7,200 |
  | Cycle fuzz | 1,526 cyclic worlds |
  | Phase 8 vs Phase 9 handler | 19,200 |

## 4. Benchmarks (Phase 8 vs Phase 9, same process, same data, p50)

Every compared response was identical at every scale, without and with the relationship indexes.
Runs: about 15k staff (7 runs, or 5 with indexes), about 55k (3 runs), and about 97k (2 runs; genealogy and
referral lists only). The machine was noticeably noisy: identical code paths differed by up to
2x between runs. The table therefore shows same-run pairs only.

**Seller genealogy with the relationship indexes present** (the Phase 10 decision):

| Caller | ~15k | ~55k | ~97k | Data per request |
| --- | --- | --- | --- | --- |
| VD | 395 -> 185 ms | 1,350 -> 619 ms | 2,255 -> 1,091 ms | 2.6 -> 0.65 MB (15k); 17.4 -> 5.8 MB (97k) |
| SSM | 416 -> 109 ms | 1,258 -> 614 ms | 2,267 -> 1,078 ms | same |
| SM | 122 -> 52 ms | 1,274 -> 612 ms | 2,307 -> 1,109 ms | same |
| OST | 105 -> 51 ms | 1,301 -> 627 ms | 2,220 -> 1,115 ms | same |
| Member in a tree with a 300-level inactive chain (wide SM, deep OST) | 190 -> 286 ms | 1,466 -> 1,988 ms | 2,483 -> 3,168 ms | slightly more |

The last row is the designed fallback. The traversal hits its 32-level limit and the all-edges read
answers, so the traversal work is wasted: +20-35%, synthetic data only. Real hierarchies are about
4-6 levels deep.

**Without the relationship indexes (Atlas today):** same code path as Phase 8, results within run
noise. The added cost is the index check (`listCollections` + `listIndexes`), at most once a minute
per handler. Admin and Finance genealogy are unchanged (full read by design).

**Referrals:** unpaged lists are unchanged. The opt-in paged admin list costs 1,131 ms at ~55k
against 2,544 ms unpaged, because names are resolved for 50 rows instead of 61k. Seller lists are
unchanged.

**Members:** paged first page 3.3 s vs 4.3 s unpaged at ~55k (same process). The lean filter keys
were verified for identical output; no separate timing gain is claimed for them.

## 5. Stress tests (HTTP, disposable replica, mixed read/write)

Harness: `createHostedMongoHandler` over HTTP with the production-mode synthetic environment and
real sign-in. Areas: Customer (list, search, detail), Sales (list, detail), Finance (queue,
commissions, payment history; writes: record a payment, then a Finance user rejects it), IST/OST
(genealogy VD/SM/deep chain, referrals paged/unpaged, Members paged, an RBAC denial), Authentication
(session check, sign-in under the rate limiter), and Analytics (global, finance, sales trend). Each
level ran 20 s. Relationship indexes were absent, as in Atlas today. All figures are measured.

| Records (customers; staff; payments) | Concurrency | Req/s | Unexpected statuses | Client exceptions | Node CPU (1 core = 100%) | Max RSS | Event-loop p99 | Pool max / wait p99 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10k; 7k; 16k | 8 | 8.2 | 0 | 0 | 124% | 660 MB | 251 ms | 19 / 1 ms |
| 10k | 32 | 7.0 | 0 | 0 | 115% | 690 MB | 632 ms | 49 / 246 ms |
| 50k; 15k; 64k | 8 | 2.4 | 0 | 0 | 89% | 882 MB | 728 ms | 18 / 16 ms |
| 50k | 32 | 2.4 | 0 | 1 | 82% | 1,041 MB | 1,205 ms | 41 / 782 ms |
| 100k; 25k; 124k | 8 | 2.9 | 0 | 0 | 82% | 1,113 MB | 282 ms | 17 / 1 ms |
| 100k | 32 | 1.1 | 0 | 3 | 74% | 1,267 MB | 887 ms | 40 / 231 ms |

- **Correctness under load:** every completed request returned its expected status, including
  writes, the RBAC denial and rate-limited sign-ins. There were 0 pool checkout failures. The
  4 client exceptions happened on a keep-alive socket under the heaviest load; the cause is not
  proven (likely the server's 5 s idle-socket close racing a reused connection).
- **Throughput is CPU-bound in one Node process** (event-loop p99 up to 1.2 s). Concurrency 32
  mostly queues: p50 latencies rise to 5-30 s while req/s stays flat.
- **Single-request cost at 100k**, measured alone. These are the heaviest endpoints, which set
  throughput:

  | Endpoint | Docs examined | Time |
  | --- | --- | --- |
  | Finance queue | 220k | 4.9 s (8.4 s at 50k) |
  | Analytics global | 403k | 1.5 s |
  | Analytics finance | 324k | 1.2 s |
  | Customers search | 145k | 1.1 s |
  | Sales list | 215 commands (N+1) | — |
  | Payment history | 416 commands for 200 payments (N+1) | — |
- **Profiler:** COLLSCANs on `card_sales` (up to 25 s under load), `customers`, `payments` and
  `memberships` aggregations.
- **Index usage:** recorded per collection in the result files under `p9/stress/out/`.

## 6. Remaining bottlenecks (measured; outside the Phase 9 change scope)

- Finance queue (`GET /queues/finance`): 110-220k documents examined, 5-8 s alone at 50-100k. This
  is the largest single bottleneck.
- `GET /sales/{id}/payments`: about 2 queries per payment (416 commands for a 200-payment history).
- `GET /sales`: about 215 commands per list request (per-row lookups).
- Analytics global/finance: 320-400k documents per request at 100k.
- Customer search: 145k documents per request at 100k.
- One API process saturates one core. Production capacity needs either the fixes above or more
  processes (not deployed; no capacity claim).
- Member and referral lists still read every row to authorize, total and order. Paging reduces
  names, payload and browser work, not the database read.
- Validity probes scan four collections per seller genealogy request (server-side only, no
  transfer).

## 7. Security status (separate from performance)

U8 and U11 stay fixed; no new vulnerability found. U9 (credential rotation), U10 (`ost-contacts`
upline policy) and the legacy Supabase `ost-contacts` handler remain open; see
`SECURITY-REMEDIATION-2026-11-04.md`. Performance results are not security approval.

## 8. GO / NO-GO

**GO for Phase 10 (release-readiness review)**, on these grounds:

- All Phase 9 changes are verified equal to Phase 8, or opt-in.
- The suite is green and stable on a quiet machine.
- The relationship-index plan is final and guarded.

**NO-GO for production** until all of the following are done:

- U9 credential rotation is approved and done.
- U12 is decided (install the two relationship indexes, or keep the all-edges read).
- The finance queue, sales N+1 and analytics scans are addressed, or capacity is planned around them.
- U10 and U13 are decided.
- A real deployment target exists (D13: not deployed).
