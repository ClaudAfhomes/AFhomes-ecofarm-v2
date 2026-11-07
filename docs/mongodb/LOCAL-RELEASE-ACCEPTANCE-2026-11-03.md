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

## Follow-up after checkpoint a16b9e0

The company-v1 upload reproduced a missing review download: its parser produced
validated rows without the original source-cell map used by the existing review
renderer. Both native and retained source handlers now receive that map from the
shared file reader. Exact generated review headers are accepted on re-upload;
unmapped headers remain rejected. The native regression failed before the fix,
then verified all entered source values, the red birth-date cell, explanations,
corrected re-upload and unchanged customer counts. The relevant four-file API run
passes 128 tests. Browser preview on the updated disposable runtime shows the
download button and invalid-cell explanation. The download click was not verified:
the native screenshot reference expired and the owner changed/closed the QA tab.

The owner then explicitly requested Turnstile on every MongoDB login, including
Admin/Super Admin. The former Admin exemption is removed. All login forms use
the login action; the shared cookie client and both session providers forward
the token in x-captcha-response. Better Auth's installed CAPTCHA plugin verifies
the token before credential/session creation, limits issuance to the configured
hostnames and login action, and fails closed on rejected/upstream-failed checks.
Application launchers require the public site key and server-only
AFHOMES_AUTH_TURNSTILE_SECRET. Isolated library fixtures can still omit login
CAPTCHA configuration; they are not application entry points.

The ignored local env now copies the existing matching Turnstile widget secret
into the login-specific server variable. No credential was printed or committed;
no Cloudflare setting, real administrator, password, role or business record was
changed. Cloudflare's documented dummy secret is confined to HTTP loopback QA;
its observed response reports example.com and omits action. That fixture-only
response is accepted; live keys always require action=login and trusted hosts.

Direct HTTP against the new disposable runtime and actual Cloudflare dummy
Siteverify returned 400 without a token and 200 with the documented dummy token.
That is integration proof, not real-key browser CAPTCHA acceptance. Controlled
real-library tests deny invalid, expired/reused, wrong-host and wrong-action
tokens without creating sessions; provider failure blocks login. Hosted HTTP
tests retain secure cookies, password-change enforcement and revocation.

VIP activation's subsequent ordinary login now receives its own challenge. If
activation succeeds but login fails, the UI preserves the successful activation
and points to Sign in rather than asking to reuse the consumed code. The relevant
Web run passes 91 tests across five files. Public search keeps its existing
shared identity display with no expiry or IST/OST distinction.

Post-login-protection load passes 2,400 requests / 20 workers / 10,000 customers:
zero failures, p95 395.24 ms, maximum 472.91 ms and 480 verified 256-KiB downloads.
Cloudflare is stubbed for that fixture's single initial sign-in; these timings do
not measure real external Siteverify latency, public TLS, Atlas or a Droplet.
The hosted build and built environment isolation pass with an explicit synthetic
public build key. Existing large-chunk warnings remain. A broad parallel API run
was stopped after timeouts; a one-worker rerun is in progress without relaxed
application/test deadlines. Full browser acceptance remains pending.

The current disposable security QA origins are Admin 127.0.0.1:53601 and Web
127.0.0.1:53602. The owner confirmed the Cloudflare/first-password/sign-in handoff;
native Chrome then showed the signed-in synthetic Super Admin dashboard. This
does not prove every role or the remaining purchase/import screens. Old disposable
runtimes were stopped to release resources; their four frontend ports are no
longer listening. The real localhost/Atlas runtime is separate.

The owner requested this second checkpoint commit/push before continuing browser
acceptance. Focused Admin tests pass 17/2, Web 91/5, shared cookie client 8/1,
widget 2/1, native authentication/hosted configuration 30/3 and import 128/4.
Workspace typecheck and scoped lint pass (existing UI warnings remain).
The broader serial API run is still in progress; it is not recorded as a clean
full-suite run. Local environment secrets and unrelated artifacts remain excluded.

## Verification after d89023d

The serial API run completed with 3,286 passing tests and one production-scope
fixture failure: its hosted configuration lacked the newly mandatory login key
pair. The fixture now supplies synthetic values to the hosted-config check;
namespace/auth isolation assertions are unchanged. That regression and adjacent
authentication/hosted tests pass. A complete rerun then passes **3,287 tests across
225 files**, exit 0, in 337.62 seconds with two workers and unchanged deadlines.
The earlier interrupted/failed runs are not treated as passing.

Browser acceptance on 127.0.0.1:53601 downloaded customer-import-review.xlsx from
the invalid company-v1 preview. Read-only inspection of that exact download
verified every original source value, the red Primary!G2 cell, its reason and
re-upload parser compatibility. The corrected synthetic source differs only in
birth date. Its preview showed one valid / zero invalid rows; browser confirmation
reported one written / zero failed. Job history persisted the completed job with
one inserted row, while retaining the earlier invalid preview as a separate job.

At tablet width, the import tab panel's minimum-content sizing stretched the page
and vertically centered short values in a long review row. The page-scoped tab
panel now shrinks around its existing horizontal table container, cells align at
the top, the Errors column has readable width, and the CREATE chip stays on one
line. Native Chrome verified contained horizontal scrolling, readable source
values and reachable confirmation. Sixteen import-page tests pass. Further
mobile/keyboard and application/payment/activation/role browser checks remain.

These fixture/layout/report follow-ups are local and not yet committed.

The browser's imported-purchase continuation exposed a legacy route redirect
that discarded customerId and importRowId. The redirect now preserves query and
fragment, using the same location handling as canonical staff routing. A routing
regression failed with the original code, then passed alongside nine adjacent
route/session checks. Admin TypeScript and scoped lint pass. Native Chrome
confirmed both parameters survived, selected Synthetic Browser Workbook, and
showed the imported-details review notice plus the mandatory actual purchase
reference and acknowledgement date. The synthetic Bronze purchase reached the
next-step action; submission, payment and activation were not completed before
the disposable runtime stopped. This is a local frontend fix, not an Atlas apply.

4 November: the prior disposable listeners and browser session were no longer
running. A fresh synthetic loopback runtime was started for continuing acceptance;
its first-login credential change requires another owner handoff. Earlier
workbook/download and continuation observations remain recorded above, but the
old runtime's synthetic records are not assumed to exist in the new one.

The owner completed the fresh 4 November first-login change and sign-in.
Native Chrome confirmed the signed-in synthetic Super Admin dashboard. The
corrected workbook again previews one valid / zero invalid rows.

Hosted authentication previously overwrote Nginx's client-IP header with its
loopback socket address, making different users share one rate-limit key. Only
the reviewed hosted runtime now opts into trusting a single valid X-Real-IP from
a loopback peer; direct runtimes and non-loopback peers still use the socket IP.
IP lists, invalid addresses and scoped IPv6 fall back to that socket peer. Nginx
already overwrites incoming X-Real-IP. Nineteen transport/auth/hosted tests pass;
the extended real-Mongo hosted test also verifies that the native auth session
stores the proxy-provided synthetic client IP. API TypeScript and scoped lint
pass. This is local proxy integration proof; no Droplet has been deployed.

The fresh browser import committed one row with zero failures and resumed its
identity/evidence/seller chain. Submission exposed another real UI defect: the
Holders step marked a record complete without the address required by the write
contract, then displayed raw schema issues. Holder readiness now uses the shared
applicationHolderSchema, blocks submission consistently, and summarizes holder
validation in readable, deduplicated guidance. The new regression failed first;
the corrected prefill suite passes six tests including missing/valid-address
cases and error guidance. The adjacent action/prefill run passes 31 tests.
Chrome verified the new blocker, then accepted the completed catalog address and
submitted AF-APP-2HB88. Approval succeeded and Finance displayed its reservation
AF-RES-YHYXY. Payment recording/verification and activation are still in progress.

Performance remains open: two new full workload attempts hit the unchanged
60-second test deadline; smaller 240-request workloads had zero failures. A
10,000-customer diagnostic measured 12,111 ms of setup and 26,441 ms for the first
600 requests before timing out. Setup/progress/route timing is being collected
without credentials or private-file URL values. The older complete passing run
above remains historical evidence, not a claim that today's load gate passed.
