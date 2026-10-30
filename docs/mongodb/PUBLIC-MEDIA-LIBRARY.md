# Public Media Library (local disk)

Authorized AFHomes staff can upload public website images and approved PDFs.
Files live on the Droplet at `/var/lib/afhomes/media/public`, outside Git,
frontend builds, API releases, and rollback directories. No S3/Spaces account is
required. Private business files keep using the existing private object store.

## Architecture

```
Admin /admin/media
  └── /api/v1/media  (Better Auth + cms.media RBAC)
        ├── metadata: MongoDB `public_media_assets`
        └── bytes:    /var/lib/afhomes/media/public/<uuid>.<ext>

Public browser / media consumers
  └── https://portal.afhomes.com.ph/media/<uuid>.<ext>
        └── Nginx alias to /var/lib/afhomes/media/public (production)
        └── Node `/media/...` response (development / direct API)
```

- **Upload**: `POST /api/v1/media?name=...&alt=...&category=...` with the raw
  file as the request body and its real `Content-Type`.
- **Replace**: `PUT /api/v1/media/:id?name=...&alt=...&category=...` with the raw
  file. The previous record is unpublished and its file removed.
- **List/search**: `GET /api/v1/media?search=&category=&status=&limit=&offset=`.
- **Detail**: `GET /api/v1/media/:id`.
- **Update**: `PATCH /api/v1/media/:id` with
  `{ "altText"?: string, "category"?: string, "status"?: "published" | "unpublished" }`.
- **Delete**: `DELETE /api/v1/media/:id?confirm=true`.
- **Public file**: `GET /media/<uuid>.<jpg|png|webp|gif|pdf>`.

Uploads are streamed by the existing raw-body adapter; JSON bodies are not used
for file bytes. The global transport cap remains 16 MiB, and the media store has
its own lower default (10 MiB).

## Storage rules

- Generated key: `${randomUUID()}.${extension}`. The original filename is only
  metadata, never a path.
- Allowed types: JPEG, PNG, WebP, GIF, PDF. SVG, HTML, JavaScript, executables,
  and unknown types are rejected.
- Content is validated by file signature, not by extension or browser MIME.
- Files are written atomically (temporary file then rename) with mode `0644`.
  Temporary names start with `.upload-` and are never publicly served.
- The storage root must be an absolute path, must exist, and must be writable by
  `afhomes-deploy`. Missing/read-only storage fails the API startup when the
  root is configured; if the setting is absent, media routes return `503`.
- Total usage is checked before every upload. When the cap is reached the API
  returns `507 INSUFFICIENT_STORAGE`; nothing is deleted automatically.
- Unpublishing removes the public file so no stale URL remains accessible.
  Publishing again requires a new upload/replacement.

## MongoDB metadata

Collection: `public_media_assets`

| Field | Meaning |
|---|---|
| `_id` | Media ID (UUID) |
| `storage_key` | Generated filename under the public root |
| `original_name` | Sanitized original filename |
| `mime_type` | Validated MIME type |
| `media_type` | `image` or `document` |
| `size_bytes` | Byte length |
| `width`, `height` | Image dimensions when parseable; `null` for PDFs or unknown |
| `alt_text` | Staff-provided alternative text |
| `category` | Staff-provided grouping |
| `status` | `published` or `unpublished` |
| `uploaded_by` | Staff user ID from the session |
| `replaced_from` / `replaced_by` | Replacement chain |
| `created_at`, `updated_at` | ISO timestamps |

Audit events are appended to `audit_events` with `entity_type: "public_media"`:
`MEDIA_UPLOADED`, `MEDIA_REPLACED`, `MEDIA_UPDATED`, `MEDIA_UNPUBLISHED`,
`MEDIA_DELETED`.

## Permissions

Media uses the existing `cms.media` module key and the existing RBAC model:
`view`, `create`, `update`, `delete`. Super Admin holds every module implicitly.
Other roles need an explicit assignment through the existing Roles screen; the
baseline role matrix deliberately grants `cms.media` to nobody.

The public `/media/` static route is unauthenticated by design. Upload, list,
replace, unpublish, and delete always require a staff session and the matching
`cms.media` action. Ordinary visitors cannot modify media.

## Environment

Add to `/etc/afhomes/api.env` (server-only; never `VITE_*`):

```sh
AFHOMES_PUBLIC_MEDIA_ROOT=/var/lib/afhomes/media/public
AFHOMES_PUBLIC_MEDIA_MAX_BYTES=10485760
AFHOMES_PUBLIC_MEDIA_MAX_TOTAL_BYTES=2147483648
```

| Variable | Default | Purpose |
|---|---|---|
| `AFHOMES_PUBLIC_MEDIA_ROOT` | unset (media disabled) | Absolute persistent root |
| `AFHOMES_PUBLIC_MEDIA_MAX_BYTES` | `10485760` (10 MiB) | Per-file cap |
| `AFHOMES_PUBLIC_MEDIA_MAX_TOTAL_BYTES` | `2147483648` (2 GiB) | Total cap |

Public URLs derive from `AFHOMES_WEB_URL`; set it to
`https://portal.afhomes.com.ph`. Do not put the storage path in browser env.
The existing private S3 settings remain independent and optional.

## Linux directories and permissions

Run only during approved deployment:

```sh
sudo install -d -m 0755 -o root -g root /var/lib/afhomes
sudo install -d -m 0755 -o root -g root /var/lib/afhomes/media
sudo install -d -m 0750 -o afhomes-deploy -g www-data /var/lib/afhomes/media/public

# Verify: Node can write, Nginx can read and traverse, no world write.
sudo -u afhomes-deploy test -w /var/lib/afhomes/media/public && echo "api write OK"
sudo -u www-data test -r /var/lib/afhomes/media/public && echo "nginx read OK"
stat -c '%A %U:%G %n' /var/lib/afhomes/media/public
```

Never use `chmod 777`. Do not grant Nginx write access. Do not change
`/etc/afhomes` or the existing `api.env` ownership/mode.

## Nginx (proposed; not applied)

Add to the existing TLS `server` block, before the SPA fallback:

```nginx
# Public media: allowlisted generated names only, never directory listings.
location ~ ^/media/(?<afhomes_file>[A-Za-z0-9-]+\.pdf)$ {
    alias /var/lib/afhomes/media/public/$afhomes_file;
    autoindex off;
    disable_symlinks on;
    add_header X-Content-Type-Options nosniff always;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    add_header Content-Disposition "attachment" always;
    add_header Content-Security-Policy "default-src 'none'; sandbox" always;
}

location ~ ^/media/(?<afhomes_file>[A-Za-z0-9-]+\.(?:jpg|png|webp|gif))$ {
    alias /var/lib/afhomes/media/public/$afhomes_file;
    autoindex off;
    disable_symlinks on;
    add_header X-Content-Type-Options nosniff always;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    add_header Content-Disposition "inline" always;
}

# Any other /media path is a 404, never the SPA shell.
# Do NOT use `^~` here: it would suppress the regex locations above.
location /media/ {
    return 404;
}
```

Add this guard to the existing SPA location (keep its current `try_files`
target). Nginx normalizes encoded traversal before location matching, so
`/media/%2e%2e%2f...` can otherwise fall through to the SPA:

```nginx
location / {
    if ($request_uri ~* "^/media/") { return 404; }
    try_files $uri $uri/ /index.html;
}
```

Notes:

- Regex locations are evaluated before the plain `/media/` prefix because the
  prefix has no `^~` modifier, so only generated allowlisted names are served.
- Everything else under `/media/` reaches the `return 404` fallback, never the
  SPA `location /`.
- The `$request_uri` guard keeps encoded traversal that normalizes out of
  `/media/` from reaching the SPA. It does not affect ordinary frontend paths.
- `disable_symlinks` prevents a symlink escape; the app also rejects symlinks.
- Missing files return `404` by default. No SPA fallback is possible under
  `/media/`.
- Do not proxy `/media/` to the API in production; Nginx should serve the
  persistent directory directly. The API also serves `/media/` for local
  development and as a fallback.
- Keep the existing frontend `/` and `/admin/` blocks unchanged.
- Keep the current `/api/` 503 block until the production API cutover is
  approved; this task does not change it.

## Admin Media Library

Route: `/admin/media` (top-level nav item, module `cms.media`).

Supports:

- Upload image/PDF with alt text and category.
- Browse and search by filename/alt/category.
- Preview images and open PDFs.
- Copy public URL.
- Replace a file (new URL; old record unpublished).
- Unpublish (removes the public file).
- Delete with explicit confirmation.
- Clear upload/validation errors.

The CMS module remains disabled. There is no media picker inside the disabled
CMS content fields. Use the copied public URL in an existing supported image
field when CMS editing is separately approved/activated. This is the remaining
integration limitation, not a reason to enable all of CMS.

## Backup and restore

Working storage and metadata are separate:

```sh
# Metadata (never print the URI)
mongodump --uri "$MONGODB_URI" --db afhomes_dev \
  --collection public_media_assets --out /secure/backup/mongo

# Public media bytes
sudo tar -C /var/lib/afhomes/media -czf /secure/backup/public-media.tar.gz public
```

Restore to a new/empty environment:

```sh
sudo install -d -m 0750 -o afhomes-deploy -g www-data /var/lib/afhomes/media/public
sudo tar -C /var/lib/afhomes/media -xzf /secure/backup/public-media.tar.gz
mongorestore --uri "$MONGODB_URI" --db afhomes_dev \
  --collection public_media_assets /secure/backup/mongo/afhomes_dev/public_media_assets.bson
```

A copy on the same Droplet disk is **not** an independent backup. Use an
approved separate destination later; do not purchase or configure one in this
task.

## Disk monitoring

```sh
df -h /var/lib/afhomes/media
du -sh /var/lib/afhomes/media/public
find /var/lib/afhomes/media/public -maxdepth 1 -type f | wc -l
```

The API refuses new uploads at `AFHOMES_PUBLIC_MEDIA_MAX_TOTAL_BYTES` and returns
`503` on a filesystem I/O failure. It never deletes media automatically.

## Known limitations

1. CMS content-field picker is not enabled (CMS remains disabled).
2. Nginx configuration above is proposed, not applied to the live server.
3. Private S3 storage is unchanged and still unconfigured; private uploads fail
   closed as before.
4. Local disk is not an independent offsite backup.
5. Unpublishing deletes the file; republishing requires re-upload.
6. One API instance is assumed. Total-usage calculation scans the flat media
   directory on each upload, which is acceptable for the initial library size.
7. No image resizing/optimization or malware scanning. Staff must upload
   web-sized, approved files only.
8. Video is not supported by this media library (images and PDFs only).
9. No per-user upload-frequency throttle; authorization, per-file cap, and total
   cap are the enforced limits. Add a shared limiter if multi-instance abuse
   becomes a concern.
10. A process crash between the atomic file write and the metadata transaction
    can leave an unreferenced file. Generated UUID names are not discoverable
    through the API; remove orphans manually during maintenance. Replacement
    removes the previous file best-effort after commit.
11. CMS references are not scanned before deletion because CMS remains disabled;
    the operator confirms deletion explicitly in the Media Library.

## Verification performed

- `pnpm typecheck`
- `pnpm --filter api exec vitest run _lib/public-media-store.spec.ts`
- `pnpm --filter api exec vitest run _lib/media.mongo.spec.ts`
- `pnpm --filter @afhomes/admin exec vitest run src/features/media/MediaLibraryPage.spec.tsx`
- `pnpm --filter api build:artifact`
- `pnpm verify:api:artifact` (includes real sign-in, authorized upload, public
  fetch, listing, unpublish, 404, delete, and private-file separation)
- `pnpm build`
- `pnpm check:env`
- Nginx location precedence exercised in a disposable `nginx:alpine` container:
  `/media/<uuid>.png` and `.pdf` returned `200` with immutable/nosniff and
  inline/attachment headers; `.html`, `.svg`, dotted names, missing files, and
  encoded traversal returned `404`; no SPA fallback under `/media/`.

Not performed: live Droplet/Nginx changes, production Atlas writes, S3 private
storage, browser acceptance against the production domain, independent backup.
