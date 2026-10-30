# Standalone Production API (MongoDB)

Production runtime for the approved MongoDB database `afhomes_dev`. This service
replaces the Vercel function for the droplet deployment. It does **not** use
Supabase, Vite, Docker, PM2, seeds, or automatic migrations.

## Architecture

```
Nginx (TLS, portal.afhomes.com.ph)
  ├── /            → /srv/afhomes/current (existing web build)
  ├── /admin/      → /srv/afhomes/current/admin (existing admin build)
  └── /api/        → 127.0.0.1:3084  (this service)
                        └── api/_server.ts → createMongoPhase5Runtime
                              ├── Better Auth (Mongo adapter, secure cookies)
                              ├── existing business handlers (unchanged)
                              ├── private object store (S3 when configured)
                              └── optional search-retention worker
```

The server binds loopback only. Nginx terminates TLS and forwards requests over
HTTP on localhost; the public port 3084 is never opened.

### Entrypoint

- Source: `api/_server.ts`
- Built artifact: `api/dist/server.js` (single bundled ESM file)
- Node.js 24
- The runtime is created once at startup and reused for every request.
- Development runners (`api/dev-server.ts`, `api/scripts/dev-mongodb-admin.ts`)
  are **not** imported or started.

### What starts automatically

Only the HTTP listener and the MongoDB connection. Nothing else.

Not started or executed:

- Vite, web, or admin dev servers
- seeds, demo data, bootstrap, migrations
- index or collection preparation
- Supabase fallback
- test data purge
- Redemption, Services, Reports, or CMS (feature flags remain off)

### Health and readiness

Both are internal (bind loopback). Do not expose them publicly.

| Endpoint | Purpose | Behavior |
|---|---|---|
| `GET /health` | process liveness | `200 {"status":"ok","service":"afhomes-api","uptimeSeconds":N}` |
| `GET /ready` | bounded MongoDB ping | `200 {"status":"ready"}` or `503 {"status":"not_ready"}` |

`HEAD` is supported. No authentication, business data, environment values, or
writes are involved. The readiness probe is bounded to 2.5 seconds.

`/api/v1/health` remains the existing runtime route (Mongo ping) for compatibility.

### Shutdown

`SIGTERM` and `SIGINT`:

1. stop accepting new connections;
2. close idle keep-alive connections;
3. allow in-flight requests up to `AFHOMES_SHUTDOWN_GRACE_MS` (default 25s);
4. stop the optional maintenance worker;
5. close the MongoDB client;
6. exit.

The systemd unit allows 30 seconds. If the grace expires, remaining connections
are closed and a warning is written to the journal.

## Build

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter api build:artifact
```

Output:

```
api/dist/
  server.js      # bundled ESM entrypoint
  package.json   # { "type": "module" }
  assets/        # workbook templates + postal/address reference data
```

The build bundles the API, `@afhomes/contracts`, `@afhomes/shared`, and runtime
dependencies. Node built-ins and optional native drivers stay external. No
`.env` file or credential is copied.

Verify the artifact locally (safe: disposable MongoDB replica, no Atlas):

```sh
pnpm verify:api:artifact
```

The command builds nothing itself; run the build first. It checks startup,
health/readiness, authentication protection, disabled features, no automatic
collections, and (on Linux) a clean SIGTERM exit.

## Artifact layout and start command

Target layout:

```
/opt/afhomes/api/releases/<release-id>/
  server.js
  package.json
  assets/
/opt/afhomes/api/current -> releases/<release-id>
```

Start:

```sh
node /opt/afhomes/api/current/server.js
```

`import.meta.url` inside the bundle resolves `./assets/` next to `server.js`, so
the symlink layout works without copying assets elsewhere. `AFHOMES_ASSET_ROOT`
can point at an external asset directory if needed.

## Environment

Use `/etc/afhomes/api.env` (`EnvironmentFile` in systemd), owned by
`root:afhomes-deploy`, mode `0640`. Never commit it, never put these values in
`VITE_*`, and never load it into the Vite build.

Required:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `MONGODB_URI` | Atlas M10 connection string |
| `MONGODB_DB` | `afhomes_dev` (approved permanent database) |
| `BETTER_AUTH_SECRET` | at least 32 characters, no surrounding spaces |
| `BETTER_AUTH_URL` | `https://portal.afhomes.com.ph` |
| `AFHOMES_AUTH_TRUSTED_ORIGINS` | `https://portal.afhomes.com.ph` (must include `BETTER_AUTH_URL`) |
| `AFHOMES_WEB_URL` | `https://portal.afhomes.com.ph` |

Normally set for this deployment:

| Variable | Value |
|---|---|
| `HOST` | `127.0.0.1` (default; only `127.0.0.1` or `::1` accepted) |
| `PORT` | `3084` (default; ports below 1024 rejected) |
| `AFHOMES_TRUST_PROXY` | `true` — trusts `X-Real-IP` only when the socket peer is loopback |
| `AFHOMES_ENABLE_SEARCH_MAINTENANCE` | `true` only after retention/cleanup approval |

Optional:

| Variable | Purpose |
|---|---|
| `AFHOMES_ADMIN_URL` | `https://portal.afhomes.com.ph/admin` |
| `AFHOMES_PRIVATE_STORAGE_PROVIDER` | `s3` only; `local` is rejected in production |
| `AFHOMES_S3_ENDPOINT`, `AFHOMES_S3_REGION`, `AFHOMES_S3_BUCKET`, `AFHOMES_S3_ACCESS_KEY_ID`, `AFHOMES_S3_SECRET_ACCESS_KEY` | private bucket configuration |
| `AFHOMES_REQUEST_TIMEOUT_MS` | default `60000`, range `5000..300000` |
| `AFHOMES_SHUTDOWN_GRACE_MS` | default `25000`, range `1000..30000` |
| `AFHOMES_MAX_REQUEST_BYTES` | default `16777216` (16 MiB), range `65536..67108864` |
| `AFHOMES_ASSET_ROOT` | absolute path to an external `assets` directory |
| `AFHOMES_RELEASE_ID` | short release label shown at startup |
| `SMTP_*`, `EMAIL_FROM` | onboarding email delivery |
| `OCR_PROVIDER_URL`, `OCR_PROVIDER_API_KEY` | optional OCR provider |
| `AFHOMES_SEARCH_*` | public sale-team search settings |

Ignored: `SUPABASE_*`, `DATABASE_URL`, `VITE_*`. The production runtime has no
Supabase fallback.

`AFHOMES_ENABLE_TEST_PURGE=true` is rejected in production.

## systemd

```ini
[Unit]
Description=AFHomes Production API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=afhomes-deploy
Group=afhomes-deploy
WorkingDirectory=/opt/afhomes/api/current
EnvironmentFile=/etc/afhomes/api.env
ExecStart=/usr/bin/node /opt/afhomes/api/current/server.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

The artifact contract fits this unit unchanged. `AFHOMES_SHUTDOWN_GRACE_MS`
must stay below `TimeoutStopSec` (25s default is safe). No writable release
directory is required when S3 storage is used.

## Nginx

```nginx
# Allow the largest supported API body (16 MiB); Nginx defaults to 1 MB.
client_max_body_size 16m;

location ^~ /api/ {
    proxy_pass http://127.0.0.1:3084;

    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_connect_timeout 10s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
}
```

Notes:

- `proxy_set_header X-Real-IP $remote_addr` **overwrites** any client-supplied
  value, so `AFHOMES_TRUST_PROXY=true` is safe only while the service is bound
  to loopback.
- Keep `X-Forwarded-For` for diagnostics; the API does not use it for auth.
- Authentication cookies are same-origin and `Secure`; no cookie rewriting is
  needed.
- Do not open port 3084 in the firewall.
- `/health` and `/ready` are intentionally absent from the public Nginx block.
  Use `curl http://127.0.0.1:3084/health` from the droplet, or add a
  `allow 127.0.0.1; deny all;` location if an external monitor needs it.

## Private file storage

`AFHOMES_PRIVATE_STORAGE_PROVIDER=s3` uses the existing S3-compatible private
bucket implementation. Files are never served from the release directory.

If no provider is configured, the service still starts but every private-file
route fails closed (uploads return 403; private downloads are unavailable).
That is intentional: the development filesystem store can never be selected in
production. Configuring the bucket is a deployment prerequisite for identity
documents, payment receipts, and profile photos.

## Maintenance worker

`AFHOMES_ENABLE_SEARCH_MAINTENANCE=true` starts the existing lease-based
public-search retention worker. It:

- runs one sweep at startup and then every 60 seconds;
- only one process holds the lease (`background_jobs`);
- deletes expired search contacts/disclosures/attempts per the saved retention
  settings;
- records its state in `background_jobs`;
- stops cleanly on shutdown.

Default is `false`. Enable only after the privacy/retention policy is approved.
Multiple API instances are safe because of the lease; do not run destructive
maintenance manually in parallel.

## Deployment sequence

```sh
# Build on the droplet (or build elsewhere and copy api/dist)
cd /home/afhomes-deploy/AFhomes-ecofarm-v2
git fetch --all
git checkout <approved-release-commit>
pnpm install --frozen-lockfile
pnpm --filter api build:artifact

release=/opt/afhomes/api/releases/$(date -u +%Y%m%dT%H%M%SZ)
sudo install -d -o afhomes-deploy -g afhomes-deploy "$release"
sudo cp -R api/dist/. "$release"/
sudo ln -sfn "$release" /opt/afhomes/api/current

sudo systemctl restart afhomes-api
curl -fsS http://127.0.0.1:3084/health
curl -fsS http://127.0.0.1:3084/ready
sudo journalctl -u afhomes-api -n 50 --no-pager
```

Before first use, the approved database setup commands remain separate and
approval-gated (for example `prepare-mongodb-core`, catalog, imports). The API
startup never runs them.

### Rollback

```sh
sudo ln -sfn /opt/afhomes/api/releases/<previous-release> /opt/afhomes/api/current
sudo systemctl restart afhomes-api
curl -fsS http://127.0.0.1:3084/ready
```

Keep the previous two releases. Rollback does not touch MongoDB records.

## Operational checks

```sh
# liveness / readiness (loopback only)
curl -s http://127.0.0.1:3084/health
curl -s http://127.0.0.1:3084/ready

# service state
systemctl status afhomes-api
journalctl -u afhomes-api -f

# confirm the listener is loopback only
ss -lntp | grep 3084
```

Expected journal lines contain the host, port, database name, storage mode,
maintenance mode, and optional release id. They never contain credentials,
connection strings, cookies, or request bodies.

## Known limitations and release gates

1. **Private storage must be configured** for a fully functional deployment.
   Without S3, identity documents, payment receipts, and profile photos are
   unavailable (fail closed). This is the main deployment blocker after the
   service itself.
2. **Search retention worker is opt-in.** Enabling it performs approved deletes
   of expired public-search data. Do not enable it without policy approval.
3. **No automatic schema preparation.** Run the existing approval-gated
   `prepare-mongodb-*` commands before relying on a fresh database. Better Auth
   may create its own model indexes and the `auth_rate_limits` collection on the
   first authentication traffic; startup itself creates no collections or
   indexes.
4. **SIGTERM exit code is not asserted on Windows.** The shutdown logic is
   unit-tested on all platforms; verify clean restart once on Linux with
   `systemctl restart afhomes-api`.
5. **Single-instance assumption.** The search worker is lease-based, but no
   other distributed coordination exists. Run one API instance unless reviewed.
6. **Uploads are raw-body endpoints**, not `multipart/form-data`. The existing
   signed-upload routes stream bytes and enforce their own size/type limits.
   Nginx `client_max_body_size` must be at least the largest route body.
7. **Feature flags remain off** for Redemption, Services, Reports, and CMS. Do
   not enable them as part of deployment.

## Verification performed

- `pnpm --filter api typecheck`
- `pnpm --filter api exec vitest run` for configuration, server transport,
  assets, auth transport, private storage, Mongo client, workbooks, and the
  runtime integration spec
- `pnpm --filter api build:artifact`
- `pnpm verify:api:artifact` against a disposable MongoDB replica, running the
  artifact from a temporary directory outside the repository: startup,
  `/health`, `/ready`, Better Auth sign-in with Secure/HttpOnly cookies,
  authenticated business read, sign-out and session invalidation, disabled
  features, legacy signup unmounted, private files fail closed, no collections
  created at startup, missing secret/unreachable database fail closed, and no
  secret in logs. The bundle contains no Supabase client code.
- `pnpm check:env`

Not performed: live Atlas connection, Droplet/Nginx/systemd changes, S3
credentials, browser acceptance, and a real Linux SIGTERM run.
