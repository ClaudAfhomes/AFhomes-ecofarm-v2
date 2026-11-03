# Native hosted runtime verification — 29 October 2026

User selected DigitalOcean without Docker and retained MongoDB Atlas. Hosting is
prepared as a staging-first path; nothing was provisioned, deployed or pushed.

## Implemented

- Dedicated opt-in Node entry point, loopback listener, existing core-readiness
  preflight, graceful stop and sanitized startup errors. No Vite server, DDL,
  seed, identity bootstrap or default search-maintenance startup.
- Existing native handlers, RBAC and conversion-write allowlist are reused.
  Canonical HTTPS host/proxy headers and origin-form request paths are required.
  Existing `afhomes_dev` database and authentication scope remain enforced.
- Hosted filesystem private storage is explicit, persistent and outside static
  directories. Existing localhost-only construction remains restricted. The
  existing S3 option remains available; no bucket is created automatically.
- Public build subprocesses receive an OS/tool allowlist and fresh public VITE
  configuration with an empty env directory. Runtime credentials, old VITE values
  and Node injection flags are excluded. API/apps typecheck before Vite builds,
  followed by prerender, merged static output and the built environment guard.
- systemd and Nginx staging templates plus a reviewed installation/runbook path.
  Templates require the real staging domain/certificate/tester IPs and Linux
  validation; they are not installed or claimed production-ready.

## Fresh results

`pnpm --filter api exec vitest run _lib/hosted-runtime.spec.ts
_lib/private-object-store.spec.ts _lib/mongo-development-access.spec.ts
_lib/profile-photo.mongo.spec.ts _lib/documents.mongo.spec.ts --maxWorkers=1`

**92 tests / 5 files passed.** The final hosted/storage guard changes were also
rerun separately: **9 tests / 2 files passed**. These include native disposable
MongoDB/HTTP checks and existing storage/protocol/gate checks; they are not all
live-provider or browser tests.

- Hosted health with canonical proxy headers creates no schema/collections.
  Incorrect host/protocol, protocol-relative paths and disabled writes fail.
- Invalid production opt-in/URL/database/port/storage/trusted-origin/maintenance
  combinations are rejected. Public build configuration excludes server secrets.
- Hosted files survive store reconstruction; HTTPS download grants are bounded;
  valid signed delivery succeeds and missing/tampered grants fail.
- Staff sign-in issues secure HttpOnly cookies. Untrusted origins fail. The
  existing password-change -> client sign-out -> old-cookie rejection -> new
  sign-in sequence works through the proxy protocol fixture. The existing
  password endpoint deliberately retains the current session until that client
  sign-out; no unrelated auth/business behavior was changed for hosting.

`AFHOMES_PUBLIC_ORIGIN=https://staging.example.invalid pnpm build:hosted` passed,
including API/app typechecks, both actual Vite builds, 12 prerendered public
routes, static assembly and built environment isolation. This was not a cached
Turbo build or a cloud deployment. Existing bundle-size warnings remain.

Targeted ESLint, API typecheck and `pnpm check:env -- --built` passed. The actual
`node --import tsx api/server.ts` entry point was also executed in a sanitized
environment without hosted opt-in/configuration and exited at configuration
preflight, before any database connection. No real MongoDB URI was passed.

## Not verified / not performed

Linux systemd/Nginx syntax/service execution, certificates, DNS, firewall and
Atlas network access, a live Droplet connection, private file transfer, durable
real-data backups, production DB scope/cutover and browser acceptance remain
pending. SMTP/Turnstile deployment configuration still needs review. Disabled
modules remain disabled; CMS stays last. Existing local env files, local scripts,
account credentials, Atlas data and the user's running localhost are unchanged.

See `DIGITALOCEAN-NATIVE-HOSTING.md` for the exact architecture and review gates.
