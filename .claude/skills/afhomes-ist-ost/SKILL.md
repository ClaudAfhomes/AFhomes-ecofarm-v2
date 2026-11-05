---
name: afhomes-ist-ost
description: AF Homes IST/OST sellers — AAI/AAO accreditation numbers, OST direct creation, renewal, IST↔OST conversion, genealogy (VD → SSM → SM → OST), sponsors and expired-term team transfer. Use for any change to members, accreditation, genealogy or sales-team lookup.
---

# IST / OST, accreditation and genealogy

## Sources (read the relevant section only)
- `docs/AFHOMES-BUSINESS-RULES.md` §6 (accreditation format), §16 (IST identity, owner 2026-10-18)
- `docs/mongodb/MEMBER-KIND-CONVERSION-REPORT.md`, `MEMBER-TEAM-TRANSFER-REPORT.md`,
  `OST-APPLICANT-CORRECTIONS-REPORT.md`, `ACCOUNT-CREATION-SEARCH-REPORT.md`
- Code: `rg -n "AAO|AAI" api/_lib --glob '!*.spec.ts'`, `api/_handlers/members*.ts`, `ost*.ts`,
  `api/_lib/genealogy.mongo.ts`, `apps/admin/src/features/network-members/`, `apps/web/src/features/ost/`

## Approved business rules (D15, owner 2026-11-04; Rules §16; `docs/ai/decision-register.md`)
- IST→OST conversion keeps the numeric portion and changes the prefix: `AAI26100001` → `AAO26100001`.
  Collisions with any current/historical AA identity block conversion; never overwrite an existing AAO.
- The effective IST→OST transfer date becomes the original OST accreditation date.
- OST accreditation requires annual renewal. IST accreditation (AAI) is permanent — no annual renewal.
- Original accreditation dates and historical expiry records are immutable.
- Renewal approvals follow the official company renewal form and the authorized management hierarchy.
- OST genealogy/team transfer is permitted only after accreditation expiry, and still requires approval;
  expiry creates eligibility, it does not execute the transfer.

## Other established facts (repo docs/code, 2026-11-04)
- Roles (slugs): `vice_director`, `senior_sales_manager`, `sales_manager`, `ost`, plus admin/finance/hr/employee.
  "SVD" appears only as a legacy alias in a migration spec — confirm before using.
- Format `AAIYYMMNNNN` / `AAOYYMMNNNN` (11 chars); one company-wide monthly sequence shared by both prefixes.
  Legacy `AA-` + 12 chars still valid. Issued numbers never renumbered, reused or reissued.
- IST = employees in VD/SSM/SM hierarchy. OST is created directly and already accredited (owner
  2026-10-26) — no registration/endorsement journey.
- Manual OST create needs an active SM with valid upline. Field "Sponsor (active Sales Manager)" lists
  active SMs only; do not apply that restriction to public referral flows (VD/SSM/SM referrals valid).
- OST→IST: fresh AAI from the shared allocator.
- Dates are Manila (`Asia/Manila`), not UTC.

## MongoDB implementation status — verification PENDING (U5)
Approved ≠ implemented. `docs/mongodb/MEMBER-KIND-CONVERSION-REPORT.md` and
`MEMBER-TEAM-TRANSFER-REPORT.md` report suffix preservation, collision blocking and server-side
expired-term transfer checks, but this skill has not verified them. Not yet located in code: the
conversion-date rule, the renewal form/approver hierarchy, and the exact public-lookup field set.
Before relying on or changing any D15 behavior, confirm it in the handler and its spec, and add a
failing spec for any gap.

## Procedure
Business-rules skill → locate handler + spec → write failing spec → smallest change → run
`pnpm --filter api exec vitest run <spec>` and the UI spec if touched.

## Never
Regenerate an AA number on status change; overwrite an existing AAO; edit historical expiry dates;
change live accreditation identities without approval.
