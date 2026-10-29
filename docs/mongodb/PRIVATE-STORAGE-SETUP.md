# Private file storage setup

## Current choice: localhost

The user deferred paid cloud storage on 26 October 2026. `pnpm dev` now defaults
to persistent private filesystem storage for `afhomes_dev`, under
`C:\Users\SSD-CLAUD\.afhomes\private-storage\afhomes_dev` on this computer.
No new credentials, bucket or Droplet are required. `.env.local` was not changed.
An empty storage-provider variable or `local` selects this mode in the development
launcher only. An explicit `s3` configuration is validated, never silently replaced.

Files survive application restarts. Downloads use short-lived signed links;
the existing server authentication secret derives a separate signing key.
The directory is outside the repository and Vite's served files. Back it up
alongside MongoDB; deleting it loses uploaded files. Only converted upload
workflows (currently profile photos) use it; ID/receipt document workflows
still need their MongoDB conversion. Hosted runtimes cannot select local storage.

`pnpm dev` preserves the explicit business-write gate. After the approved core
setup, enable converted core routes using the command for your terminal.

Git Bash (the terminal currently used in VS Code):

```bash
AFHOMES_MONGODB_ENABLE_CORE_WRITES=true pnpm dev
```

PowerShell:

```powershell
$env:AFHOMES_MONGODB_ENABLE_CORE_WRITES = 'true'
pnpm dev
```

Stop an already running server first. This starts the real search-retention worker
and permits authorized native business operations, without seeding or bootstrap.
Configure real card plans in Card Products. Public search additionally requires
actual administrator privacy approval and working Turnstile configuration.
The application and files run locally; the configured MongoDB database remains Atlas.

## Optional future cloud setup (deferred)

Use a separate **private DigitalOcean Spaces bucket** for AFHomes development.
MongoDB stores ownership/metadata; photo, ID and receipt bytes stay in object
storage. No Droplet or application deployment is needed for this step.

Creating the first bucket starts a paid Spaces subscription. Review the summary
in your own DigitalOcean account before creating it; no resource has been created
by this work. See [DigitalOcean's creation guide](https://docs.digitalocean.com/products/spaces/how-to/create/).

## In DigitalOcean

1. Open **Spaces Object Storage → Create Bucket**. Choose Standard Storage and
   Singapore (`sgp1`) for this suggested development setup. Use a unique neutral
   name, such as `afhomes-dev-private` if available. Leave the CDN disabled.
2. Keep bucket file listing private and uploaded objects private. Do not enable
   public-read access. A private listing alone does not make a public object private.
3. Open **Spaces Object Storage → Access Keys → Create Access Key**. Choose
   **Limited access**, select only this development bucket and grant
   **Read/Write/Delete**. Name it `afhomes-dev-app`. Keep the secret locally;
   DigitalOcean shows it only once. [Access-key instructions](https://docs.digitalocean.com/products/spaces/how-to/manage-access/).
4. Use ordinary private ACLs with this limited key. DigitalOcean's limited
   per-bucket keys are incompatible with `PutBucketPolicy` bucket policies;
   do not add a bucket policy copied from an AWS tutorial.

## In the existing server environment file

Edit `C:\Users\SSD-CLAUD\AFhomes-ecofarm-v2\.env.local` locally. Add the following
variables, replacing placeholders. Do not paste keys into chat or commit the file.

```dotenv
AFHOMES_PRIVATE_STORAGE_PROVIDER=s3
AFHOMES_S3_ENDPOINT=https://sgp1.digitaloceanspaces.com
AFHOMES_S3_REGION=us-east-1
AFHOMES_S3_BUCKET=your-actual-private-bucket-name
AFHOMES_S3_ACCESS_KEY_ID=your-access-key
AFHOMES_S3_SECRET_ACCESS_KEY=your-secret-key
AFHOMES_MONGODB_ENABLE_CORE_WRITES=false
```

The endpoint must be the regional service endpoint, not the bucket URL or CDN
URL. `us-east-1` follows DigitalOcean's AWS SDK client example; the endpoint
selects the actual DigitalOcean datacenter. See [official SDK configuration](https://docs.digitalocean.com/products/spaces/reference/aws-sdks/).

Preserve the existing MongoDB/Better Auth values and administrator credentials.
These are server variables: never add `VITE_` to their names. Uploads go through
the authorized API, so no public browser upload key or wildcard write CORS rule
is needed.

## Verify before enabling real writes

Run `corepack pnpm mongodb:core --plan`. Its output contains only readiness and
reference metadata; `privateStorageConfigured: true` validates configuration
shape, not cloud credentials or bucket privacy.

Keep the write flag false until the approved database setup is complete and the
private storage connection has been checked. The final controlled storage check
must establish that a synthetic private object can be uploaded/read/replaced,
its direct anonymous URL is denied and its signed URL expires. No real ID or
receipt should be used for that check. Live object writes need explicit scope;
ordinary disposable tests do not exercise your cloud bucket.

After entering the values, report only **"storage configured"**. Keep both keys
out of chat. No production deployment or Supabase data migration is part of setup.
