# DigitalOcean Droplet without Docker

Decision confirmed 29 October 2026: **MongoDB stays on the existing Atlas cluster;
the Droplet runs the application directly.** No mongod, Docker, Compose or
container deployment is required on the Droplet.

## Architecture and current gate

Nginx terminates HTTPS, serves the built public/admin React applications, and
proxies `/api/` to a Node API bound only to `127.0.0.1:3084`. systemd supervises
Node. Private files use `/var/lib/afhomes/private-files`, outside the release and
static directory, through the existing signed-download API. S3 is optional and
requires explicit configuration; no paid bucket is needed for filesystem mode.

The default MongoDB/authentication scope remains **afhomes_dev**. The reviewed
runtime selector also permits **afhomes_prod** only when all four server settings
agree: `AFHOMES_MONGODB_SCOPE=production`, `MONGODB_DB=afhomes_prod`,
`NODE_ENV=production` and `AFHOMES_HOSTED_RUNTIME_ENABLED=true`. Missing or
contradictory production settings fail before connecting. See
`PRODUCTION-DATABASE-SCOPE.md` for proof and remaining gates.

This remains **staging-first hosting preparation**, not production cutover
approval. No environment was switched and no production schema was initialized.
Do not bootstrap/reset the owner, migrate data, repoint the existing live domain,
or enable disabled modules as part of installation.

No Droplet, domain, certificate, firewall rule, Atlas allowlist or cloud service
has been created or changed by this preparation. Cost, region, size, SSH access,
domain and network changes need a concrete operator review before deployment.

## Artifacts

- `api/server.ts`: explicit hosted entry point, no Vite/watch mode, no startup DDL,
  seed or bootstrap. It reads an explicitly supplied private env file, validates
  existing core readiness, and handles shutdown.
- `pnpm start:mongodb`: `node --import tsx api/server.ts`. The existing tsx loader
  resolves this monorepo's TypeScript workspace exports. Retain the frozen full
  dependency install; `pnpm install --prod` is not a supported release layout yet.
- `pnpm build:hosted`: builds both SPAs with an isolated empty env directory and
  allowlisted public environment, typechecks API/apps, runs prerender/static assembly and the built
  environment guard. It reads no server env file and strips inherited server
  credentials, old VITE values and `NODE_OPTIONS` from subprocesses.
- `deploy/digitalocean/afhomes.service`: non-root systemd service, root-managed
  credential file supplied through `LoadCredential`, persistent StateDirectory,
  read-only system files and private temporary storage.
- `deploy/digitalocean/nginx-bootstrap.conf`: ACME-only HTTP template; other
  requests fail closed before TLS is installed.
- `deploy/digitalocean/nginx-afhomes.conf`: HTTPS staging template, built SPA
  routing, canonical proxy headers and IP-restricted staging access. Private
  API query tokens/cookies/bodies are not included in the access-log format.
  Nginx error logs can contain request URIs; restrict their access and redact
  them before sharing diagnostic output.

## Reviewed installation sequence — not executed here

Use a dedicated Ubuntu 24.04 LTS Droplet with an SSH-key administrator and a
separate `afhomes` service account. Select capacity after measuring the workload;
build memory requirements differ from steady-state API usage. Install Node 24.x
(local verification uses 24.19.0), this repository's pinned pnpm 11.22.0, Nginx
and Certbot through reviewed official installation instructions.
Verify that the unit's `/usr/bin/node` points to the reviewed Node 24 binary.

1. Approve the Droplet's region/size/cost and SSH key. Configure a cloud firewall:
   restrict SSH to approved administrator networks, allow HTTPS/HTTP as needed,
   and expose neither 3084 nor 27017. Atlas network access should allow the
   Droplet's actual egress IP, never a blanket `0.0.0.0/0` rule.
2. Approve a **separate staging hostname**, DNS change and tester IPs. Replace
   every `staging.example.invalid` occurrence in the templates. Keep staging
   restricted and `noindex`; the existing production domain stays in place.
3. Put reviewed releases under `/srv/afhomes/releases/<commit>` and make
   `/srv/afhomes/current` point to the selected release. Keep source/dependencies
   readable but not writable by the service account. Keep pnpm's store outside
   protected home directories, for example `/srv/afhomes/.pnpm-store`.
4. Install the lockfile with `pnpm install --frozen-lockfile`, then run root
   typecheck/lint and appropriate tests. Build with public settings only:

   ```sh
   AFHOMES_PUBLIC_ORIGIN=https://staging.example.invalid pnpm build:hosted
   ```

   This creates `vercel-static/` using the existing static assembler; despite its
   inherited name, it is an ordinary directory served directly by Nginx. It is
   not a Vercel deployment. Do not copy `.env.local`, `.git`, diagnostics, outputs
   or browser artifacts into the static directory.
5. Create `/etc/afhomes/server.env` privately with an editor, root-owned mode
   `0600`, never in Git or a shell history command containing secrets. The unit
   uses systemd credentials to expose it only to the service. Configure at least:

   ```text
   AFHOMES_HOSTED_RUNTIME_ENABLED=true
   AFHOMES_PUBLIC_ORIGIN=https://staging.example.invalid
   BETTER_AUTH_URL=https://staging.example.invalid
   AFHOMES_WEB_URL=https://staging.example.invalid
   AFHOMES_ADMIN_URL=https://staging.example.invalid/admin
   MONGODB_URI=<existing Atlas URI; enter privately>
   MONGODB_DB=afhomes_dev
   BETTER_AUTH_SECRET=<approved stable signing secret; enter privately>
   PORT=3084
   AFHOMES_PRIVATE_STORAGE_PROVIDER=filesystem
   AFHOMES_PRIVATE_STORAGE_ROOT=/var/lib/afhomes/private-files
   AFHOMES_MONGODB_ENABLE_CORE_WRITES=false
   AFHOMES_HOSTED_SEARCH_MAINTENANCE=false
   ```

   The stable secret and private file contents must survive releases. Hostname,
   storage and secret changes are separate reviewed operations. Existing local
   uploads do not move through Git: approve a checksum-verified private transfer
   and reconcile referenced objects before enabling those hosted workflows.
   Staff still use temporary passwords/forced changes; VIPs use activation links
   or codes. No invitations or MFA re-enablement is introduced.
6. Obtain the staging certificate with the ACME-only bootstrap site, replace that
   virtual host with the reviewed HTTPS template, then install
   the reviewed HTTPS template and service. Check on Linux before starting:

   ```sh
   sudo nginx -t
   sudo systemd-analyze verify /etc/systemd/system/afhomes.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now afhomes
   ```

   The template requires replacement domain, issued certificate paths and
   specifically approved tester IP entries before it is usable. Do not replace
   unrelated virtual hosts on an existing server. Review Certbot renewal and
   Nginx reload behavior as part of the actual installation.
7. Verify the internal health route using the same canonical headers Nginx sends:

   ```sh
   curl --fail -H 'Host: staging.example.invalid' -H 'X-Forwarded-Proto: https' \
     http://127.0.0.1:3084/api/v1/health
   ```

   Then verify HTTPS/browser behavior through Nginx: public/admin asset/deep-link
   routes, secure cookies, origin rejection, first-login password change/sign-out,
   IST/direct OST creation, public eligibility, private uploads/downloads,
   applications -> Finance -> activation -> lookup and points. Review SMTP and
   Turnstile hostname/keys separately; they are not automatically configured.
8. Enable commercial writes and the retention worker only after reviewed schema,
   permissions, file readiness and specific write/cleanup authorization. The
   existing conversion gates and disabled modules remain in effect. Authentication
   requests can write session/rate-limit records even with commercial writes off;
   this setting must not be presented as a read-only database mode.

## Release, rollback and backup gates

Keep releases separate from `/var/lib/afhomes`; stop/drain the service before an
approved release switch and restart it against the selected revision. Code
rollback must not roll back financial data, administrator credentials or private
files. Do not run migrations/bootstrap/seeds during service startup or rollback.

Durable Atlas/private-file backup, off-host encrypted storage/key recovery and an
independent restore remain required. The synthetic recovery rehearsal is not a
real backup. Droplet image snapshots alone do not prove a consistent Atlas/file
backup. Review the backup capabilities of the actual Atlas tier and approve any
paid backup/storage feature separately.

## Verification limits

Fresh local results and exact limits are in `HOSTED-RUNTIME-VERIFICATION.md`:
92 relevant tests passed, hosted builds/typechecks/static assembly passed, and the
unconfigured hosted CLI fails before connecting to any database.

Native loopback protocol tests exercise canonical proxy headers, health without
startup schema creation, hosted private-file persistence/signatures and secure
staff cookie/password-change/sign-out behavior. Localhost storage behavior is
retained. Browser builds are verified separately with the isolated public build.
No Linux service, real Nginx/TLS installation, live Atlas connection from a
Droplet, domain or browser deployment acceptance has run on this machine.

Primary references: [DigitalOcean recommended Droplet setup](https://docs.digitalocean.com/products/droplets/getting-started/recommended-droplet-setup/),
[Nginx proxy headers](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header),
[systemd execution/credentials](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html),
[Node.js TypeScript execution](https://nodejs.org/api/typescript.html).
