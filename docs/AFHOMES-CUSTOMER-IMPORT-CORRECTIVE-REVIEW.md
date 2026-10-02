# Customer import release blocker corrective review

Classification: **PASS — READY FOR CORRECTIVE MIGRATION REVIEW**.

These fixes are local and uncommitted. The deployed Preview still runs `075bfa9e5961afed83e2bb5298615c7eb4d43d47`; this task neither applies SQL remotely nor deploys code. No QA accounts were enabled and no live QA data was created.

| # | Requested result | Evidence/result |
|---|---|---|
| 1 | Directory exact failure | Disposable pre-fix baseline, caller service_role: SQLSTATE 42501, permission denied for schema private, SQL function customer_directory statement 1; search_customer_ids fails identically |
| 2 | Private dependencies | customer_directory(jsonb) calls private.money(numeric) and private.hash_token(text); search_customer_ids(text) calls private.hash_token(text). No private relations/views or further private helper calls |
| 3 | Missing privileges | private schema USAGE and EXECUTE on the two helpers. With schema USAGE and platform SELECT modeled temporarily, directory fails 42501 permission denied for function money; related search fails 42501 permission denied for function hash_token |
| 4 | Least privilege | Three idempotent GRANTs: private schema USAGE and EXECUTE on exactly money(numeric)/hash_token(text), to service_role only. RPCs retain SECURITY INVOKER, owner, bodies, ACL and search_path; no owner elevation, CREATE privilege or browser grants |
| 5 | New migration | 20261020000001_afhomes_customer_directory_private_privileges.sql. Version unused in active migration inventory and reviewed live-applied baseline before creation; archived JAD files are outside the active inventory |
| 6 | Browser/private before/after | service private USAGE/money EXECUTE/hash EXECUTE: false/false/false → true/true/true. anon and authenticated helper EXECUTE: false → false; both public directory RPCs remain denied to browsers. Existing authenticated private schema USAGE is unchanged |
| 7 | Real PostgreSQL directory | PASS: actual service-role RPC, full/partial name, customer/member numbers, membership-code/fallback, Active VIP/Suspended/Expired/Cancelled, tier, real non-null seller, dates, seven sorts, imported and manually created customers |
| 8 | Employee lookup | PASS locally: real PostgreSQL normal imported row projects safe member fields. Real handler/resolver tests allow permissioned Employee/Admin and deny Employee without permission, deny-only restricted Employee, and non-staff customer/OST principals before directory access |
| 9 | Export | PASS: service-role filtered directory queries used by CSV/XLSX exports. Existing export rendering/security tests remain green. Hosted export/UI not retested because no corrective deployment is authorized |
| 10 | RLS | PASS: all invariant audit result sets empty; actual anon/authenticated SQL calls to directory and private helpers rejected. No RLS policy or table grants changed by migration |
| 11 | Actual redirect chain | docs.google.com export → 307 → doc-0c-34-sheets.googleusercontent.com/export/[opaque segments], query present → 200 text/csv; charset=utf-8, 727 bytes. Location query values and opaque download tokens were not logged |
| 12 | Allowed hosts | Constructed docs.google.com export path; download host regex ^doc-[a-z0-9]{2}-[a-z0-9]{2}-sheets\.googleusercontent\.com$ with /export/ path. No general Google suffix allowlist |
| 13 | Redirect validation | Every fetch manual; every Location parsed and checked before follow-up. HTTPS, no userinfo, no non-default port, exact reviewed hostname/path patterns (therefore no IP literals), visited-URL loop rejection, at most three redirects. Same AbortController across hops |
| 14 | Size/deadline | One 20-second deadline for all hops/body; Content-Length early rejection; streamed byte counter stops beyond 5,000,000 bytes; controller abort plus reader cancellation. Failure paths abort unread responses |
| 15 | Private sheet | Controlled project-convention OAuth/configuration error for 401/403, HTML/permission pages or unsupported content. Google HTML never returned to client. No OAuth/private-sheet access added |
| 16 | Public Viewer Sheet | PASS with actual fixed local fetcher and parser/validator: existing synthetic Sheet returns four rows, three valid and one intentionally invalid; no unknown headers. No live import confirmation performed |
| 17 | Malicious redirect tests | PASS: external host, IPv4/IPv6, HTTP, userinfo, non-default port, suffix spoof, arbitrary Google hosts, wrong path, loops, too many redirects, oversized Content-Length/chunk stream, private/HTML/binary content, bad initial URL/gid and crafted docs hostname. Normal CSV and three allowed redirects work; shared deadline tested |
| 18 | Unit tests | Fresh serial full suite: 2211/2211 tests across 134 files; 36 added tests. Final affected-file rerun after cancellation cleanup: 56/56 |
| 19 | Database tests | Final disposable real PostgreSQL: 1137/1137, up from 1087. Applied exactly 28 reviewed live migrations plus new migration, excluding #19. No managed database targeted |
| 20 | Harness | 13/13: normal run 1137/1137; injected run intentionally non-zero, reports fault, still restores every table. Expected injected failure is not a product failure |
| 21 | Other checks | typecheck:deploy, full typecheck including Supabase scripts, lint, build, check:env, no-network db:migrate -- --check and git diff --check PASS. Existing 17 lint warnings and chunk-size warning retained |
| 22 | Migration #19 | Untouched; remains unapplied in the approved baseline. Explicitly excluded from disposable migration execution. No remote apply/history change |
| 23 | Applied SQL integrity | All six protected applied migrations untouched in git diff. A/B/C SHA-256 values match prior applied-file evidence |
| 24 | Changed files | Six files listed below; ignored scratch scripts/logs are evidence only |
| 25 | Commit status | No commit or push. HEAD remains 075bfa9e5961afed83e2bb5298615c7eb4d43d47 on preview/afhomes-rebuild |
| 26 | Live mutation | NO. Only remote reads of public synthetic Sheet and documentation; all SQL execution/data fixtures were disposable loopback only |

Pre-fix catalog details, captured from disposable PostgreSQL:

| Object | Type | Owner | SECURITY DEFINER | search_path | ACL / need |
|---|---|---|---|---|---|
| public.customer_directory(jsonb) | SQL stable function | afhomes | no | public, pg_temp | {afhomes=X/afhomes,service_role=X/afhomes}; authorized server RPC |
| public.search_customer_ids(text) | SQL stable function | afhomes | no | public, pg_temp | same ACL; shared fallback/name search |
| private.money(numeric) | SQL immutable strict function | afhomes | no | pg_catalog, extensions, private, public, pg_temp | {afhomes=X/afhomes}; EXECUTE needed for verified_paid exact-decimal output |
| private.hash_token(text) | SQL immutable strict function | afhomes | no | pg_catalog, extensions, private, public, pg_temp | {afhomes=X/afhomes}; EXECUTE needed for hashed fallback/QR equality |
| private | schema | afhomes | n/a | n/a | {afhomes=UC/afhomes,authenticated=U/afhomes}; service USAGE missing |

Helper call graph: money uses PostgreSQL numeric/text built-ins only; hash_token uses pgcrypto digest plus PostgreSQL encode. pgcrypto lives in public in the local shim and is included through the existing helper search_path; no further private object appears. Both public RPCs and both helpers have the same owner; no owner mismatch occurred.

Directory underlying SELECT relations: public.customers, memberships, points_accounts, card_sales, card_plans, staff_users and payments, all owned by afhomes in this disposable instance. The intentionally minimal local shim does not supply managed Supabase service table grants, so the new service-role regression models SELECT on exactly these seven relations inside a rolled-back test transaction. These fixture grants are not in the corrective migration. The helper privilege failure was reproduced after modeling these grants, so a shim table-grant failure could not hide it.

Keeping SECURITY INVOKER preserves the existing caller authorization model. PostgreSQL documents schema and function privileges separately and specifies that invoker functions run as the caller: [GRANT](https://www.postgresql.org/docs/current/sql-grant.html), [CREATE FUNCTION](https://www.postgresql.org/docs/current/sql-createfunction.html).

Changed files:

- api/_lib/customer-import.ts
- api/_lib/customer-import-google.spec.ts
- api/_handlers/member-lookup-authorization.spec.ts
- supabase/db-integration.ts
- supabase/migrations/20261020000001_afhomes_customer_directory_private_privileges.sql
- docs/AFHOMES-CUSTOMER-IMPORT-CORRECTIVE-REVIEW.md

Evidence under ignored .tmp-bin/: blocker-directory-before.json, blocker-google-chain.json, blocker-google-public.json, blocker-reproduce.log, blocker-unit.log, blocker-db-local.log, blocker-db-harness.log, blocker-typecheck.log, blocker-typecheck-deploy.log, blocker-lint.log, blocker-build.log, blocker-env.log, blocker-migrate-check.log.

The no-network migration configuration command lists the full repository inventory, including unapplied #19; it does not apply SQL. Disposable runners use the explicit reviewed baseline plus this corrective version and omit #19. Existing installed DB helper scripts were invoked directly to avoid a redundant workspace install, matching the authorized local/harness behavior. Windows startup initially stalled on orphaned embedded PostgreSQL I/O workers; only verified orphaned workspace test processes were stopped before successful reruns.

Import business rules, approved financial history behavior, legacy provenance, commission behavior, allocator, conflict handling, lifecycle precedence and opening-ledger semantics remain unchanged. No deployed acceptance claim is made. STOP: corrective review only; no apply, deployment, commit, push or live QA mutation.
