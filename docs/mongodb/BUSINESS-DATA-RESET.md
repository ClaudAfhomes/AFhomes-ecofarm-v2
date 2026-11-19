# Business-data reset (afhomes_dev)

One-time utility that empties business records and keeps the Organization module working.
Script: `api/scripts/reset-business-data.ts`. Rules: `api/_lib/business-data-reset.mongo.ts`
(`RESET_RULES`). Test: `api/_lib/business-data-reset.mongo.spec.ts`.

> `afhomes_dev` is hosted on Atlas. Running `--apply` is a destructive Atlas write and needs
> the owner's explicit approval in the session where it runs. Even `--plan` connects to Atlas
> and needs a go-ahead. This guide does not grant either.

## What it keeps and deletes

| Rule | Collections |
|---|---|
| Preserve | Organization: `staff_users` (IST/OST sellers included), `departments`, `roles`, `role_permissions`, `staff_role_assignments`, `staff_permission_restrictions`, `modules`, `mfa_policy`, `public_verification_settings`, `background_jobs`, `staff_invitations`. System and configuration: `counters`, `admin_bootstrap`, `mongo_conversion_setup`, `auth_rate_limits`, card plans and categories, tier points, commission rules, service catalog. CMS collections. |
| Per record | `auth_users`, `auth_accounts`, `auth_sessions`, `auth_two_factors`, `auth_session_assurance`. A staff user's records stay. Records owned only by a customer are deleted. Records owned by neither block the reset. |
| Review (kept untouched) | `audit_events` (append-only), `vip_card_number_issuances`, `business_id_aliases` (permanent identifiers), seller records (`ost_*`, `sale_team_accreditations*`, `network_member_profiles`, `referral_*`), `identity_documents`, `profile_photos`, `auth_verifications`, `mutation_requests`, `storage_cleanup_jobs`, test leftovers. |
| Delete | Customers, memberships, applications, reservations, card sales, purchases, payments, document evidence, commissions, final qualifications, earning claims, points, redemptions, service refunds, public-search logs, customer imports. |

Never touched: collection definitions, indexes, validators, `counters`. Nothing is dropped.
Private files on disk are not deleted.

## Preview (read-only)

Stop `pnpm dev` first, so no sign-in or write changes the fingerprint. From the repository root:

```sh
pnpm exec tsx api/scripts/reset-business-data.ts --plan
```

Expected: JSON with `ready: true`, empty `blockers`, per-collection `total`, `delete` and
`preserve` counts, and a 64-character `fingerprint`. Exit code 0 when ready, 2 when blocked.

If blocked:
- `not classified`: a collection is missing from `RESET_RULES`. Classify it in code first.
- `not linked to a staff user or customer`: a sign-in has no owner. The owner decides what happens to it.

## Execute (later, with approval)

Capture and verify a backup, preview again, then apply within 60 minutes of the capture:

```sh
pnpm exec tsx api/scripts/backup-mongodb-local.ts capture
pnpm exec tsx api/scripts/backup-mongodb-local.ts verify <archive.afhb>
pnpm exec tsx api/scripts/reset-business-data.ts --plan
pnpm exec tsx api/scripts/reset-business-data.ts --apply --confirm-target afhomes_dev --fingerprint <fingerprint> --backup <archive.afhb>
```

`--apply` refuses unless every check passes:
1. Target is `afhomes_dev`, and no production setting is present.
2. Backup is under 60 minutes old and decrypts.
3. Backup restores into a new disposable local replica.
4. Live data still produces the same fingerprint.
5. Backup holds every current record ID.

All deletes run in one transaction. Above 50,000 deletes the reset refuses.

Expected: JSON with `applied: true`, `schemaUnchanged: true`, `countsMatch: true`, and
`remaining` equal to `preserve` for every collection. Afterwards, sign in as a staff user
and open Organization and Verification Settings.

## Recovery

The `.afhb` archive from the capture step is the recovery point. It is encrypted to the
current Windows user, and there is no off-device copy. The `verify` command proves the
archive restores into a disposable local database.

No automated restore into `afhomes_dev` exists. Restoring Atlas needs a separate,
approved procedure (see `RECOVERY-REHEARSAL.md`). Deleted records are never recreated
automatically.
