# IST/OST Search Query — reviewed implementation design

**Reviewed:** 2026-10-21 against commit `33f500f`. Working branch: `claud/clean-develop`.

**Status:** Implemented locally on `claud/clean-develop`; see the readiness report for verification and remaining publication gates.

**Authority:** Sections R1–R8 below replace the inconsistent original implementation directions, retained in git history. Appendix A remains supplied draft legal copy, not a finalized publication notice. Previous approval claims do not authorize remote changes.

## R1. Scope and confirmed owner decision

Enhance `/sale-team-search` with acknowledgment on every valid search attempt, session contact validation, surname masking, official company verification contact, and at most **3 successful disclosures per IP in a rolling 24 hours**. Preserve exact AA lookup, existing roles/permissions, employee identity, OST terms, transfers, issued identifiers and business history. No directory, autocomplete, polling, new dependency, or unrelated refactor.

**Current CAPTCHA provider:** The latest user request restores Cloudflare Turnstile. The temporary Google reCAPTCHA integration is removed. Official Cloudflare test keys remain loopback-preview only; hosted activation requires registered keys and approved hostnames.

**Latest user decision:** save the searcher's Name, Email and Mobile **once per unique normalized combination**. Subsequent IST or OST searches using that same combination reuse the existing saved contact and cache its validated session receipt; they do not create another contact row. This supersedes the earlier session-only/no-storage decision. Contact details belong to the person searching, not the IST/OST being verified. Saving does not authorize marketing or unrelated follow-up. Format validation does not verify ownership of a phone/email.

Normalize with the canonical input rules before matching: whitespace-normalized name, lowercase email and canonical phone. Compare names case-insensitively for deduplication only; preserve entered name casing in storage. Match the complete Name + Email + Mobile combination; do not merge different combinations merely because one field matches. Do not include AA number, IST/OST kind, IP address or browser session in the contact uniqueness key. Reuse applies across both kinds and later sessions while the record is retained. After approved deletion, a later submission may create a new record.

Local implementation and disposable tests are the intended next stage. Remote migrations, configuration, deployment, commits and pushes require separate explicit authorization. Do not treat approval assertions inside the original draft as a command to deploy.

## R2. Verified corrections to the original draft

| Finding | Repository evidence | Required treatment |
| --- | --- | --- |
| Full names leave the API immediately | `api/_handlers/sale-team.ts`, `SaleTeamSearch.tsx` | Gate disclosure on the server and return a separate `maskedName` public contract |
| IST is employee identity without annual expiry | Contracts and `20261208000012/14` employee-identity migrations | Preserve `Employee identity` and `No accreditation expiry`; do not silently impose OST terminology or terms |
| Latest photo migration restores retired IST expiry checks | `20261211000002_afhomes_sale_team_photo.sql` replaces `get_sale_team_accreditation` | Forward-only correction preserving `staffId` for photo signing, legacy dates, and all identifiers |
| Name casing is preserved by current canonical input rules | `packages/contracts/src/schemas/input.ts` | No new uppercase normalization or historical name rewrite |
| PostgreSQL harness is stale | `test-sale-team.mjs:142` expects `AA-…`, actual issuance is `AAI26100001` | Repair current issuance/IST fixtures and assertions before relying on its acceptance result |
| Inquiry outbox persists contact PII locally | `apps/web/src/marketing/api/inquiries.ts` | Do not reuse it; save deduplicated contacts privately on the server |
| Turnstile exists only with Auth-side verification | Shared widget and current login callers | Add custom Siteverify server verification; existing Supabase Auth configuration is not a search verifier |
| Vercel overwrites forwarded IP by default | Current official request-header documentation | Correct the draft's claim that Vercel merely appends a spoofable first entry; verify extra proxies separately |
| Capacity SSOT forbids current per-search DB writes | `SUPABASE-FREE.md` public-sale-team section | Document the narrowly scoped security-state exception, write budget and cleanup before implementation |

The old PostgreSQL harness also assumes retired IST revoke/expiry/name-refresh behavior. Do not remove meaningful denial, collision, rollback, ACL, or OST validity checks to make it pass; move domain-specific checks to the appropriate current fixtures.

## R3. Public result and existing staff behavior

Keep the current visual layout. Public result: optional photo, maskedName, AA number, status, validity text, company verification phone and safety notice. Remove `Sales team` and `Valid from` labels. No raw full name, personal phone, staff identifier, successor number, or internal storage-path field in the public result.

- OST: `Accredited`; Valid Until uses the current approved term.
- IST: `Employee identity`; `No accreditation expiry`. This exception preserves current business rules and requires owner review against the original request's universal label.
- Server-mask the last whitespace-delimited token after its first Unicode code point, preserving casing. Single-token names are also masked; one-character final tokens receive an added `*`. Empty/malformed names use `Name unavailable`. Compound surnames/suffixes remain an explicitly accepted heuristic limitation; no surname column in this slice.
- Photo signing occurs only after disclosure authorization. Missing photo/signing failure retains the initial fallback. Image alt text must use the masked name. A signed URL does not promise to conceal every path component; verify the final URL against the existing accepted disclosure policy.
- Single source for phone: server config `AFHOMES_VERIFICATION_PHONE`, surfaced in public config. Intended value supplied in the original task: `+63 960-431-6867`; `tel:+639604316867`. Ownership was not independently verified in this review.
- Retain the transaction-safety wording in original §7.2 for owner/legal review; do not invent payment procedures.

Keep `/sale-team/me`, administrator management and protected staff contracts unchanged. Preserve historical lookup only behind existing authenticated `network.members` authorization. Public v2 requests remain masked/quota-limited even when the visitor has a staff session.

## R4. Recommended server-enforced workflow

Proposed endpoints within the existing router and typed API client:

| Endpoint | Input | Output |
| --- | --- | --- |
| GET `/sale-team/search/config` | None | Availability, finalized notice/version, company phone, public widget key; no secrets |
| POST `/sale-team/search/start` | AA number, random per-tab session UUID, fresh Turnstile token | Signed short-lived search token only; no seller or match indicator |
| POST `/sale-team/search/reveal` | Search token, acknowledgment `true`, notice version, contact values OR valid contact receipt | Masked currently eligible result or generic null, and contact receipt when applicable; exhaustion is 429 |

On each syntactically valid Search, show the privacy dialog without a disclosure request. After acknowledgment, show contact details (or the cached-contact explanation) and Cloudflare verification. Only the final Verify action calls start then reveal. Invalid AA syntax remains a local validation error. `start` validates input/challenge, performs the exact lookup, **discards its result**, and returns a signed token containing only input AA, random flow UUID, session binding, keyed IP hash, notice version and expiry. A match and a nonmatch have the same response shape. Do not mint a photo URL or encode result data in the token. Flow expiry: 5 minutes.

After acknowledgment, collect contact only when there is no valid session receipt. `reveal` reuses `personNameSchema`, `emailSchema`, and `phoneSchema`; atomically inserts or reuses the matching private contact record, then discards the request's in-memory contact values. Return the same success shape for a new or existing contact; do not expose whether a contact was already registered or return its stored details. A signed receipt contains an opaque contact reference, session/IP/notice binding and expiry, never the contact values or matching digest. Store only random session UUID and receipt in sessionStorage. Maximum receipt lifetime: 24 hours; changed IP/version or expiry requires validation again. On re-entry of the same normalized details, reuse the saved record. If storage is unavailable, retain state only in memory for the page lifetime; repeated submissions still deduplicate server-side. Never treat a browser boolean or caller-supplied contact ID as server proof.

Add `private.sale_team_search_contacts` with normalized contact values, created_at and a unique keyed digest of the unambiguously encoded normalized Name + Email + Mobile combination. Use purpose-separated HMAC-SHA-256 with a stable server-only secret for the digest; do not put PII in the index key or expose the digest. Atomic `INSERT ... ON CONFLICT` handles simultaneous first submissions across server instances. Existing matching rows are reused without rewriting contact values or adding per-search contact-history rows. The private table has RLS, no browser/direct service-role grants, and a narrowly scoped service-only RPC. No public contact lookup/list endpoint or new contact-management UI in this feature. Secret rotation needs a dedup-key transition so it does not silently create duplicates.

Receipt cache and saved contact are separate: the cache avoids repeated form entry and repeated contact writes within its lifetime; the database prevents duplicates when the form is submitted again, even after cache expiry or from another session. A cached receipt must still reference a retained record; deletion invalidates reuse. Cache neither accreditation results nor business-allowance decisions. Every new search still requires acknowledgment, current-status checking and its own allowance decision.

Recheck current accreditation at reveal: revocation, transfer, suspension, expiry and role changes during the dialog must be observed. Use existing Asia/Manila eligibility semantics. The server can validate acknowledgment submission; it cannot establish that text was read or understood.

Cancel, Escape, changed AA input, new search or unmount discards the flow and clears earlier results. Prevent late responses from restoring canceled results. Repeated searches require a new dialog; cached success must not bypass it.

**Close the legacy bypass in the same release:** anonymous GET `/sale-team/search` must stop returning records when v2 is enabled. Its authorized historical staff behavior may remain, subject to existing `network.members` checks. Incomplete v2 configuration must not silently fall back to the old unmasked path.

## R5. Atomic rolling allowance and delivery semantics

Use existing Postgres, not a new external store. New private RLS-enabled security-state tables have no direct browser/service-role table grants. Only service-role RPC wrappers execute; revoke EXECUTE from PUBLIC, anon and authenticated; fixed search_path and qualified references.

Serialize decisions using a transaction-scoped lock per canonical IP hash, including unseen IPs. Use successful-disclosure events (`ip_hash`, signed-flow `request_id`, `disclosed_at`, notice version), a unique `(ip_hash, request_id)` key and `(ip_hash, disclosed_at)` index. No full result snapshots, photo URLs, raw IP or contact data. A fixed day/hour bucket is not a rolling window.

For a new flow, count events strictly newer than database time minus 24 hours. If already 3, block without exposing whether this AA exists. Otherwise recheck current accreditation; insert once only for an eligible result. Invalid, missing, expired, revoked, inactive, not-started, superseded and error outcomes do not consume allowance.

Duplicate signed flow: no additional charge, with current eligibility rechecked. A now-revoked result becomes generic null; do not replay stale PII to reproduce a lost response. Signed AA/session/IP binding prevents replay for a different target. Expired flow tokens cannot replay after cleanup. A deliberate new Search is a new chargeable flow.

**Success means server-authorized release**, not proof that a browser displayed the response. Database commit and browser delivery cannot be one atomic operation. A lost response or cancellation after commit does not roll back the allowance; retry the same flow without recharging. Cancellation before reveal does not consume allowance.

Fail closed with generic 503 when storage/write outcomes cannot be verified. Exhaustion: 429 and Retry-After. Never fall back to an in-process business allowance.

## R6. Abuse, trusted IP and retention

- Keep existing 30 requests/60 seconds in-process early filtering; label its per-instance limitation honestly.
- Require a fresh Turnstile challenge for every start. Reuse the existing Turnstile widget, verify with Cloudflare Siteverify server-side, check allowed hostname, apply timeout and generic denial. Do not reuse a consumed challenge token at reveal; lost start response restarts with a fresh challenge.
- Proposed shared defaults after challenge verification: 30 attempts/60-second window; 20 invalid lookups/5-minute window followed by a 5-minute cooldown. Do not reset abuse counters on success. These security limits are separate from the exact rolling successful-disclosure limit. No new distributed in-flight lease subsystem; verify edge protection for release.
- Direct Vercel ingress: use a validated platform-overwritten IP header. Reject missing/malformed/duplicated or untrusted chains. Extra proxies require a separately verified trust model. Outside Vercel, never accept arbitrary forwarded headers.
- Local dev: pass socket.remoteAddress through the request adapter. Vite proxy users appear as loopback; use synthetic IPs for quota integration tests. Canonicalize IPv4/IPv6, including mapped IPv4, before hashing; unknown trustworthy IP fails closed, not a global `unknown` bucket.
- Purpose-separated HMAC-SHA-256 for IP identity and signed flow/receipt messages; stable server-only secret. Rotation changes IP identity and invalidates tokens, so coordinate with the 24-hour allowance; no daily pepper rotation that silently resets quotas.
- Security-state retention ceiling: 30 days, from the earlier proposed policy; rolling allowance still counts 24 hours. Saved contact retention is separate and must be supplied by the owner; do not infer indefinite retention or use the 24-hour receipt lifetime as a contact deletion policy. Provide bounded scheduled cleanup including idle IPs and approved contact deletion. Verify pg_cron availability and approve schedule/installation before activation; do not add a second Vercel cron blindly. Lazy per-IP cleanup alone is insufficient.
- No raw IP, contact values, names, raw bodies, AA values, tokens or receipts in logs. New search payloads use POST bodies so AA is absent from URLs. Outcome-code logging only; no per-search business audit rows. Store acknowledgment version in minimal security state. Update capacity SSOT to justify new writes/retention.
- Shared networks/VPNs share allowance; changing IPv6 addresses and proxies can evade IP-only limits. CAPTCHA/IP limits do not establish identity or guarantee prevention of scraping/DDoS.

## R7. Implementation boundaries and acceptance

Use separate v2 public schemas in `packages/contracts/src/schemas/sale-team.ts`; retain staff `fullName` schemas. Public result structurally excludes fullName and uses maskedName. Follow current package export patterns and existing web API client.

Keep dispatch in `api/_handlers/sale-team.ts`; focused search/token/config helpers belong in `api/_lib/`. Reuse existing Dialog/TextField/Button/Alert/TurnstileChallenge and preserve current layout. Server serves a finalized versioned notice and public phone through config. Server-only configuration includes a feature switch, stable search secret, Siteverify secret and permitted hostnames. Fix exact new env names in the implementation plan; extend env-isolation checks. No secrets in browser env or Markdown.

Implementation order and acceptance outcomes:

1. Repair stale DB proof; add forward correction for photo-era IST eligibility regression without rewriting numbers/dates. Cover legacy dated IST, date-free IST, OST expiry/renewal, issuance/collision/denial/ACL/rollback and current photo fields.
2. Add strict contracts and staged handlers. Tests: missing/forged/expired token, acknowledgment/version mismatch, invalid contact, receipt replay across session/IP, deleted contact receipt, no contact-existence disclosure, no raw-name response, no photo before authorization, legacy GET bypass closed, authorized staff history retained, config fail-closed.
3. Add private contact/security-state migration and RPCs with real PostgreSQL tests. Cover identical normalized contact across IST/OST and later sessions; name casing, email casing and phone-format normalization; distinct combinations not merged; concurrent first submissions creating one row; cached receipt causing no repeated contact write; dedup-key rotation/deletion behavior. Also cover first/second/third/fourth success, invalid outcomes, exact 24-hour boundary, simultaneous independent connections on unseen IP, lost-response retry, revoked retry, cleanup, denied browser RPCs/tables, outage and migration replay. Regenerate `CURRENT-SCHEMA.sql` using `node scripts/update-schema-index.mjs` when migrations change.
4. Implement UI state machine. Test dialog every valid attempt, session contact once/expiry, re-entered same contact reusing one saved row across IST/OST, canceled and reordered responses, blocked storage, empty/error/429/503, correct IST/OST labels, photo fallback, masked alt text and network response, keyboard focus and mobile behavior.
5. Run focused suites, typecheck/lint/build/check:env, disposable SQL/RLS/harness failure-cleanup checks. Browser workflow proof must use disposable fixtures; current localhost points at hosted Supabase and must not receive synthetic writes.
6. Separately inspect live history, exact allowlisted migrations, Storage/RPC availability, ingress, challenge keys/hostnames, finalized privacy notice, edge configuration and working cleanup. Activation/deployment require explicit scope. Rollback disables public search and retains identifiers/history.

## R8. Remaining owner review and publication prerequisites

Owner review: IST-label exception, surname heuristic, 24-hour maximum contact receipt lifetime, concrete abuse thresholds, and the server-authorized-release interpretation of success.

Before publication, supply verified legal entity, DPO designation/name, privacy email/address/phone, effective/update dates, lawful-basis review, approved saved-contact retention/deletion periods and authorized internal access, and a finalized notice version. The notice must explain one-time server storage, deduplicated reuse across IST/OST searches, separate session caching, and no unrelated secondary use. Do not publish Appendix A's placeholders or unverified collection/retention claims unchanged.

Before activation: actual Turnstile configuration, stable secret, company-phone configuration, approved available cleanup scheduler, verified live prerequisites and explicit migration/deployment authorization. Connected read-only database inspection was denied; live metadata remains NOT VERIFIED.

See [readiness evidence](ist-ost-search-query-readiness.md) for baseline results. This revision is a reviewable technical design, not a claim that the feature is implemented or production-ready.

Official technical sources checked:

- [Cloudflare Siteverify](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/): mandatory server validation, 300-second expiry and single use.
- [Vercel request headers](https://vercel.com/docs/headers/request-headers): overwrite behavior and extra-proxy caveats.
- [PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html): transaction-scoped shared decisions.
- [Supabase function execution](https://supabase.com/docs/guides/troubleshooting/how-can-i-revoke-execution-of-a-postgresql-function-2GYb0A): PUBLIC and browser-role revokes.
- [Supabase Cron](https://supabase.com/docs/guides/cron): pg_cron prerequisites; live availability not verified.


---

## Appendix A — Draft privacy notice (provided 2026-10-21; pending DPO/legal finalization)

The following notice text was provided as the intended Data Privacy Act notice for the IST/OST verification service. It is included verbatim as a draft; placeholders must be completed and the notice must be approved by the DPO/legal representative before publication.

Key items still unresolved within it: Effective Date, DPO name, legal entity name, privacy email, business address, privacy phone, approved retention periods, lawful basis determination.

The full notice text supplied on 2026-10-21 is the source of truth for the modal copy and must be stored as a versioned document once finalized. It is reproduced below for self-containment.

```text
AFHOMES
IST/OST Accreditation Verification Privacy Notice

Effective Date: [Insert Effective Date]
Last Updated: [Insert Date]

1. Purpose of the Verification Service

AFHomes provides the IST/OST Accreditation Verification Service to help customers verify whether an individual presenting an Accreditation/AA Number is currently accredited and authorized to represent themselves as an accredited IST/OST within the AFHomes system.

This service is intended to support customer protection, accreditation verification, fraud prevention, and the prevention of unauthorized representations or transactions.

Users should independently verify an individual's legitimacy through the official AFHomes company verification telephone number displayed on the verification result page.

2. Personal Information We May Collect

When you use this service, AFHomes may collect and process the following information, subject to necessity, proportionality, and the applicable lawful basis:

A. Information submitted by the person conducting the search
- Full name
- Email address
- Mobile telephone number
- Accreditation/AA Number entered for verification

B. Technical and security information
- IP address
- Date and time of search requests
- Search outcomes and relevant security events
- Technical information reasonably necessary to detect automated activity, prevent abuse, enforce search limits, and investigate potential misuse of the service

C. Accreditation information displayed in verification results
- Profile image, where appropriate
- Partially masked name of the accredited IST/OST
- Accreditation/AA Number
- Current accreditation status
- Accreditation expiration date
- Official AFHomes company verification telephone number

AFHomes will not display an accredited IST/OST's personal telephone number as the company's official verification contact.

The collection and disclosure of each category of information must be limited to what is necessary for the declared purposes and permitted by the applicable lawful basis.

3. Purposes of Processing

AFHomes may process the information described above for the following purposes, where applicable and lawfully justified:

1. To verify the current accreditation status of an IST/OST.
2. To provide customers with the minimum information necessary to confirm an accredited individual's legitimacy.
3. To protect customers against impersonation, fraudulent representations, and unauthorized transactions.
4. To detect and prevent automated searches, sequential Accreditation/AA Number enumeration, excessive requests, spam, and other misuse of the verification service.
5. To enforce search limits and appropriate security controls.
6. To investigate suspected abuse, maintain service security, and address legitimate verification-related inquiries.
7. To comply with applicable legal obligations and respond to lawful requests from competent authorities.

AFHomes will not use the collected information for unrelated purposes, including direct marketing or unrelated profiling, unless an appropriate lawful basis and any additional required notice or consent have been established.

4. Lawful Basis for Processing

AFHomes will identify and document the applicable lawful basis for each processing activity in accordance with Section 12 of Republic Act No. 10173, the Data Privacy Act of 2012, and its Implementing Rules and Regulations.

Depending on the specific processing activity and circumstances, the applicable lawful basis may include consent, contractual necessity, compliance with a legal obligation, or legitimate interests, where the relevant legal requirements are satisfied.

The appropriate lawful basis must be determined by AFHomes following review by its Data Protection Officer and, where necessary, legal counsel.

Use of this service does not, by itself, establish that consent is the appropriate lawful basis for every processing activity. Where consent is relied upon, it must satisfy the applicable legal requirements. Where another lawful basis applies, AFHomes will provide the required transparency information.

5. Search Limits and Abuse Prevention

To protect the accreditation database and the personal information of accredited IST/OST personnel, AFHomes may implement server-side search limits, request throttling, automated-abuse detection, and other proportionate security measures.

The verification service may restrict repeated or suspicious requests, including attempts to systematically guess Accreditation/AA Numbers or retrieve information about individuals without a legitimate verification purpose.

Security monitoring may use IP addresses, request timestamps, search outcomes, and other proportionate technical indicators.

These measures are intended to protect the confidentiality, integrity, and appropriate use of the verification service. They do not authorize unrestricted collection, use, or disclosure of personal information.

6. Disclosure and Access to Information

Access to personal information will be limited to authorized personnel and service providers who require access for legitimate operational, security, or compliance purposes, subject to appropriate safeguards.

Information may also be disclosed when required or authorized by applicable law.

AFHomes will not disclose unnecessary personal information about an accredited IST/OST merely because a person submits an Accreditation/AA Number.

Verification results will be limited to information approved for the service's legitimate purpose, subject to applicable legal requirements and safeguards.

7. Data Retention

AFHomes will retain personal information only for as long as necessary to fulfill the declared purposes, comply with applicable legal obligations, resolve legitimate disputes, or establish, exercise, or defend legal claims, as applicable.

Search records, technical security logs, and customer contact information may have different retention periods based on their respective purposes.

Approved retention periods:
- Customer contact information: [Insert approved retention period and deletion criteria]
- Search and verification records: [Insert approved retention period]
- Security and abuse-prevention logs: [Insert approved retention period]

When information is no longer necessary and no lawful retention ground remains, AFHomes will securely delete, destroy, or irreversibly anonymize it, as appropriate.

8. Security Measures

AFHomes will implement reasonable and appropriate organizational, physical, and technical safeguards to protect personal information against accidental or unlawful destruction, alteration, disclosure, unauthorized access, and other unlawful processing.

Depending on the assessed risks and the capabilities of the system, safeguards may include:

- Server-side access controls and input validation
- Rate limiting and automated-abuse detection
- Protection against unauthorized enumeration of accreditation records
- Secure handling of customer sessions and submitted information
- Restricted access to personal information
- Security monitoring and incident-response procedures
- Appropriate retention and secure disposal controls

Security controls will be reviewed and improved as appropriate to the risks associated with the service.

9. Rights of Data Subjects

Subject to applicable law, individuals may exercise their rights under the Data Privacy Act of 2012, including the right to be informed, reasonable access, correction of inaccurate information, objection where applicable, and other rights recognized by law.

Requests relating to personal information processed by AFHomes may be submitted through the verified privacy contact details provided below.

AFHomes will assess and respond to requests in accordance with applicable legal requirements. The exercise of a particular right may be subject to lawful exceptions and limitations.

Individuals may also lodge a complaint with the National Privacy Commission of the Philippines, subject to its applicable procedures.

10. Data Protection Officer and Privacy Inquiries

For questions, requests, or concerns regarding the processing of personal information through the IST/OST Accreditation Verification Service, please contact:

Personal Information Controller:
[Insert Complete Legal Name of the AFHomes Operating Entity]

Data Protection Officer (DPO):
[Insert Full Name or Approved DPO Designation]

Official Privacy Email Address:
[Insert Verified Privacy Contact Email]

Official Business Address:
[Insert Verified Business Address]

Telephone Number:
[Insert Verified Privacy Contact Number, if applicable]

National Privacy Commission:
Website: https://privacy.gov.ph/

Please do not send passwords, authentication credentials, or unnecessary sensitive personal information when submitting a privacy inquiry.

11. Updates to This Notice

AFHomes may update this Privacy Notice when necessary to reflect changes in the service, its data-processing activities, applicable legal requirements, or security measures.

Material changes affecting the purposes, scope, or manner of processing will be communicated as required by applicable law.

The latest approved version of this notice will be made available through the verification service.

12. Legal References

This Privacy Notice is prepared for review with reference to:

1. Republic Act No. 10173 — Data Privacy Act of 2012, particularly:
   - Section 11 — General Data Privacy Principles
   - Section 12 — Criteria for Lawful Processing of Personal Information
   - Section 16 — Rights of the Data Subject
   - Section 20 — Security of Personal Information

2. Implementing Rules and Regulations of Republic Act No. 10173, particularly the provisions concerning transparency, legitimate purpose, proportionality, lawful processing, data-subject rights, and security.

3. National Privacy Commission Circular No. 2023-04 — Guidelines on Consent, where consent is relied upon as the lawful basis for processing.

4. National Privacy Commission Circular No. 2023-07 — Guidelines on Legitimate Interest, where legitimate interest is considered as the lawful basis for processing.

Official references:
- Data Privacy Act of 2012: https://privacy.gov.ph/data-privacy-act-/
- Implementing Rules and Regulations: https://privacy.gov.ph/implementing-rules-regulations-data-privacy-act-2012/
- NPC Advisories and Circulars: https://privacy.gov.ph/pips-and-pics/advisories-circulars/

Approval Status: Approved 2026-10-21 for implementation; placeholders to be completed by the owner before publication.

This notice must not be published as the final approved notice until the company's legal identity, actual processing activities, lawful bases, retention periods, recipients, and privacy contact details have been verified.

Acknowledgment text (to be shown as the required acknowledgment checkbox/confirmation):
"I acknowledge that I have read the AFHomes IST/OST Accreditation Verification Privacy Notice and understand how my personal information may be processed for the purposes described in the notice. I understand that the verification service is intended to help confirm an individual's current accreditation status and that AFHomes may apply security measures to prevent misuse of the service."
```

---

**End of specification. Feature implementation has not started.**
