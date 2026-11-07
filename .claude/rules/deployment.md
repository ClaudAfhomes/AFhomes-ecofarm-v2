---
paths:
  - "deploy/**"
  - "api/server.ts"
  - "api/_lib/hosted-*.ts"
  - "api/scripts/build-hosted.ts"
  - "vercel.json"
  - "scripts/*vercel*"
---

# Deployment rules

- Approved target: DigitalOcean Droplet, Node + systemd + Nginx, MongoDB Atlas, **no Docker**.
  Templates: `deploy/digitalocean/`; runbook `docs/mongodb/DIGITALOCEAN-NATIVE-HOSTING.md`.
- `vercel.json`/Vercel scripts belong to the legacy Supabase deployment — keep, do not extend.
- Never SSH, deploy, restart services, edit server env, Nginx, systemd, DNS or Atlas access
  without explicit, per-action approval. Use the `/afhomes-deployment` skill for procedures.
- `pnpm build:hosted` must not embed server secrets; run `pnpm check:env -- --built` after builds.
