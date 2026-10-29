# Application approval transaction deadline

28 October 2026. `AFhomes-ecofarm-v2`, `claud/mongodb-conversion`.

The user reported a 503 while approving a submitted customer application. A
separate document lookup returned a subject-validation 400; that message is not
emitted by the approval handler. Read-only inspection before and after this fix
found the real application still submitted, with no reservation or approval audit.
No real approval, payment or customer write was executed during investigation.

Approval is one transaction covering the decision, frozen-term reservation,
reservation submit/execute, recorded reservation-fee deposit, immutable evidence,
audits and idempotency receipt. It inherited the client's 15-second transaction
budget. It now uses an explicit bounded 45-second session budget for this path;
ordinary client timeout, authentication, permissions, terms and payment rules are
unchanged. This remains below the frontend request deadline.

A new disposable regression accelerates the inherited-deadline case with a 200 ms
client and 350 ms fresh-authorization delay. It reproduced the same generic 503
before the change and passes afterward. The exact approval request can be retried
without creating duplicate reservations or deposits. The deposit is recorded,
not verified, and does not establish membership activation eligibility.

PASS: 35 API tests across native official forms, import-to-purchase continuation
and private documents. They include approval audit-failure rollback, frozen terms,
Finance denials, replay, full verified payment and activation. One document-suite
expectation was stale: the converted continuation reader is now available to an
authorized user. It now checks an empty result and anonymous 401, without changing
the production gate. API TypeScript and environment isolation passed.

All mutation tests used fresh disposable replicas and synthetic identities. No
existing administrator, source records, real financial data, environment files,
indexes, remote branches or deployments changed. Actual browser retry is pending;
the reproduced timeout fix is not proof that every possible 503 has this cause.
If document subject-validation persists, inspect the actual query URL and retain
the required subject-type/UUID validation rather than weakening it.
