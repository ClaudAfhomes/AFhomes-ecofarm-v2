# Local browser and production-mode acceptance - 3 November 2026

Owner scope: complete browser acceptance and production-mode testing locally.
The owner subsequently requested a checkpoint commit/push before continuing the
unfinished browser checks. This checkpoint is not full release acceptance.
The app is not deployed to a Droplet. No production/Atlas
capacity, public TLS or live network performance is claimed. Supabase history
remains out of scope; administrators, current Atlas records and credentials stay
protected. All load/fixture writes use fresh disposable loopback MongoDB.

## Production-mode load: defect, correction and proof

The existing hosted-runtime test now exercises two fixed workloads: its original
240 requests / eight workers and a 10,000-customer fixture with 2,400 requests /
20 workers. Both use NODE_ENV=production, native cookie authentication, the
canonical host/proxy guards and filesystem-backed private downloads. Traffic is
local HTTP with explicit simulated HTTPS proxy headers, not actual public TLS.

Before the correction the large workload failed twice: requests exceeded the
unchanged 15-second deadline. The default customer directory enriched every
matching customer through membership/points/purchase/payment/application joins
before sorting and pagination. Concurrent full-dataset joins delayed other reads.

The default created-date directory now counts base matches and enriches only its
requested page in the same aggregation. Searches, derived filters and derived
sorts retain enrichment before pagination. No cached authorization, new index,
payment math, membership rule or persisted business record was changed.

The same large workload passes after correction:

| Measurement | Local result |
| --- | ---: |
| Customers | 10,000 |
| Requests / concurrency | 2,400 / 20 |
| Failures / request timeouts | 0 / 0 |
| Median / p95 / maximum | 103.52 / 209.29 / 299.33 ms |
| Throughput | 166.26 requests/second |
| Private downloads | 480 at 262,144 bytes each |

The same cookie immediately receives 403 after a deny-only restriction or staff
suspension; removing the restriction restores 200. Every measured response is
no-store and private byte counts are verified. The targeted load/customer run
passes 15 tests across three files. Two additional real-Mongo pagination tests
compare default paging with the existing late-enrichment path, including offsets,
stable ties, empty pages, exact totals, verified money and active-VIP filters.
API typecheck and scoped lint pass.

The complete API rerun after the correction passes **3,284 tests across 224
files**, exit 0, in 251.77 seconds. This total includes retained source/fake tests
and is not a count of native browser tests. In that parallel run the same large
workload also passed: p95 390.89 ms, maximum 706.30 ms, zero failures and 480
verified downloads. These timings reflect this PC and concurrent test activity.

`pnpm build:hosted` also passes using an explicit reserved synthetic HTTPS origin
and its server-environment-free public build. Built environment isolation passes.
Large-chunk warnings remain; this is not a browser navigation timing result.
No paid service, deployment or database/environment change was performed.

## Browser evidence and remaining checks

The Windows browser connector is unavailable, but native Chrome accessibility
and screenshot controls are responding again. The disposable QA origin uses
127.0.0.1, separate from the real administrator's localhost cookie jar.

| Workflow | Current evidence |
| --- | --- |
| Synthetic admin login | Existing signed-in disposable admin observed; earlier first-password redirect is owner-confirmed. |
| Disabled navigation | Reports, CMS, Redemption and Services absent from observed navigation. |
| Customer lookup | Synthetic VIP suggestion selected and card/validity/point buckets rendered. Seeded values are zero; positive allocation and newly issued VIP-number acceptance remain pending. |
| Members | Six synthetic members render after IST and OST creation; both new accounts have AA numbers and active status. |
| Cancel/reopen form | IST reopens blank after creation in a newly observed document. After OST success, Create OST reopens blank in the same document: identity, contact/address, photo, sponsor and signature evidence reset. No duplicate was submitted. |
| IST creation | Owner-entered credentials/submission confirmed. Browser renders the synthetic IST with employee code, AA number and active status; membership count increases from four to five. The same record appears in a newly observed browser document. Explicit automated reload remains blocked by URL-verification controls. |
| OST creation | Owner submitted Create and accredit. New synthetic OST appears immediately with active status and an AA number. |
| Public verification | Both newly created IST and OST return Accredited with their AA numbers, masked names and rendered synthetic profile images. The second lookup reuses validated synthetic contact details and requests a fresh security check. The owner explicitly requested the same public card for both kinds, with no expiry or IST/OST distinction; that existing display is preserved and covered by nine passing page tests. Anonymous config is HTTP 200, available=true, localPreview=true; Cloudflare test keys report Success automatically. This is not hosted privacy approval or production CAPTCHA-key proof. |
| Complete purchase/payment/activation/points | Pending browser acceptance. |
| Workbook flags/review download/reupload/confirm | Pending browser acceptance. |
| Each role and customer portal | Pending browser acceptance. |
| Browser console/network and reload persistence | Pending browser acceptance. |

Chrome autofill introduced saved personal values during address entry; those were
replaced with synthetic values before any submission. No personal values or
screenshots are copied into this report. New credential entry/submission remains
the owner's action under the browser tool confirmation policy.

Do not infer full browser acceptance from native HTTP tests or successful builds.
Browser acceptance is still in progress; the remaining purchase/import/role flows
have not yet been completed. The browser access host is unavailable, and native
browser navigation previously stopped on URL-verification checks. The owner was
asked to open the public QA tab while keeping the Admin tab. The checkpoint push
is now explicitly authorized; the remaining browser rows stay pending.
The temporary verification sleep-prevention request was released when
the complete API run finished; no permanent power setting changed.

## Tablet layout correction

Native Chrome showed Position/Status badges wrapping into vertical letters at
tablet width. The scoped Members table now keeps those two labels on one line
at widths of 640 px and above, using the existing horizontal scroll container.
The existing under-640 px card layout is unchanged. Native Chrome then showed
readable horizontal role labels and compact rows at the affected width. Focused
Members/Create OST tests pass 32 tests across two files; Admin typecheck passes.
Other widths and horizontal keyboard scrolling still require browser checks.
The subsequent hosted rebuild and built-bundle environment-isolation guard pass.

## Checkpoint review

The public card retains its existing shared Employee Identity label and omits
expiry for both IST and OST, as explicitly requested by the owner. Nine public
search page tests, Web typecheck and scoped Web lint pass after that decision.
Workspace typecheck and source environment isolation pass again before staging.

An invalid synthetic company-v1 workbook upload produced a persisted preview
with zero valid / one invalid row, the Primary!G2 cell and birth-date reason,
and disabled confirmation. The observed preview has no review-workbook download;
its cause and correction/reupload/confirmation are still unverified. Guided-v2
review download has native HTTP coverage, not completed browser acceptance.

Only reviewed MongoDB source, tests and Markdown are selected for the checkpoint.
Local environment files, certificates, archives, generated JSON reports,
screenshots, diagnostic/account-reset scripts and unrelated experimental database
harness changes remain outside this commit. Secret-pattern and exact local-secret
value checks found no matches in the selected files; these checks are not a claim
of a complete security audit.
