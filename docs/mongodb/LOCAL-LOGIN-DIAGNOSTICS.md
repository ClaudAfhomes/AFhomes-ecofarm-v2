# Local sign-in diagnostics

28 October 2026. `AFhomes-ecofarm-v2`, `claud/mongodb-conversion`.

The Admin Login catch block previously labelled connection errors, non-JSON API
failures and throttling as an incorrect email/password. The native cookie gateway
now provides fixed, private-safe error categories. The admin login distinguishes
service unavailability and rate limiting; unknown accounts and incorrect passwords
still receive the same generic rejection. Upstream bodies, passwords and tokens
are never copied into displayed messages.

Before this change, four of five new gateway checks failed. Afterward all 56 shared
tests and 16 login-screen regression tests passed. Shared/admin TypeScript,
targeted admin lint and environment isolation also passed. These tests do not
authenticate the real owner.

Read-only inspection during the preceding investigation confirmed the existing
`af@admin.com` bootstrap identity, active Super Admin assignment, verified email,
one credential account and completed first-login password change in `afhomes_dev`.
No existing credentials or account assignments were changed. A server launched
during investigation was stopped, releasing 3084/5183/5184 so the operator could
own `pnpm dev`. API3084 and admin5184 were initially unreachable. At the final
probe, both returned HTTP 200 from the unauthenticated session endpoint. Owner
login is still pending. A cached login page and generic failure cannot prove a
bad password.

Next: keep `pnpm dev` running, reload `http://localhost:5184/admin/login`, and
observe the actual failure category. Real owner login and the reported IST
creation failure remain unverified. Do not reset/rebootstrap the owner, bypass
authorization or create a real QA member to obtain a passing result.
