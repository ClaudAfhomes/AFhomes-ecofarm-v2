# Performance checkpoint - 30 October 2026

These measurements use disposable loopback MongoDB only. No Atlas index, data,
environment, permission or existing account changed. No cache was added.

## Query work under existing performance indexes

The fresh full API run passed `performance-indexes.mongo.spec.ts` (3 tests).
The same 10,000-row workloads return identical results before and after the
six existing index definitions are installed on the disposable database:

| Query | Rows returned | Before docs / keys examined | After docs / keys examined |
| --- | ---: | ---: | ---: |
| Sale-time ancestor lookup | 50 | 10,000 / 0 | 0 / 50 |
| Staff seller/date sales | 50 | 10,000 / 0 | 50 / 50 |
| OST seller/date sales | 50 | 10,000 / 0 | 50 / 50 |
| Committed import referral search | 100 | 10,000 / 0 | 100 / 102 |
| Current purchase source | 1 | 10,000 / 0 | 1 / 1 |

The tests also check stale-plan refusal and installation behavior. This verifies
query work/result preservation; it is not a concurrent production load test.

## Bounded authenticated HTTP smoke load

A local operator probe created its own replica, private temporary directory and
synthetic staff/catalog/member fixture, served the existing hosted handler on a
random loopback port and signed in once. It alternated 90 authenticated requests
with five concurrent clients across session, card-products and members reads.
All requests completed HTTP 200; response bodies/cookies/credentials were not
logged. The temporary server, database and private directory were removed.

| Metric | Result |
| --- | ---: |
| Successful requests / failures | 90 / 0 |
| Median latency | 18.20 ms |
| 95th percentile latency | 32.49 ms |
| Maximum latency | 42.01 ms |
| Aggregate throughput during this probe | 249.28 requests/second |

An initial probe used a nonexistent `card-plans` URL and stopped on the expected
403 conversion guard; the corrected probe uses the canonical `card-products`
API family. No application route or authorization guard was loosened.

This is a small-fixture read smoke test during local test execution. It does not
establish Atlas/network latency, Droplet capacity, large-page memory use, sustained
load, uploads/import throughput or contention between commercial writes. The
10,000-row index test and this HTTP probe measure different workloads and must
not be combined into a production capacity claim.

Remaining work includes representative concurrent purchase/import/file workloads,
longer-running measurements on approved staging hardware, per-role cache and
identity-change checks in the browser, and the previously approved validator
installation blocked by missing maintenance privileges. Existing synthetic cache
invalidation tests remain part of the full Admin suite.
