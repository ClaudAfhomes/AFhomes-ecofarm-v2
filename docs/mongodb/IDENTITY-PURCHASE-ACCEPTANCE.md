# Identity intake and native purchase acceptance

27 October 2026. Active branch `claud/mongodb-conversion` in
`C:\Users\SSD-CLAUD\AFhomes-ecofarm-v2`.

## Delivered

- Native `/documents` upload grants, bounded signed binary transfer, server-side
  file-size/signature/hash verification, scoped list/detail/current reads,
  short-lived private downloads, OCR suggestions/manual fallback and explicit
  human review. Upload completion does not approve identity. Current ID remains
  the newest file-backed, non-rejected row; reviewing an older row cannot steal
  currentness. Confirmation mirrors missing customer ID fields only, preserving
  existing values and the source duplicate-warning behavior.
- Staff authorization and seller ownership match the source. Mutations recheck
  authorization under the organization/subject locks. Metadata/review/audit
  changes are transactional. Government ID values are masked in reads and absent
  from audits. Anonymous upload URLs are HMAC-bound to one document, nonce and
  expiry, with exact file size/type limits and concurrency/replay protection.
  Failed staged file writes are removed or queued for cleanup. Crash-orphan file
  sweeping remains a separate storage-maintenance concern.
- Customer Lookup signs the current private ID image after the existing active
  VIP authorization/filter. Current ID metadata is batched for the bounded page.
- MongoDB plan creation now supplies the PostgreSQL benefit defaults. Missing
  benefit fields are defaulted only while taking prospective application/offer
  snapshots; historical snapshots are not rewritten.
- Official-form lists return the existing explicit summary contract, including
  `id`, instead of raw MongoDB rows. The approval action checks the resulting
  reservation before attempting legacy terms review, avoiding a second capture
  after automatic reservation creation. Legacy approval/review behavior remains.

No new dependency, environment-file change, invitation, administrator reset,
Supabase data migration, Atlas business test, commit, push or deployment was made.
ID indexes have not been applied to Atlas by this continuation.

## Proof

- Full API: **2,905 tests / 170 files passed**, exit 0, using
  `vitest run --maxWorkers=2 --testTimeout=30000`.
- Final current-ID batching and purchase regression run: **14 passed**;
  API TypeScript passed. The full-suite result above preceded that final
  query-only batching change.
- Focused admin UI: **72 passed / three files**, including the approval
  regression and adjacent forms/Finance screens.
- Workspace/operator TypeScript, repository lint and build passed. Lint retains
  existing warnings (32 admin, 9 web); build retains its chunk-size warning.
  Source/built environment isolation passed.
- Earlier overnight API run timed out across a machine interruption; it was
  not counted as PASS. Affected suites and the subsequent full run passed.
- Browser: manually entered and submitted a fictional application with a generated
  PNG ID; reloaded the submitted record and saw Identity complete. A subsequent
  fresh fixture verified the corrected approval, automatic executed reservation,
  recorded deposit, deposit verification, remaining cash payment, verification,
  finalization and membership activation through the existing Finance UI.
- Browser confirmed recorded money did not reduce the verified balance, then
  showed zero balance after verification and eligibility before activation.
  Activation allocated **zero** initial points. Customer Lookup found the active
  VIP afterward. The final runtime also returned its signed private ID image.
  Screenshot: `.tmp-bin/mongodb-id-lookup-proof.jpg` (synthetic data only).
- Browser signed in the activated synthetic VIP, displayed its active Bronze
  membership and zero initial points, then showed both verified payments
  (10,000.00 and 90,000.00) after reload. No console errors were recorded.
  Screenshot: `.tmp-bin/mongodb-vip-payments-proof.jpg`. The Members browser
  also displayed the newly created IST and OST with AA numbers after reload.
- Normal native HTTP completed the manual-code VIP account activation in a fresh
  disposable runtime, without printing the token/password.
- Native account creation created IST and directly accredited OST with profile
  photos and AA identities. Temporary-password gates remain enforced; IST has
  no accreditation expiry. No sponsor endorsement was fabricated.
- Public server verification used the actual Cloudflare Siteverify test-key
  service and its documented dummy token, not a fetch mock: both new AA records
  returned accredited, masked results and delivered their photos. Evidence:
  `.tmp-bin/network-public-proof.json`. This was loopback **preview** only.
- Cloudflare's dummy verifier returned `example.com` in the observed test
  response. The disposable launcher therefore allows `localhost,example.com`
  for its dummy keys only. Shared hostname verification remains strict. See
  [Cloudflare testing documentation](https://developers.cloudflare.com/turnstile/troubleshooting/testing/).

## Dashboard and normal-reservation read follow-up

Final focused API regression: **106 passed / seven files**, exit 0
(`.mongodb-analytics-claims-final.log`). Includes native disposable analytics,
signed documents, real cookie/runtime routing, read gates and inherited analytics
regressions. The separate workbook retry passed **14 tests**, exit 0
(`.mongodb-workbook-recheck.log`). Dashboard UI suite passed **15 tests**, exit 0
(`.mongodb-analytics-ui-final.log`); its earlier worker-start timeout was not a pass.

API `tsc --noEmit`, repository lint and build passed; lint/build reused unchanged
Turbo results and retain the previously recorded warnings. Built/source environment
isolation passed across 733 browser and 395 server files. The wider API retry hit
an unrelated workbook timeout and was interrupted; **there is no new full-suite
PASS after the analytics extraction**. Its isolated workbook retry and relevant
analytics/document/runtime suites passed. The earlier 2,905-test result remains a
prior checkpoint, not proof of the final complete tree.

No Atlas writes, index applies, identities, administrator credentials, environment
files, remote branches or deployment configuration were changed by this follow-up.
Browser evidence was produced exclusively in disposable loopback replicas.

## Remaining boundaries

Public browser disclosure is **NOT VERIFIED**: its external test widget failed
with code `300030` in the automated Chrome session. No client token was injected,
bot check disabled or production hostname allowlist relaxed. The public page,
draft notice and contact gate rendered. Non-preview privacy/healthy-worker gates
have separate disposable HTTP tests; real localhost disclosure still needs the
owner's completed/approved notice, verification contact and real widget settings.

The dashboard overview and monthly/yearly trend now use native MongoDB reads
and the same pure calculations as the inherited handler. Frozen snapshot team
attribution, legacy exclusions, role scopes, exact money and verified-only totals
are preserved. Chrome displayed the two synthetic sales and their frozen
200,000.00 total, switched to yearly recognition and retained results after reload.
No browser console errors were recorded. Screenshot:
`.tmp-bin/mongodb-dashboard-proof.jpg`.

The optional imported-claims panel now performs an authorized native read. Normal
reservations return their actual empty claim query, with both Finance and customer
view permissions required. Real imported claims still return an explicit 501;
claim proof/versioning/reconciliation is not implemented. Seller analytics also
fail closed when native import attribution cannot be established. Team-sales
analytics subroutes, imports/workbook, member editing/transfers and reporting/CMS
still require conversion and acceptance. This is not a fully converted platform.

The separate company-entered VIP card number remains optional, as in the source;
it is not silently replaced with the generated membership number. Default-off
Redemption and operational Services remain preserved and disabled.
