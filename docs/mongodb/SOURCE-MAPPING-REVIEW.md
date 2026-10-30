# Source mapping review - 30 October 2026

Fresh metadata collected with verified TLS and repeatable-read, read-only queries. No business rows, password hashes or private bytes were exported.

All selected columns, SQL constraints and indexes are in the companion JSON. These are schema facts, not executable migration approval. Each candidate requires native field/key comparison and a disposable transformation/reconciliation test.

## Confirmed adapter requirements

- Source `role_permissions` uses `(role_id, module_id)` as its primary key;
  native organization writes give it a separate `_id` and enforce the pair with
  a unique index. Match the remapped pair and compare all four grant flags before
  reuse. Do not union grants or replace an existing target permission row.
- Source `staff_role_assignments` uses `staff_id` as its primary key; native
  creation also stores `_id`. Preserve the mapped staff/role/assigning-actor
  references, use a stable migration identity for a new row, and exclude the
  protected owner's existing assignment from replacement.
- Source `staff_permission_restrictions` has a composite staff/module key and
  source `network_member_profiles` has a staff key. Native unique indexes use
  those business keys while records also need `_id`. Map staff references
  explicitly, retain deny-only semantics and protect the target owner.
- Source `tier_points_config` is keyed by `tier`; native reference setup creates
  a UUID `_id` and queries by tier. Reconcile tier values and numeric caps before
  reuse; generic `_id <- id` would fail because source has no `id` column.
- Source `card_sale_hierarchy_snapshots` has a composite sale/ancestor key.
  Native indexes preserve the same pair; source also has unique sale/depth.
  Preserve the original frozen ancestry and depth. Current genealogy must not
  be used to fill missing historical rows.
- Source `points_ledger.id` and its self-reference `origin_award_id` are bigint.
  The current business mapper expects string IDs. Add a lossless identifier
  adapter, with matching reference conversion. Points quantities separately
  require safe-integer range validation; never turn a large ID into a JS Number.

Evidence: the metadata inventory, `organization.mongo.ts`,
`reference-catalog.mongo.ts`, `members.mongo.ts` and `sales.mongo.ts`.
These observations identify necessary adapters; they are not transformation
or reconciliation proof for real source rows.

## Complete table checklist

Scope: public/private base/partitioned tables plus auth.users and storage.objects/buckets. Other provider tables are outside scope. The earlier 125-table snapshot included broader platform metadata; the new count does not indicate missing application tables.

| Source | SQL primary key | Disposition and required review |
| --- | --- | --- |
| auth.users | NONE - explicit key adapter required | Identity adapter: tagged bcrypt and protected owner alias; never generic copy |
| private.business_id_aliases | id | Identifier allocator adapter; reserve IDs and reconcile collisions |
| private.commission_rule_archive | rule_id | Candidate commission_rule_archive; field/state/key parity NOT REVIEWED |
| private.company_customer_id_counters | issue_year | Identifier allocator adapter; reserve IDs and reconcile collisions |
| private.customer_external_import_receipts | source_id | Candidate customer_external_import_receipts; field/state/key parity NOT REVIEWED |
| private.customer_import_commission_policies | source_id | Candidate customer_import_commission_policies; field/state/key parity NOT REVIEWED |
| private.customer_import_payment_claims | id | Candidate customer_import_payment_claims; field/state/key parity NOT REVIEWED |
| private.customer_import_points_baselines | membership_id | Candidate customer_import_points_baselines; field/state/key parity NOT REVIEWED; bigint range/string adapter: confirmed_points |
| private.customer_import_purchase_sources | id | Candidate customer_import_purchase_sources; field/state/key parity NOT REVIEWED |
| private.customer_import_source_rows | row_id | Candidate customer_import_source_rows; field/state/key parity NOT REVIEWED |
| private.member_workbook_jobs | id | Candidate member_workbook_jobs; field/state/key parity NOT REVIEWED |
| private.member_workbook_rows | id | Candidate member_workbook_rows; field/state/key parity NOT REVIEWED; bigint range/string adapter: audit_id |
| private.mutation_requests | id | Exclude active replay state; historical provenance needs separate review |
| private.ost_accreditation_renewals | id | Candidate ost_accreditation_renewals; field/state/key parity NOT REVIEWED |
| private.ost_accreditation_terms | id | Candidate ost_accreditation_terms; field/state/key parity NOT REVIEWED |
| private.ost_applicant_changes | id | Candidate ost_applicant_changes; field/state/key parity NOT REVIEWED; bigint range/string adapter: id |
| private.ost_import_jobs | id | Candidate ost_import_jobs; field/state/key parity NOT REVIEWED |
| private.ost_import_rows | id | Candidate ost_import_rows; field/state/key parity NOT REVIEWED |
| private.ost_ist_conversions | id | Candidate ost_ist_conversions; field/state/key parity NOT REVIEWED |
| private.ost_registration_details | application_id | Candidate ost_registration_details; field/state/key parity NOT REVIEWED |
| private.ost_team_transfers | request_id | Candidate ost_team_transfers; field/state/key parity NOT REVIEWED |
| private.public_verification_settings | singleton | Candidate public_verification_settings; field/state/key parity NOT REVIEWED |
| private.purchase_document_evidence | id | Candidate purchase_document_evidence; field/state/key parity NOT REVIEWED |
| private.sale_team_aa_counters | accreditation_month | Identifier allocator adapter; reserve IDs and reconcile collisions |
| private.sale_team_accreditation_history | id | Candidate sale_team_accreditation_history; field/state/key parity NOT REVIEWED |
| private.sale_team_accreditations | staff_id | Candidate sale_team_accreditations; field/state/key parity NOT REVIEWED |
| private.sale_team_search_attempts | ip_hash | Retention/privacy review; do not restore old rate-limit state |
| private.sale_team_search_contacts | id | Retention/privacy review; no blind contact-data copy |
| private.sale_team_search_disclosures | ip_hash, request_id | Retention/privacy review of historical disclosure evidence |
| private.staff_security_policy | singleton | Policy adapter; must not restore MFA or overwrite native policy |
| private.vip_card_number_issuances | vip_card_number | Identifier allocator adapter; reserve IDs and reconcile collisions |
| public.audit_events | id | Candidate audit_events; field/state/key parity NOT REVIEWED; bigint range/string adapter: id |
| public.card_categories | id | Reference conflict adapter; never union grants or overwrite frozen terms |
| public.card_plans | id | Reference conflict adapter; never union grants or overwrite frozen terms |
| public.card_sale_hierarchy_snapshots | sale_id, ancestor_staff_id | Candidate card_sale_hierarchy_snapshots; field/state/key parity NOT REVIEWED |
| public.card_sales | id | Candidate card_sales; field/state/key parity NOT REVIEWED |
| public.cms_document_versions | id | Deferred CMS history; keep disabled; bigint range/string adapter: id |
| public.cms_documents | key | Deferred CMS history; keep disabled |
| public.cms_media_assets | id | Deferred CMS history; keep disabled; bigint range/string adapter: size_bytes |
| public.cms_page_sections | id | Deferred CMS history; keep disabled |
| public.cms_page_versions | id | Deferred CMS history; keep disabled; bigint range/string adapter: id |
| public.cms_pages | id | Deferred CMS history; keep disabled |
| public.commission_rules | id | Reference conflict adapter; never union grants or overwrite frozen terms |
| public.commissions | id | Candidate commissions; field/state/key parity NOT REVIEWED |
| public.customer_application_documents | id | Business metadata + private-file ownership adapter |
| public.customer_application_holders | id | Candidate customer_application_holders; field/state/key parity NOT REVIEWED |
| public.customer_application_purchase_terms | id | Candidate customer_application_purchase_terms; field/state/key parity NOT REVIEWED |
| public.customer_applications | id | Candidate customer_applications; field/state/key parity NOT REVIEWED; composite foreign-key adapter required |
| public.customer_import_jobs | id | Candidate customer_import_jobs; field/state/key parity NOT REVIEWED |
| public.customer_import_rows | id | Candidate customer_import_rows; field/state/key parity NOT REVIEWED |
| public.customer_onboarding_tokens | id | Exclude active credentials; review VIP activation reissue separately |
| public.customers | id | Candidate customers; field/state/key parity NOT REVIEWED |
| public.departments | id | Reference conflict adapter; never union grants or overwrite frozen terms |
| public.earning_claims | id | Disabled Services/Redemption history adapter; do not enable routes; bigint range/string adapter: points_requested, points_awarded, points_capped, points_per_unit_snapshot, max_award_snapshot |
| public.final_qualifications | id | Candidate final_qualifications; field/state/key parity NOT REVIEWED |
| public.identity_documents | id | Business metadata + private-file ownership adapter; bigint range/string adapter: size_bytes |
| public.memberships | id | Candidate memberships; field/state/key parity NOT REVIEWED; bigint range/string adapter: points_balance |
| public.modules | id | Reference conflict adapter; never union grants or overwrite frozen terms |
| public.network_member_profiles | staff_id | Protected owner/identity adapter; preserve existing credentials and assignments |
| public.ost_applications | id | Candidate ost_applications; field/state/key parity NOT REVIEWED |
| public.ost_members | id | Candidate ost_members; field/state/key parity NOT REVIEWED |
| public.payments | id | Candidate payments; field/state/key parity NOT REVIEWED; composite foreign-key adapter required |
| public.point_earning_rules | id | Disabled Services/Redemption history adapter; do not enable routes; bigint range/string adapter: points_amount, max_award |
| public.point_redemption_rules | id | Disabled Services/Redemption history adapter; do not enable routes; bigint range/string adapter: min_points, max_points |
| public.points_accounts | id | Candidate points_accounts; field/state/key parity NOT REVIEWED; bigint range/string adapter: balance, lifetime_allocated, lifetime_redeemed, reversal_debt, weekday_balance, weekend_balance |
| public.points_ledger | id | Candidate points_ledger; field/state/key parity NOT REVIEWED; bigint range/string adapter: id, amount, balance_after, balance_before, origin_award_id, weekday_delta, weekend_delta |
| public.points_periods | id | Candidate points_periods; field/state/key parity NOT REVIEWED; bigint range/string adapter: annual_points_cap, opening_balance, closing_balance |
| public.purchase_lines | id | Disabled Services/Redemption history adapter; do not enable routes |
| public.purchase_payments | id | Disabled Services/Redemption history adapter; do not enable routes |
| public.purchase_point_refunds | id | Disabled Services/Redemption history adapter; do not enable routes; bigint range/string adapter: points_restored, ledger_entry_id |
| public.purchases | id | Disabled Services/Redemption history adapter; do not enable routes |
| public.redemption_items | id | Disabled Services/Redemption history adapter; do not enable routes; bigint range/string adapter: points_cost |
| public.redemption_quotes | id | Disabled Services/Redemption history adapter; do not enable routes; bigint range/string adapter: points_requested, points_balance_snapshot, remaining_points_after, ledger_entry_id, weekday_points, weekend_points |
| public.redemptions | id | Disabled Services/Redemption history adapter; do not enable routes; bigint range/string adapter: points_cost_snapshot, total_points, balance_before_snapshot, balance_after_snapshot |
| public.referral_codes | id | Candidate referral_codes; field/state/key parity NOT REVIEWED |
| public.referral_relationships | id | Candidate referral_relationships; field/state/key parity NOT REVIEWED |
| public.reservation_agreement_documents | id | Business metadata + private-file ownership adapter |
| public.reservation_agreement_holders | id | Candidate reservation_agreement_holders; field/state/key parity NOT REVIEWED |
| public.reservation_agreement_schedule | id | Candidate reservation_agreement_schedule; field/state/key parity NOT REVIEWED |
| public.reservation_agreements | id | Candidate reservation_agreements; field/state/key parity NOT REVIEWED; composite foreign-key adapter required |
| public.role_permissions | role_id, module_id | Reference conflict adapter; never union grants or overwrite frozen terms |
| public.roles | id | Reference conflict adapter; never union grants or overwrite frozen terms |
| public.service_catalog | id | Disabled Services/Redemption history adapter; do not enable routes |
| public.service_refund_repayments | id | Disabled Services/Redemption history adapter; do not enable routes |
| public.service_refunds | id | Disabled Services/Redemption history adapter; do not enable routes; bigint range/string adapter: points_restored, earned_points_adjusted |
| public.service_tier_discounts | id | Disabled Services/Redemption history adapter; do not enable routes |
| public.staff_invitations | id | Exclude; no invitations |
| public.staff_permission_restrictions | staff_id, module_id | Protected owner/identity adapter; preserve existing credentials and assignments |
| public.staff_role_assignments | staff_id | Protected owner/identity adapter; preserve existing credentials and assignments |
| public.staff_users | id | Protected owner/identity adapter; preserve existing credentials and assignments |
| public.tier_points_config | tier | Reference conflict adapter; never union grants or overwrite frozen terms; bigint range/string adapter: annual_points_cap |
| storage.buckets | NONE - explicit key adapter required | Storage policy/configuration review; never auto-provision; bigint range/string adapter: file_size_limit |
| storage.objects | NONE - explicit key adapter required | Private-file adapter: bytes, checksum, ownership and native metadata |

Inventory SHA-256: `57b1e525f103306c5df93684b912277a5b43ed0e4dfab33d76717f3483a46b07`.

Before apply: review every native adapter, identity alias, partial unique rule, exact money, bigint points and timestamp representation. Reconcile counts, immutable snapshots, verified settlement, commissions, weekday/weekend points and private-file checksums. No generic copy-all or live importer is enabled.
