# Configurable IST compensation policies - implementation evidence

Status: implemented locally on claud/supabase. Reference templates are not approved policies or payable payroll. No shared/production database was modified.

## Reference templates

Central immutable definition: packages/shared/src/ist-policy-templates.ts. Version: afhomes-table-a-v1. Sources: AFHomes BR-PB-03, B8 section 2 Table A, BR-PB-02 collection quota, and the owner's supplied implementation request. The older source notes' implementation-status labels are historical; current source and these tests establish current behavior.

| Rank | Monthly BA | BA target | Monthly PA | PA target | PB target | PB rate | Payroll collection gate |
|---|---:|---:|---:|---:|---:|---:|---:|
| SM | 15,000.00 | 200,000.00 | 15,000.00 | 1,000,000.00 | 2,000,000.00 | 1% | 40% |
| SSM | 25,000.00 | 600,000.00 | 25,000.00 | 2,000,000.00 | 4,000,000.00 | 3% | 40% |
| SVD | 50,000.00 | 1,800,000.00 | 50,000.00 | 5,000,000.00 | 10,000,000.00 | 2% | 40% |

Definitions are versioned code reference data, loaded without database initialization or duplicate records. They contain no approval, actor or effective-date fields. OST eligibility and vice_director-to-SVD mapping are unchanged. Payroll's collection gate remains independent of commission qualification.

## Existing management workflow enhanced

- Three rank summary cards show saved policy state or clearly labelled historical reference values. Selecting a card filters that rank. Inactive versions are available through View history; source/basis, rule references, approval date and finalized-period information stay inspectable.
- New Draft preloads the selected rank's reference figures. Rank controls use compact radio cards. Every compensation value remains editable; Restore reference values is explicit. Existing saved drafts retain their values when rank changes.
- Compensation, Qualification, Validity and Approval form sections reuse existing controls. Review limits are optional details. Values display with currency grouping; malformed grouping is rejected. Percentages use human units, such as 1 and 40, and existing exact conversion helpers translate them into API fractions. The existing shared formatter also now correctly displays the 100% endpoint.
- Reference version/source is recorded in the existing basisNote alongside the user's required reason. No new policy store is introduced.
- Create new version copies an approved policy into a new draft via the existing create endpoint. It preserves compensation and qualification settings, clears dates and the change-reason input, retains previous-policy ID/version lineage, and obtains a new server-assigned policy version. The original approved row is never edited by this action.
- Draft creation uses the existing payload-bound idempotency helper and endpoint header, including timeout/failure retries. Editing uses the existing full-document PUT.
- Approval uses existing permissions, evidence references and SQL transitions. A new read-only approvalConflict hint explains why a prior creator/editor/submitter cannot approve; no actor-history list is exposed and SQL remains authoritative.
- Simulation can explicitly load the same reference definitions. It retains isolated simulation records/routes and never creates an approved compensation policy.

## Validity and financial integrity

The existing database supports all required fields and lifecycle controls, so no migration was added. Effective dates are user-supplied. Draft/approval states, derived active/expired/superseded states, overlapping approved-window refusal, separation of duties and the policy-transition guard are preserved. Changing an approved schedule requires a new draft and the existing approval workflow; the UI does not auto-end the old policy.

The calculation engine and live resolver were reused unchanged. They select approved rank/date policies and engagement/performance evidence. QP BA retains its separate engagement decision; EP BA and PA use their governed qualification factors. PB remains rate times qualified Equivalent TCP, with no second proration. Policy IDs/versions and saved calculation evidence remain attached to payroll history. New templates are never a fallback for a missing live policy.

Contract validation now matches the existing governed RPC for supported money precision/range, unit rates, positive collection gate and correctly ordered real dates. This closes validation gaps before RPC execution without relaxing any SQL checks.

## Verification

| Check | Actual result |
|---|---|
| Disposable local PostgreSQL | 3,944 passed; includes policy lifecycle, overlap, self-approval, date transitions, snapshots, simulation and financial-integrity checks |
| Payroll/Admin/route authorization | 137 passed |
| Related business-formatting and engagement/rule UI | 41 passed |
| API payroll/IST/authorization | 164 passed |
| Policy/engagement contracts | 21 passed |
| Exact-decimal engine and templates | 35 passed |
| Final form-error/retry recheck | 3 passed, 55 unrelated cases intentionally skipped in that focused rerun |
| Scoped Admin lint | Passed, zero errors |
| Shared typecheck | Passed |
| Workspace typecheck | 6 of 7 tasks passed; Admin failed on the unrelated existing application-actions.spec.tsx:606 null-to-string type mismatch |
| Admin package build | Blocked by that same unrelated typecheck failure; build gate was not removed |
| Diagnostic Vite bundle | Passed; existing large-chunk warning remains; not a substitute for the package build gate |
| Normal localhost:5174 source | Updated policy form, management page and simulation modules served successfully |
| Fresh browser/mobile/console workflow | Not accepted; browser connection verification remains outstanding |

The new tests cover all rank references, immutable template copies, restoration, saved-draft rank changes, future-version copying, percentage bounds/conversion, invalid dates, source/version persistence, request-key reuse, history display, self-approval UX and simulation isolation. A synthetic edited policy with BA 18,000, PA 20,000 and PB 1.5% calculates independently from its reference: KPI 5,000,000 and collection 1,000,000 yield Equivalent TCP 2,500,000 and net 75,500. The unchanged reference yields net 55,000. These are test examples, not company-approved values.

## Configuration still required for live use

Authorized management must choose actual effective dates, review/edit the figures, provide real approval evidence references and complete separate approval. Policy preparers need the existing finance.payroll_policy create/update permissions; approvers need finance.payroll_policy_approval update. No role grants were changed. Eligible engagements, QP decisions where applicable, and approved performance rules remain required. Q1 model provenance is separate from schedule approval. No new reversal, recovery, DRI, imported-credit or transition rule was invented.

## Files and Git

Production source touched: packages/shared/src/ist-policy-templates.ts and index.ts; packages/contracts/src/schemas/payroll.ts; api/_lib/payroll.ts; apps/admin/src/features/business/PayrollPolicyDialogs.tsx, PayrollPolicies.tsx, PayrollSimulation.tsx, IstPayrollPage.module.css and format.ts.

Tests added/updated: packages/shared/src/ist-policy-templates.spec.ts; packages/contracts/src/schemas/payroll-policy.spec.ts; api/_handlers/payroll.spec.ts; Admin IstPayroll.spec.tsx and format.spec.ts. This report records verification; earlier Finance QA evidence remains separate.

No migrations, seeds, bootstrap, shared writes, commit, push, merge or deployment. Existing dirty work and staged deletions of GlobalSearch.tsx, GlobalSearch.spec.tsx and MyWorkToday.tsx were preserved. The unrelated application/RA test type mismatch was left untouched as requested by this task's scope restrictions.
