---
name: afhomes-deployment
description: Reference procedures for the AF Homes native DigitalOcean Droplet deployment (Node + systemd + Nginx + MongoDB Atlas, no Docker) — release update, rollback, env, Nginx, systemd, logs, health. Manual invocation only; every production action needs explicit per-action approval.
disable-model-invocation: true
---

# Deployment (procedures only — never executes on its own)

## Status (owner correction and branch inspection 2026-11-05)
- Repo templates: `deploy/digitalocean/afhomes.service`, `nginx-afhomes.conf`, `nginx-bootstrap.conf`.
- Runbook: `docs/mongodb/DIGITALOCEAN-NATIVE-HOSTING.md` (§ "Reviewed installation sequence — not executed here",
  § "Release, rollback and backup gates"). Hosted proof: `HOSTED-RUNTIME-VERIFICATION.md`.
- Owner confirms an existing DigitalOcean deployment; this supersedes the earlier undeployed status (D20).
- Freshly fetched `origin/develop` and `origin/release/v2.0` contain `api/_server.ts`,
  `docs/mongodb/PRODUCTION-API-DEPLOYMENT.md` and `scripts/afhomes-release.sh` (manual release helper).
  The old `staging/v1.0` branch was removed. The production runtime options differ from this branch.
- Running commit, SSH access, service/layout and environment remain unverified. Do not overwrite
  the existing deployment using this branch's older templates. Inspect the approved target first;
  neither a Git push nor reading this skill authorizes a deployment or service action.

## Before anything
State the exact action, target host, branch/commit and rollback; get explicit approval for that action.

## Procedures (templates — adapt to the verified layout)
1. Inspect (read-only, still ask before SSH): `systemctl status <svc>`, `journalctl -u <svc> -n 200 --no-pager`,
   `curl -sS http://127.0.0.1:3084/api/v1/health` with the canonical proxy headers (runbook step 7).
2. Update release: fetch approved commit → `pnpm install --frozen-lockfile` → `pnpm build:hosted` →
   `pnpm check:env -- --built` → switch release dir/symlink → `systemctl restart <svc>` → health + smoke.
3. Rollback: repoint to previous release dir → restart → health. Never roll back data without separate approval.
4. Env change: edit server env file (never echo values) → restart → health. Never paste secrets into chat.
5. Nginx: edit → `nginx -t` → `systemctl reload nginx` → curl public + `/api/v1/health`.
6. systemd: edit unit → `systemctl daemon-reload` → restart → status/logs.
7. Post-deploy verification: health `ok`, login page, one read-only authenticated page, logs clean.

## Never
Deploy, restart, change DNS/TLS/firewall/Atlas allowlist, enable disabled modules, run setup/bootstrap/
migration scripts, or use Vercel for this workflow — without explicit approval.
