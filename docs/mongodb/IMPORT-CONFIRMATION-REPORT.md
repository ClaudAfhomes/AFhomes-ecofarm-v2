# Native ordinary workbook confirmation and purchase continuation

27 October 2026. Workspace `AFhomes-ecofarm-v2`, branch
`claud/mongodb-conversion`. CMS remains last.

## Delivered

Ordinary company-workbook rows now continue through the existing MongoDB business
workflow. These routes no longer return an unported-operation response:

- `POST /customer-imports/jobs/:id/confirm`
- `POST /customer-imports/rows/:id/continuation`
- `POST /official-forms/customer-applications` with the existing `importContext`

The source writer preserves ordinary `company_v1` and `company_v2` prospect-intake
rules. It checks the persisted review source hash, current target revision, row
ownership, import/customer permissions and active sales hierarchy inside the
guarded transaction. Customer facts fill missing fields; incompatible existing
facts require review. Original raw and normalized evidence is retained. TIN
values stay private and are omitted from audit payloads.

Customer/source/claim creation is atomic with identifiers and audit events.
Confirmation processes at most 100 eligible rows per request using the existing
job/progress response. Each row is its own business transaction: a failed row does
not roll back committed siblings. The job moves into `committing` under the
organization lock before processing, preventing a concurrent cancellation race.
Failed rows retain evidence and require review. Canonical source receipts make
exact retries safe; equivalent source aliases and automatically keyed duplicate
claims reuse existing records. Provisional-source recovery and sibling-customer
reuse retain the narrowly allowed source-system conditions.

Where the company workbook requests it, VIP control numbers use the existing
Manila date, sequence, tier, cash/installment and term format. Manually occupied
sequence values are skipped. A control number does not create an authentication
identity, activate membership or establish verified money.

Imported application completion reuses normal draft creation. It links one
application to its source, preserves its customer/team and compares source-stated
price, reservation fee, tier and payment scheme against calculated purchase terms.
A mismatch rolls back the draft, source link and customer mirror. Historical
frozen terms are never rewritten from current catalog data.

The explicit local core-write gate permits the converted confirm and continuation
routes. Default writes remain blocked. Native transactions do not fall back to
Supabase. No localhost or request handler applies indexes automatically.

## Verification

PASS: **156 API tests across nine files**, including:

- `import-commit.mongo.spec.ts`: 11 native HTTP/replica-set tests;
- native continuation, payment claims, customer identifiers, development gating
  and ordinary official-forms integration;
- inherited import-handler and continuation-rule regressions.

New tests cover actual XLSX upload/parse/confirm, concurrent confirmation retries,
source receipts, stale identity and hierarchy rejection, permission/cancellation
denial, audit-failure rollback including business counters, invalid claim dates,
equivalent source/claim deduplication, VIP-number collisions and term-mismatch
rollback.

The combined HTTP test starts with the imported application's source link,
submits and approves the application, obtains its executed reservation and recorded
deposit, then matches the imported reservation-fee claim to that existing deposit.
It verifies the deposit and records/verifies the balance. Finalization is denied
before full verified payment, including while the balance is merely recorded.
It then finalizes and activates membership, retaining frozen terms and the
claim-to-payment link. Matching creates no duplicate deposit; no authentication
account is automatically created. Private-proof upload and claim recording have
separate native coverage in the same passing run.

PASS: **56 React tests across six files** for import/export, continuation, payment
claims, prefill, application actions and cache. These use component test services;
JSDOM emitted existing scroll/navigation not-implemented messages.

PASS: API TypeScript and environment isolation (733 browser files, 414 server
files). Repository lint completed from Turbo cache with zero errors and existing
32 admin / 9 web warnings; that command has no API lint task.

All database tests used fresh disposable loopback replicas, synthetic users and
HTTP cookie sessions. No Atlas records/indexes, Supabase data, existing
administrators, environment files or live private files were changed. No commit,
push or deployment was performed.

## Remaining work and limits

- Flat/legacy business confirmation and certified historical processing still
  explicitly return 501. Parsing/review support does not establish those writes.
- Live browser import-to-activation acceptance is NOT RUN for this checkpoint.
  Disposable tests do not establish full-platform cutover readiness.
- Full repository tests and a fresh build were NOT RUN for this checkpoint.
- Finish remaining non-CMS conversion and browser acceptance, including certified
  history/reporting scope, before CMS. Preserve temporary-password staff onboarding,
  VIP activation links/codes, existing administrators and disabled modules.

Source references: `20261208000016_afhomes_customer_import_continuation.sql`
and later ordinary-intake/payment-alias/VIP amendments in
`20261223000001_afhomes_customer_historical_import.sql`. These were inspected as
local references only; no SQL was applied.
