# Approved core-validator apply: blocked by database privilege

29 October 2026. `AFhomes-ecofarm-v2`, `claud/mongodb-conversion`.

The user approved the exact six-collection proposal in
CORE-VALIDATORS-REVIEW.md. That authorization remains valid for those definitions;
it does not authorize broadening database-user privileges or changing accounts.

## Execution and verification

- Fresh live preflight matched the reviewed digest exactly:
  `0c9e1f503ff99981578b6cfd2ae69eacde65525b9e3a03b7b06ee17f3f231552`.
- All six collections were compatible; 18 documents, zero invalid records.
- Original collection options and aggregate document/index digests were saved
  in a local Git-internal checkpoint. No documents or credentials were exported.
- The operator asserted the exact six approved schema fingerprints, rejected
  changed preflight/options/data, and issued the first `collMod` on `card_sales`.
- That operation failed; execution stopped immediately. No later `collMod` ran,
  and no rollback or privilege/account change was attempted.
- A separate read-only `connectionStatus` privilege inspection returned privileges
  but found no applicable `collMod` grant for the configured application user.
- Independent read-back verified **all six collection options, all 18 business
  documents and their indexes unchanged**, using the saved options and BSON
  aggregate digests. The preflight digest is still identical; all six validators
  remain missing. **Zero validators applied.**

No data inserts/updates/deletes, administrator/password/grant changes, environment
changes, migration, push or deployment ran. The running localhost was preserved.
The operator used per-collection MongoDB schema locks rather than restarting the
user's app; the first DDL was rejected before a schema change occurred. It did
not create a global maintenance window or claim a transaction across collections.

Local-only operator/checkpoint files are in `.git/`; they contain approved
schema definitions/options and digests, not connection strings or record exports.
They are not application startup hooks or a public apply endpoint. No new
automated test/build run was needed: application code did not change in this
execution. Earlier 69-test compatibility proof is recorded in the review.

## How to unblock safely

Use a separate, temporary **MongoDB maintenance database user**, not the AFHomes
Super Admin and not a permanent permission increase on `afhomes_dev_app`.

In Atlas project **AFHomes MongoDB**, open **Database & Network Access**. Have an
authorized Atlas administrator provide either a custom role with the needed
read/metadata and `collMod` privileges for the reviewed collections, or a
temporary database-scoped `read` + `dbAdmin` maintenance user for `afhomes_dev`.
Restrict it to Cluster0 and remove it after verified completion. Do not grant
project-wide/global administration, change network access or reset app passwords.
Atlas roles/users must be managed through Atlas, not `createRole`/`grantRoles`
commands issued through the application database connection.

Put that user's connection string privately in
`C:\Users\SSD-CLAUD\AFhomes-ecofarm-v2\.env.mongodb-maintenance.local` with
server-only `MONGODB_URI` and `MONGODB_DB=afhomes_dev`. This path is verified ignored
by Git. It has not been created or populated automatically. Leave `.env.local`
unchanged and keep the URI/password out of chat, reports and commits.

Then resume the already-approved apply using only that maintenance environment,
after checking privileges and rerunning the exact preflight. A changed proposal,
conflicting rule or incompatible record blocks execution. Never drop/recreate a
collection, bypass validation or broaden the application's permissions to force
the operation through.

This permission prerequisite does not cancel the existing six-validator approval.
Full browser acceptance, durable backups, complete migration and production
deployment remain separate, unfinished gates. CMS stays last.

References: [collMod privileges and locking](https://www.mongodb.com/docs/v8.0/reference/command/collmod/),
[Atlas custom-role administration](https://www.mongodb.com/docs/atlas/security-add-mongodb-roles/).
