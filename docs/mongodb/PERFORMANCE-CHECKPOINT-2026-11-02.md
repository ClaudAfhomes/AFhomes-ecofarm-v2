# Local performance and cache verification - 2 November 2026

All workloads used fresh disposable loopback MongoDB, synthetic identities and a
self-created temporary private-file directory. No Atlas load, shared mutation,
environment change, new cache infrastructure or paid service was used.

## Authenticated HTTP and private files

The repeatable `api/_lib/runtime-load.mongo.spec.ts` serves the existing hosted
handler on a random loopback port. It simulates the canonical HTTPS reverse-proxy
headers; the actual local transport is HTTP. A synthetic Sales Manager requests
session, card products/categories, customers and signed private downloads.
The Members screen is correctly denied to that fixture; no grant was widened to
make the benchmark pass. Every measured response carries no-store.

| Metric | Result |
| --- | ---: |
| Requests / concurrent workers | 240 / 8 |
| HTTP failures | 0 |
| Private downloads | 48 |
| Bytes per private download | 262,144 |
| Median / 95th percentile / maximum | 52.16 / 74.35 / 92.86 ms |
| Aggregate throughput during this probe | 150.85 requests/second |

Using the same signed-in cookie, adding a deny-only Customer permission takes
effect on the next request (403), removing it restores the permitted read (200),
and suspending the account immediately denies the next read (403). This proves
these server permissions were not served from a stale cached grant. It does not
claim that previously issued short-lived file capabilities are forcibly revoked.

## Concurrent writes and import retries

The points-adjustment HTTP suite now sends sixteen simultaneous independent
corrections against one synthetic membership. All sixteen return 200 and create
exactly sixteen ledger records. Totals increase by 160: 112 weekday and 48 weekend
points. Membership/account mirrors agree, existing payments remain byte-for-byte
equal, and lifetime allocation is unchanged. Measured completion: 977.88 ms.
The suite restores its temporary fixture permission in finally.

The adjacent import-commit suite proves concurrent confirmation/revalidation
reuse, duplicate-account prevention and transactional audit-failure rollback.
The combined load/points/import run passes **36 tests across three files**.

## Cache corrections and client checks

Two failing regressions reproduced defects in the inherited shared address cache:

- An old in-flight rejection after clear removed a newer successful cache entry,
  causing an unnecessary third upstream request. Eviction now checks the promise
  still owns the entry.
- Array-only copying exposed shared address row objects to caller mutation.
  Each caller now receives cloned reference rows as well as its own array.

Address provider and address handler tests pass **37 tests across two files**.
Admin session identity/logout/Mongo-session/import invalidation checks pass
**seven tests across four files**. Those UI tests use controlled mocks; they do
not replace final browser acceptance.

Existing 10,000-row index measurements remain query-plan evidence, separate from
the small-fixture HTTP load above. No production latency/throughput/capacity is
inferred. Longer staging soak tests, representative large imports/uploads and
browser role acceptance require their corresponding environment and review.
