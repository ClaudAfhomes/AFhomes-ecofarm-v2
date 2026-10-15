-- AF Homes Ecofarm — Current Database Schema Snapshot
-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.
-- Last updated: 2026-10-15 (UTC)
-- Source: supabase/migrations (77 files, sorted A-Z = apply order).
-- Authoritative DDL lives in supabase/migrations/*.sql — read the defining file
-- listed per table below for the full column list. This file is an index only
-- (table inventory + migration manifest) so it cannot drift from the migrations.
-- Update workflow: say "update schema" to regenerate this index from supabase/migrations.
-- This file is never read by pnpm db:migrate and never applied to any database.
--
-- AGENT DIRECTIVE — AUTO-UPDATE ON TRIGGER (read this when this file is attached):
-- Trigger phrases (any of these require a full refresh of THIS file):
--   "update schema"
--   "update schema @docs/supabase/CURRENT-SCHEMA.sql"
-- On trigger, the agent MUST do all of the following before replying:
--   1. VERIFY MIGRATIONS: list + read every file in supabase/migrations/ sorted
--      A-Z (this is apply order). Confirm the count and filenames for Section 1.
--      Fail closed if any file does not start with a valid afhomes_ prefix or
--      breaks the one-idempotent-migration-per-change rule.
--   2. VERIFY RELATED DB FILES: read supabase/security/rls_invariants.sql,
--      supabase/apply-migrations.ts, supabase/db-testing/supabase-shim.sql,
--      and any supabase/*-integration.ts / supabase/db-integration.ts present.
--      Note any new tables, RLS policies, SECURITY DEFINER functions, storage
--      buckets, or column-grant changes they introduce.
--   3. RE-SCAN TABLES: grep `create table` (case-insensitive) across all
--      supabase/migrations/*.sql. Record `table <= first-defined-in file`
--      (first win). Then grep `alter table ... add column` deltas for the
--      NOTES section when a referenced delta exists.
--   4. REWRITE THIS FILE: update `Last updated` (UTC date), the file count in
--      the Source line + Section 1 title, the full Section 1 manifest, the full
--      Section 2 inventory, and the Section 3 delta notes. Never paste full
--      DDL bodies here — index only, full DDL stays in the migration files.
--   5. REPORT: reply with file count + table count + which migrations/tables
--      were added/removed since the previous snapshot, or "no changes".

-- ============================================================================
-- 1. MIGRATION MANIFEST (77 files)
-- ============================================================================
-- 20260926023325_afhomes_phase1_foundation.sql
-- 20260926025313_afhomes_phase1_advisor_indexes.sql
-- 20260927000001_afhomes_phase2_business_foundation.sql
-- 20260927000002_afhomes_phase2_rls.sql
-- 20260927000003_afhomes_phase2_rpc.sql
-- 20260927000004_afhomes_phase2_support_functions.sql
-- 20260927000005_afhomes_phase3_customer_portal.sql
-- 20260928000001_afhomes_phase4_redemption.sql
-- 20260929000001_afhomes_phase5_reconcile_phase2_fixes.sql
-- 20260930000001_afhomes_role_permission_baseline.sql
-- 20261001000001_afhomes_phase6_cms_foundation.sql
-- 20261002000001_afhomes_phase7_genealogy.sql
-- 20261003000001_afhomes_phase8_ost_registration.sql
-- 20261004000001_afhomes_phase10_card_management.sql
-- 20261005000001_afhomes_phase12_identity_ocr.sql
-- 20261010000001_afhomes_phase14_analytics.sql
-- 20261011000001_afhomes_phase17_function_search_path_hardening.sql
-- 20261012000001_afhomes_preview_qa_sale_hierarchy.sql
-- 20261013000001_afhomes_phase19_card_plan_description.sql
-- 20261014000001_afhomes_vip_payment_schemes.sql
-- 20261015000001_afhomes_phase20_staff_password_lifecycle.sql
-- 20261016000001_afhomes_onboarding_token_pgcrypto_path.sql
-- 20261017000001_afhomes_card_plan_order.sql
-- 20261018000001_afhomes_official_vip_benefits.sql
-- 20261018000002_afhomes_flexible_commission_rules.sql
-- 20261018000003_afhomes_official_forms.sql
-- 20261019000001_afhomes_fix_customer_application_plan_field.sql
-- 20261019000002_afhomes_customer_import_jobs.sql
-- 20261019000003_afhomes_private_trigger_execute_grants.sql
-- 20261020000001_afhomes_customer_directory_private_privileges.sql
-- 20261021000001_afhomes_random_membership_number_allocator.sql
-- 20261022000001_afhomes_mutation_idempotency.sql
-- 20261023000001_afhomes_ost_accreditation_workflow.sql
-- 20261025000001_afhomes_business_ids.sql
-- 20261026000001_afhomes_customer_code.sql
-- 20261027000001_afhomes_legacy_business_id_upgrade.sql
-- 20261028000001_afhomes_membership_code_upgrade.sql
-- 20261029000001_afhomes_operational_access_functions.sql
-- 20261030000001_afhomes_customer_directory_id_filter.sql
-- 20261031000001_afhomes_customer_directory_payment_filter.sql
-- 20261101000001_afhomes_application_purchase_flow.sql
-- 20261102000001_afhomes_customer_directory_workflow_filter.sql
-- 20261103000001_afhomes_application_psgc_address.sql
-- 20261104000001_afhomes_points_rebuild.sql
-- 20261105000001_afhomes_service_tier_discounts.sql
-- 20261106000001_afhomes_operational_service_payments.sql
-- 20261107000001_afhomes_operational_sale_idempotency.sql
-- 20261108000001_afhomes_retire_points_spending.sql
-- 20261109000001_afhomes_claim_rpc_authorization.sql
-- 20261110000001_afhomes_claim_lifecycle_repair.sql
-- 20261111000000_afhomes_service_publication.sql
-- 20261111000001_afhomes_server_service_prices.sql
-- 20261112000001_afhomes_service_policy_status.sql
-- 20261112000002_afhomes_service_photo_management.sql
-- 20261113000001_afhomes_service_staycation_eligibility.sql
-- 20261114000001_afhomes_restore_points_spending.sql
-- 20261115000001_afhomes_commit_keeps_tier_discount.sql
-- 20261115000002_afhomes_fix_customer_points_position.sql
-- 20261116000001_afhomes_promotion_stacking.sql
-- 20261116000002_afhomes_sale_tier_choice.sql
-- 20261117000001_afhomes_customer_redemption_approval.sql
-- 20261118000001_afhomes_reserved_point_settlement.sql
-- 20261119000001_afhomes_point_refund_compensation.sql
-- 20261120000001_afhomes_refund_earning_consistency.sql
-- 20261121000001_afhomes_external_service_refunds.sql
-- 20261122000001_afhomes_readonly_auth_recovery.sql
-- 20261123000001_afhomes_preserve_legacy_points.sql
-- 20261124000001_afhomes_points_position_service_acl.sql
-- 20261125000001_afhomes_preview_caller_wrappers.sql
-- 20261127000001_afhomes_catalog_policy_management.sql
-- 20261128000002_afhomes_self_search_path_hardening.sql
-- 20261129000001_afhomes_document_scope_security.sql
-- 20261129000002_afhomes_staff_business_security.sql
-- 20261130000001_afhomes_membership_company_fields.sql
-- 20261131000001_afhomes_application_referral_chain.sql
-- 20261131000002_afhomes_application_referral_staff.sql
-- 20261131000003_afhomes_customer_lookup_module.sql

-- ============================================================================
-- 2. TABLE INVENTORY (68 tables: table <= first-defined-in migration)
-- Later migrations may ALTER these tables (add columns, tighten CHECKs, add
-- RLS/policies/indexes). Read the defining file for base DDL, then grep later
-- files for `alter table <name>` for the delta.
-- ============================================================================
-- private.business_id_aliases <= 20261027000001_afhomes_legacy_business_id_upgrade.sql
-- private.mutation_requests <= 20261022000001_afhomes_mutation_idempotency.sql
-- private.ost_accreditation_renewals <= 20261023000001_afhomes_ost_accreditation_workflow.sql
-- private.ost_accreditation_terms <= 20261023000001_afhomes_ost_accreditation_workflow.sql
-- private.ost_import_jobs <= 20261023000001_afhomes_ost_accreditation_workflow.sql
-- private.ost_import_rows <= 20261023000001_afhomes_ost_accreditation_workflow.sql
-- private.ost_registration_details <= 20261023000001_afhomes_ost_accreditation_workflow.sql
-- private.purchase_document_evidence <= 20261101000001_afhomes_application_purchase_flow.sql
-- private.staff_security_policy <= 20261129000002_afhomes_staff_business_security.sql
-- public.audit_events <= 20260926023325_afhomes_phase1_foundation.sql
-- public.card_categories <= 20260926023325_afhomes_phase1_foundation.sql
-- public.card_plans <= 20260926023325_afhomes_phase1_foundation.sql
-- public.card_sale_hierarchy_snapshots <= 20261010000001_afhomes_phase14_analytics.sql
-- public.card_sales <= 20260926023325_afhomes_phase1_foundation.sql
-- public.cms_document_versions <= 20261001000001_afhomes_phase6_cms_foundation.sql
-- public.cms_documents <= 20261001000001_afhomes_phase6_cms_foundation.sql
-- public.cms_media_assets <= 20261001000001_afhomes_phase6_cms_foundation.sql
-- public.cms_page_sections <= 20261001000001_afhomes_phase6_cms_foundation.sql
-- public.cms_page_versions <= 20261001000001_afhomes_phase6_cms_foundation.sql
-- public.cms_pages <= 20261001000001_afhomes_phase6_cms_foundation.sql
-- public.commission_rules <= 20261018000002_afhomes_flexible_commission_rules.sql
-- public.commissions <= 20260926023325_afhomes_phase1_foundation.sql
-- public.customer_application_documents <= 20261018000003_afhomes_official_forms.sql
-- public.customer_application_holders <= 20261018000003_afhomes_official_forms.sql
-- public.customer_application_purchase_terms <= 20261101000001_afhomes_application_purchase_flow.sql
-- public.customer_applications <= 20261018000003_afhomes_official_forms.sql
-- public.customer_import_jobs <= 20261019000002_afhomes_customer_import_jobs.sql
-- public.customer_import_rows <= 20261019000002_afhomes_customer_import_jobs.sql
-- public.customer_onboarding_tokens <= 20260927000001_afhomes_phase2_business_foundation.sql
-- public.customers <= 20260926023325_afhomes_phase1_foundation.sql
-- public.departments <= 20260926023325_afhomes_phase1_foundation.sql
-- public.earning_claims <= 20261104000001_afhomes_points_rebuild.sql
-- public.final_qualifications <= 20260926023325_afhomes_phase1_foundation.sql
-- public.identity_documents <= 20260926023325_afhomes_phase1_foundation.sql
-- public.memberships <= 20260926023325_afhomes_phase1_foundation.sql
-- public.modules <= 20260926023325_afhomes_phase1_foundation.sql
-- public.ost_applications <= 20260926023325_afhomes_phase1_foundation.sql
-- public.ost_members <= 20260926023325_afhomes_phase1_foundation.sql
-- public.payments <= 20260926023325_afhomes_phase1_foundation.sql
-- public.point_earning_rules <= 20261104000001_afhomes_points_rebuild.sql
-- public.point_redemption_rules <= 20261104000001_afhomes_points_rebuild.sql
-- public.points_accounts <= 20260927000001_afhomes_phase2_business_foundation.sql
-- public.points_ledger <= 20260927000001_afhomes_phase2_business_foundation.sql
-- public.points_periods <= 20261104000001_afhomes_points_rebuild.sql
-- public.purchase_lines <= 20261104000001_afhomes_points_rebuild.sql
-- public.purchase_payments <= 20261104000001_afhomes_points_rebuild.sql
-- public.purchase_point_refunds <= 20261119000001_afhomes_point_refund_compensation.sql
-- public.purchases <= 20261104000001_afhomes_points_rebuild.sql
-- public.redemption_items <= 20260928000001_afhomes_phase4_redemption.sql
-- public.redemption_quotes <= 20261104000001_afhomes_points_rebuild.sql
-- public.redemptions <= 20260928000001_afhomes_phase4_redemption.sql
-- public.referral_codes <= 20260926023325_afhomes_phase1_foundation.sql
-- public.referral_relationships <= 20260927000001_afhomes_phase2_business_foundation.sql
-- public.reservation_agreement_documents <= 20261018000003_afhomes_official_forms.sql
-- public.reservation_agreement_holders <= 20261018000003_afhomes_official_forms.sql
-- public.reservation_agreement_schedule <= 20261018000003_afhomes_official_forms.sql
-- public.reservation_agreements <= 20261018000003_afhomes_official_forms.sql
-- public.role_permissions <= 20260926023325_afhomes_phase1_foundation.sql
-- public.roles <= 20260926023325_afhomes_phase1_foundation.sql
-- public.service_catalog <= 20261104000001_afhomes_points_rebuild.sql
-- public.service_refund_repayments <= 20261121000001_afhomes_external_service_refunds.sql
-- public.service_refunds <= 20261121000001_afhomes_external_service_refunds.sql
-- public.service_tier_discounts <= 20261105000001_afhomes_service_tier_discounts.sql
-- public.staff_invitations <= 20260926023325_afhomes_phase1_foundation.sql
-- public.staff_permission_restrictions <= 20260926023325_afhomes_phase1_foundation.sql
-- public.staff_role_assignments <= 20260926023325_afhomes_phase1_foundation.sql
-- public.staff_users <= 20260926023325_afhomes_phase1_foundation.sql
-- public.tier_points_config <= 20261104000001_afhomes_points_rebuild.sql

-- ============================================================================
-- 3. NOTES
-- ============================================================================
-- * Supersedes the 2026-10-14 user-pasted snapshot (59 public tables, context
--   only, already drifted: no private.* tables, no membership_company_fields,
--   no referral_chain/staff columns, no customer_lookup module row).
-- * Deltas since that snapshot live in the migrations above — e.g.
--   20261130000001 membership_company_fields, 20261131000001/2 application
--   referral chain + staff, 20261131000003 customer_lookup module.
-- * Generation: `node -e` scan of `create table` across supabase/migrations,
--   first-defined-in wins. Re-run on "update schema".


## Table `departments`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `code` | `text` |  Unique |
| `name` | `text` |  Unique |
| `is_active` | `bool` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `roles`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `slug` | `text` |  Unique |
| `name` | `text` |  |
| `description` | `text` |  Nullable |
| `is_system` | `bool` |  |
| `is_active` | `bool` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `modules`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `key` | `text` |  Unique |
| `name` | `text` |  |
| `group_name` | `text` |  |
| `sort_order` | `int4` |  |
| `is_active` | `bool` |  |

## Table `role_permissions`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `role_id` | `uuid` | Primary |
| `module_id` | `uuid` | Primary |
| `can_view` | `bool` |  |
| `can_create` | `bool` |  |
| `can_update` | `bool` |  |
| `can_delete` | `bool` |  |

## Table `staff_users`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `email` | `text` |  Unique |
| `full_name` | `text` |  |
| `department_id` | `uuid` |  Nullable |
| `status` | `text` |  |
| `invited_at` | `timestamptz` |  Nullable |
| `activated_at` | `timestamptz` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `must_change_password` | `bool` |  |
| `password_changed_at` | `timestamptz` |  Nullable |
| `employee_number` | `text` |  Unique |
| `sales_number` | `text` |  Nullable Unique |

## Table `staff_role_assignments`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `staff_id` | `uuid` | Primary |
| `role_id` | `uuid` |  |
| `assigned_by` | `uuid` |  Nullable |
| `assigned_at` | `timestamptz` |  |

## Table `staff_permission_restrictions`

Deny-only overrides; they can never add permissions beyond the assigned role.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `staff_id` | `uuid` | Primary |
| `module_id` | `uuid` | Primary |
| `deny_view` | `bool` |  |
| `deny_create` | `bool` |  |
| `deny_update` | `bool` |  |
| `deny_delete` | `bool` |  |

## Table `staff_invitations`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `email` | `text` |  |
| `full_name` | `text` |  |
| `role_id` | `uuid` |  |
| `department_id` | `uuid` |  Nullable |
| `status` | `text` |  |
| `invited_by` | `uuid` |  |
| `expires_at` | `timestamptz` |  |
| `auth_user_id` | `uuid` |  Nullable Unique |
| `created_at` | `timestamptz` |  |
| `accepted_at` | `timestamptz` |  Nullable |

## Table `referral_codes`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `code_hash` | `text` |  Unique |
| `code_hint` | `text` |  |
| `sponsor_staff_id` | `uuid` |  |
| `expires_at` | `timestamptz` |  |
| `max_uses` | `int4` |  |
| `use_count` | `int4` |  |
| `is_active` | `bool` |  |
| `created_by` | `uuid` |  |
| `created_at` | `timestamptz` |  |

## Table `ost_applications`

Phase 8: sponsor is frozen from the referral code at submission and never edited. Corrections use the audited upline path after activation.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `referral_code_id` | `uuid` |  |
| `sponsor_staff_id` | `uuid` |  |
| `email` | `text` |  |
| `phone` | `text` |  |
| `first_name` | `text` |  |
| `middle_name` | `text` |  Nullable |
| `last_name` | `text` |  |
| `birth_date` | `date` |  |
| `address` | `jsonb` |  |
| `registration_details` | `jsonb` |  |
| `status` | `text` |  |
| `review_notes` | `text` |  Nullable |
| `reviewed_by` | `uuid` |  Nullable |
| `submitted_at` | `timestamptz` |  |
| `reviewed_at` | `timestamptz` |  Nullable |

## Table `ost_members`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `application_id` | `uuid` |  Unique |
| `sponsor_staff_id` | `uuid` |  |
| `ost_number` | `text` |  Unique |
| `full_name` | `text` |  |
| `email` | `text` |  Unique |
| `phone` | `text` |  |
| `status` | `text` |  |
| `approved_by` | `uuid` |  |
| `approved_at` | `timestamptz` |  |
| `created_at` | `timestamptz` |  |

## Table `card_categories`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `slug` | `text` |  Unique |
| `name` | `text` |  Unique |
| `description` | `text` |  Nullable |
| `is_active` | `bool` |  |
| `sort_order` | `int4` |  |

## Table `card_plans`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `category_id` | `uuid` |  |
| `code` | `text` |  Unique |
| `name` | `text` |  |
| `cash_price` | `text` |  |
| `minimum_down_payment` | `text` |  |
| `yearly_points` | `int4` |  |
| `commission_rate` | `text` |  |
| `is_active` | `bool` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `sort_order` | `int4` |  |
| `installment_price` | `text` |  |
| `reservation_fee` | `text` |  |
| `spot_cash_days` | `int4` |  |
| `standard_installment_months` | `int4` |  |
| `validity_years` | `int4` |  |
| `move_a_enabled` | `bool` |  |
| `move_b1_enabled` | `bool` |  |
| `move_b2_enabled` | `bool` |  |
| `discount_percent` | `int4` |  |
| `base_validity_years` | `int4` |  |
| `validity_extension_years` | `int4` |  |
| `cardholder_limit` | `int4` |  |
| `annual_points_tranches` | `int4` |  |
| `total_loyalty_value` | `text` |  |
| `priority_reservation` | `bool` |  |
| `no_monthly_annual_dues` | `bool` |  |
| `description` | `text` |  Nullable |

## Table `customers`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `auth_user_id` | `uuid` |  Nullable Unique |
| `customer_number` | `text` |  Unique |
| `email` | `text` |  |
| `phone` | `text` |  |
| `first_name` | `text` |  |
| `middle_name` | `text` |  Nullable |
| `last_name` | `text` |  |
| `birth_date` | `date` |  Nullable |
| `address` | `jsonb` |  |
| `status` | `text` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `suffix` | `text` |  Nullable |
| `gender` | `text` |  Nullable |
| `government_id_type` | `text` |  Nullable |
| `government_id_number` | `text` |  Nullable |
| `registration_source` | `text` |  |
| `created_by` | `uuid` |  Nullable |
| `referred_by_staff_id` | `uuid` |  Nullable |
| `referral_code_used` | `text` |  Nullable |
| `notes` | `text` |  Nullable |
| `customer_code` | `text` |  Unique |
| `ra_number` | `text` |  Nullable |
| `company_status` | `text` |  Nullable |
| `citizenship` | `text` |  Nullable |
| `civil_status` | `text` |  Nullable |
| `tin_number` | `text` |  Nullable |
| `occupation_business_name` | `text` |  Nullable |
| `office_business_address` | `text` |  Nullable |
| `employed_position` | `text` |  Nullable |
| `supplementary_full_name` | `text` |  Nullable |
| `supplementary_address` | `text` |  Nullable |
| `supplementary_birthday` | `date` |  Nullable |
| `supplementary_gender` | `text` |  Nullable |
| `supplementary_citizenship` | `text` |  Nullable |
| `supplementary_civil_status` | `text` |  Nullable |
| `supplementary_tin_number` | `text` |  Nullable |
| `supplementary_mobile` | `text` |  Nullable |
| `supplementary_email` | `text` |  Nullable |
| `supplementary_occupation_business_name` | `text` |  Nullable |
| `supplementary_office_address` | `text` |  Nullable |
| `supplementary_position` | `text` |  Nullable |
| `ost_ist_name` | `text` |  Nullable |
| `svd_name` | `text` |  Nullable |
| `ssm_name` | `text` |  Nullable |
| `sm_name` | `text` |  Nullable |
| `referrer_name` | `text` |  Nullable |
| `vip_recommender_name` | `text` |  Nullable |
| `related_contact_no` | `text` |  Nullable |
| `related_email` | `text` |  Nullable |
| `stated_vip_package` | `text` |  Nullable |
| `stated_payment_terms` | `text` |  Nullable |
| `stated_regular_price` | `text` |  Nullable |
| `stated_discount` | `text` |  Nullable |
| `stated_total_amount` | `text` |  Nullable |
| `stated_rf` | `text` |  Nullable |
| `stated_payment_type` | `text` |  Nullable |
| `stated_ref_no` | `text` |  Nullable |
| `stated_payment_date` | `date` |  Nullable |

## Table `identity_documents`

Private metadata only. Object delivery must use short-lived signed URLs from an authorized server API.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `subject_type` | `text` |  |
| `ost_application_id` | `uuid` |  Nullable |
| `customer_id` | `uuid` |  Nullable |
| `storage_path` | `text` |  Unique |
| `original_filename` | `text` |  |
| `mime_type` | `text` |  |
| `size_bytes` | `int8` |  |
| `sha256` | `text` |  |
| `extracted_data` | `jsonb` |  |
| `reviewed_data` | `jsonb` |  |
| `reviewed_by` | `uuid` |  Nullable |
| `reviewed_at` | `timestamptz` |  Nullable |
| `created_at` | `timestamptz` |  |
| `uploaded_by` | `uuid` |  Nullable |
| `ocr_status` | `text` |  |
| `ocr_provider` | `text` |  Nullable |
| `verification_status` | `text` |  |

## Table `card_sales`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `sale_number` | `text` |  Unique |
| `customer_id` | `uuid` |  |
| `plan_id` | `uuid` |  |
| `seller_type` | `text` |  |
| `seller_staff_id` | `uuid` |  Nullable |
| `seller_ost_id` | `uuid` |  Nullable |
| `cash_price` | `text` |  |
| `balance_due_at` | `timestamptz` |  |
| `status` | `text` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `cash_price_snapshot` | `text` |  Nullable |
| `minimum_down_payment_snapshot` | `text` |  Nullable |
| `yearly_points_snapshot` | `int4` |  Nullable |
| `commission_rate_snapshot` | `text` |  Nullable |
| `expected_commission_snapshot` | `text` |  Nullable |
| `submitted_at` | `timestamptz` |  Nullable |
| `payment_verified_at` | `timestamptz` |  Nullable |
| `fully_paid_at` | `timestamptz` |  Nullable |
| `activated_at` | `timestamptz` |  Nullable |
| `cancelled_at` | `timestamptz` |  Nullable |
| `cancellation_reason` | `text` |  Nullable |
| `spot_cash_started_at` | `timestamptz` |  Nullable |
| `spot_cash_deadline` | `timestamptz` |  Nullable |
| `referral_relationship_id` | `uuid` |  Nullable |
| `created_by` | `uuid` |  Nullable |
| `payment_scheme` | `text` |  |
| `reservation_fee_snapshot` | `text` |  |
| `required_initial_snapshot` | `text` |  |
| `installment_months_snapshot` | `int4` |  Nullable |
| `monthly_amount_snapshot` | `text` |  Nullable |
| `validity_months_snapshot` | `int4` |  Nullable |
| `commission_rule_id` | `uuid` |  Nullable |
| `commission_base_snapshot` | `text` |  Nullable |
| `origin` | `text` |  |
| `import_job_id` | `uuid` |  Nullable |
| `import_row_id` | `uuid` |  Nullable |

## Table `payments`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `sale_id` | `uuid` |  Nullable |
| `amount` | `text` |  |
| `method` | `text` |  |
| `reference` | `text` |  Nullable |
| `status` | `text` |  |
| `recorded_by` | `uuid` |  |
| `verified_by` | `uuid` |  Nullable |
| `recorded_at` | `timestamptz` |  |
| `verified_at` | `timestamptz` |  Nullable |
| `payment_type` | `text` |  |
| `customer_id` | `uuid` |  Nullable |
| `notes` | `text` |  Nullable |
| `rejection_reason` | `text` |  Nullable |
| `voided_at` | `timestamptz` |  Nullable |
| `receipt_storage_path` | `text` |  Nullable |
| `payment_number` | `text` |  Unique |
| `origin` | `text` |  |
| `reservation_id` | `uuid` |  Nullable |

## Table `final_qualifications`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `sale_id` | `uuid` |  Unique |
| `status` | `text` |  |
| `notes` | `text` |  Nullable |
| `reviewed_by` | `uuid` |  Nullable |
| `reviewed_at` | `timestamptz` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `memberships`

One row per activated sale. qr_token_hash and fallback_code_hash are two identifiers for the SAME membership; neither authorizes anything on its own - every use must resolve the row server-side and re-check status, permission and balance.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `customer_id` | `uuid` |  Unique |
| `sale_id` | `uuid` |  Unique |
| `membership_number` | `text` |  Unique |
| `fallback_code_hash` | `text` |  Unique |
| `status` | `text` |  |
| `points_balance` | `int8` |  |
| `activated_by` | `uuid` |  |
| `activated_at` | `timestamptz` |  |
| `expires_at` | `timestamptz` |  |
| `product_id` | `uuid` |  Nullable |
| `sale_status_at_activation` | `text` |  Nullable |
| `yearly_points_allocated` | `int4` |  |
| `qr_token_hash` | `text` |  Nullable Unique |
| `renewal_due_at` | `timestamptz` |  Nullable |
| `issued_at` | `timestamptz` |  |
| `card_issued_at` | `timestamptz` |  Nullable |
| `card_issued_by` | `uuid` |  Nullable |
| `last_printed_at` | `timestamptz` |  Nullable |
| `print_count` | `int4` |  |
| `points_anniversary` | `date` |  Nullable |

## Table `commissions`

Single-level sale commission (4%). earned_at is set only by an explicit qualification decision; it is never advanced automatically.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `sale_id` | `uuid` |  Unique |
| `ost_id` | `uuid` |  Nullable |
| `amount` | `text` |  |
| `status` | `text` |  |
| `earned_at` | `timestamptz` |  Nullable |
| `paid_at` | `timestamptz` |  Nullable |
| `created_at` | `timestamptz` |  |
| `beneficiary_type` | `text` |  |
| `beneficiary_staff_id` | `uuid` |  Nullable |
| `beneficiary_ost_id` | `uuid` |  Nullable |
| `rate_snapshot` | `text` |  Nullable |
| `basis_amount_snapshot` | `text` |  Nullable |
| `qualified_at` | `timestamptz` |  Nullable |
| `qualified_by` | `uuid` |  Nullable |
| `qualification_notes` | `text` |  Nullable |
| `cancelled_at` | `timestamptz` |  Nullable |
| `cancellation_reason` | `text` |  Nullable |
| `paid_by` | `uuid` |  Nullable |
| `paid_reference` | `text` |  Nullable |
| `commission_rule_id` | `uuid` |  Nullable |
| `commission_number` | `text` |  Unique |

## Table `audit_events`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary Identity |
| `actor_id` | `uuid` |  Nullable |
| `action` | `text` |  |
| `entity_type` | `text` |  |
| `entity_id` | `text` |  Nullable |
| `reason` | `text` |  Nullable |
| `before_data` | `jsonb` |  Nullable |
| `after_data` | `jsonb` |  Nullable |
| `request_id` | `text` |  Nullable |
| `ip_hash` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `referral_relationships`

PHASE 7 authoritative immediate-upline history. Active edges enforce VD to SSM to SM to OST; corrections retire rows so historical sales remain frozen.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `subject_staff_id` | `uuid` |  |
| `upline_staff_id` | `uuid` |  |
| `hierarchy_role` | `text` |  |
| `is_authoritative` | `bool` |  |
| `is_active` | `bool` |  |
| `assigned_by` | `uuid` |  Nullable |
| `assigned_at` | `timestamptz` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `points_accounts`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `membership_id` | `uuid` |  Unique |
| `balance` | `int8` |  |
| `lifetime_allocated` | `int8` |  |
| `lifetime_redeemed` | `int8` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `reversal_debt` | `int8` |  |

## Table `points_ledger`

Append-only points history. A reversal is a NEW compensating row, never an update or delete. The binding invariant is: points_accounts.balance - points_accounts.reversal_debt = sum(points_ledger.amount).

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary Identity |
| `account_id` | `uuid` |  |
| `entry_type` | `text` |  |
| `amount` | `int8` |  |
| `balance_after` | `int8` |  |
| `reference_type` | `text` |  Nullable |
| `reference_id` | `text` |  Nullable |
| `actor_id` | `uuid` |  Nullable |
| `reason` | `text` |  Nullable |
| `metadata` | `jsonb` |  |
| `created_at` | `timestamptz` |  |
| `balance_before` | `int8` |  Nullable |
| `counts_toward_cap` | `bool` |  |
| `origin_award_id` | `int8` |  Nullable |
| `origin_period_id` | `uuid` |  Nullable |

## Table `customer_onboarding_tokens`

Hashed, single-use, expiring onboarding tokens. Issue only; redemption happens in the Customer Portal phase.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `customer_id` | `uuid` |  |
| `membership_id` | `uuid` |  Nullable |
| `token_hash` | `text` |  Unique |
| `purpose` | `text` |  |
| `expires_at` | `timestamptz` |  |
| `consumed_at` | `timestamptz` |  Nullable |
| `consumed_by` | `uuid` |  Nullable |
| `created_by` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `redemption_items`

Redeemable AF Homes items and services, priced in whole points. Deactivated, never deleted, so historical redemptions always keep a resolvable item. No image column: nothing needs one yet and an unused nullable column is an invitation to store customer-adjacent binaries.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `code` | `text` |  Unique |
| `name` | `text` |  |
| `description` | `text` |  Nullable |
| `category` | `text` |  |
| `points_cost` | `int8` |  |
| `is_active` | `bool` |  |
| `sort_order` | `int4` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `redemptions`

Points redemption transactions. Item name, code and price are snapshotted, so later catalog edits cannot alter history. Void columns are schema-only: no handler writes them because the void authorization and accounting rule is an unresolved business decision. No browser role holds any privilege on this table - staff read it through the API, and a customer reads their own history through their points ledger.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `redemption_number` | `text` |  Unique |
| `membership_id` | `uuid` |  |
| `customer_id` | `uuid` |  |
| `points_account_id` | `uuid` |  |
| `redemption_item_id` | `uuid` |  |
| `item_code_snapshot` | `text` |  |
| `item_name_snapshot` | `text` |  |
| `points_cost_snapshot` | `int8` |  |
| `quantity` | `int4` |  |
| `total_points` | `int8` |  |
| `balance_before_snapshot` | `int8` |  |
| `balance_after_snapshot` | `int8` |  |
| `redeemed_by` | `uuid` |  |
| `redeemed_by_name` | `text` |  |
| `status` | `text` |  |
| `created_at` | `timestamptz` |  |
| `completed_at` | `timestamptz` |  |
| `voided_at` | `timestamptz` |  Nullable |
| `voided_by` | `uuid` |  Nullable |
| `void_reason` | `text` |  Nullable |
| `idempotency_key` | `text` |  Nullable |

## Table `cms_documents`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `key` | `text` | Primary |
| `draft_value` | `jsonb` |  |
| `published_value` | `jsonb` |  Nullable |
| `status` | `text` |  |
| `version` | `int4` |  |
| `created_by` | `uuid` |  |
| `updated_by` | `uuid` |  |
| `published_by` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `published_at` | `timestamptz` |  Nullable |

## Table `cms_document_versions`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary Identity |
| `document_key` | `text` |  |
| `value` | `jsonb` |  |
| `version` | `int4` |  |
| `action` | `text` |  |
| `change_summary` | `text` |  |
| `created_by` | `uuid` |  |
| `created_at` | `timestamptz` |  |

## Table `cms_pages`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `slug` | `text` |  Unique |
| `title` | `text` |  |
| `status` | `text` |  |
| `seo` | `jsonb` |  |
| `published_snapshot` | `jsonb` |  Nullable |
| `version` | `int4` |  |
| `created_by` | `uuid` |  |
| `updated_by` | `uuid` |  |
| `published_by` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `published_at` | `timestamptz` |  Nullable |

## Table `cms_page_sections`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `page_id` | `uuid` |  |
| `block_type` | `text` |  |
| `content` | `jsonb` |  |
| `sort_order` | `int4` |  |
| `is_visible` | `bool` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `cms_page_versions`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary Identity |
| `page_id` | `uuid` |  |
| `slug` | `text` |  |
| `title` | `text` |  |
| `status` | `text` |  |
| `seo` | `jsonb` |  |
| `sections` | `jsonb` |  |
| `version` | `int4` |  |
| `action` | `text` |  |
| `change_summary` | `text` |  |
| `created_by` | `uuid` |  |
| `created_at` | `timestamptz` |  |

## Table `cms_media_assets`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `storage_path` | `text` |  Unique |
| `public_url` | `text` |  |
| `name` | `text` |  |
| `mime_type` | `text` |  |
| `media_type` | `text` |  |
| `alt_text` | `text` |  |
| `category` | `text` |  |
| `size_bytes` | `int8` |  |
| `created_by` | `uuid` |  |
| `created_at` | `timestamptz` |  |

## Table `card_sale_hierarchy_snapshots`

Immutable complete seller ancestry captured when a sale is created. No legacy backfill: an absent complete snapshot is historically unattributed for team analytics.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `sale_id` | `uuid` | Primary |
| `ancestor_staff_id` | `uuid` | Primary |
| `ancestor_role` | `text` |  |
| `depth` | `int2` |  |
| `captured_at` | `timestamptz` |  |

## Table `commission_rules`

Prospective single-level rates. Rules never stack and never rewrite frozen commission history.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `target_type` | `text` |  |
| `target_id` | `uuid` |  |
| `rate` | `text` |  |
| `effective_from` | `date` |  |
| `effective_until` | `date` |  Nullable |
| `accredited_on_or_after` | `date` |  Nullable |
| `is_active` | `bool` |  |
| `created_by` | `uuid` |  |
| `updated_by` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `target_role_id` | `uuid` |  Nullable |
| `target_staff_id` | `uuid` |  Nullable |
| `target_ost_id` | `uuid` |  Nullable |

## Table `customer_applications`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `application_number` | `text` |  Unique |
| `customer_id` | `uuid` |  |
| `sale_id` | `uuid` |  Nullable Unique |
| `plan_id` | `uuid` |  |
| `tier_snapshot` | `text` |  |
| `payment_scheme_snapshot` | `text` |  |
| `vip_amount_snapshot` | `text` |  |
| `discount_percent_snapshot` | `int4` |  |
| `validity_years_snapshot` | `int4` |  |
| `yearly_points_snapshot` | `int4` |  |
| `annual_points_tranches_snapshot` | `int4` |  |
| `holder_limit_snapshot` | `int4` |  |
| `sales_manager_name` | `text` |  Nullable |
| `vip_recommender_name` | `text` |  Nullable |
| `recommender_contact` | `text` |  Nullable |
| `recommender_email` | `text` |  Nullable |
| `vip_referrer` | `text` |  Nullable |
| `acquisition_channels` | `_text` |  |
| `consent_acknowledged` | `bool` |  |
| `acknowledged_at` | `date` |  |
| `primary_signature_status` | `text` |  |
| `secondary_signature_status` | `text` |  Nullable |
| `valid_id_received` | `bool` |  |
| `reservation_payment_proof_received` | `bool` |  |
| `status` | `text` |  |
| `created_by` | `uuid` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `submitted_at` | `timestamptz` |  Nullable |
| `approved_at` | `timestamptz` |  Nullable |
| `rejected_at` | `timestamptz` |  Nullable |
| `purchase_terms_id` | `uuid` |  Nullable |
| `vd_staff_id` | `uuid` |  Nullable |
| `ssm_staff_id` | `uuid` |  Nullable |
| `sm_staff_id` | `uuid` |  Nullable |
| `recommender_customer_id` | `uuid` |  Nullable |
| `referrer_ost_id` | `uuid` |  Nullable |
| `svd_name` | `text` |  Nullable |
| `ssm_name` | `text` |  Nullable |
| `svd_staff_id` | `uuid` |  Nullable |
| `referrer_staff_id` | `uuid` |  Nullable |

## Table `customer_application_holders`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `application_id` | `uuid` |  |
| `holder_type` | `text` |  |
| `last_name` | `text` |  |
| `first_name` | `text` |  |
| `middle_name` | `text` |  Nullable |
| `suffix` | `text` |  Nullable |
| `birth_date` | `date` |  |
| `sex` | `text` |  Nullable |
| `citizenship` | `text` |  Nullable |
| `civil_status` | `text` |  Nullable |
| `permanent_address_line_1` | `text` |  |
| `permanent_address_line_2` | `text` |  Nullable |
| `city_municipality` | `text` |  |
| `province` | `text` |  |
| `postal_code` | `text` |  Nullable |
| `landline` | `text` |  Nullable |
| `mobile` | `text` |  |
| `email` | `text` |  |
| `tin_number` | `text` |  Nullable |
| `occupation_business_name` | `text` |  Nullable |
| `office_business_address` | `text` |  Nullable |
| `business_industry` | `text` |  Nullable |
| `employed_position` | `text` |  Nullable |
| `printed_name` | `text` |  |
| `created_at` | `timestamptz` |  |
| `barangay` | `text` |  Nullable |
| `province_code` | `text` |  Nullable |
| `city_municipality_code` | `text` |  Nullable |
| `barangay_code` | `text` |  Nullable |

## Table `customer_application_documents`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `application_id` | `uuid` |  |
| `document_type` | `text` |  |
| `identity_document_id` | `uuid` |  Nullable |
| `payment_id` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `reservation_agreements`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `reservation_number` | `text` |  Unique |
| `revision_number` | `text` |  Nullable |
| `reservation_date` | `date` |  |
| `agreement_date` | `date` |  |
| `sale_id` | `uuid` |  Nullable Unique |
| `customer_application_id` | `uuid` |  Nullable |
| `plan_id` | `uuid` |  |
| `tier_snapshot` | `text` |  |
| `inclusions_snapshot` | `jsonb` |  |
| `total_price_snapshot` | `text` |  |
| `reservation_fee_snapshot` | `text` |  |
| `down_payment_snapshot` | `text` |  |
| `total_payment_received_snapshot` | `text` |  |
| `balance_snapshot` | `text` |  |
| `monthly_amortization_snapshot` | `text` |  Nullable |
| `installment_months_snapshot` | `int4` |  Nullable |
| `payment_scheme_snapshot` | `text` |  |
| `discount_percent_snapshot` | `int4` |  |
| `validity_years_snapshot` | `int4` |  |
| `yearly_points_snapshot` | `int4` |  |
| `annual_points_tranches_snapshot` | `int4` |  |
| `holder_limit_snapshot` | `int4` |  |
| `monthly_amortization_start` | `date` |  Nullable |
| `monthly_amortization_end` | `date` |  Nullable |
| `payment_due_day` | `int4` |  Nullable |
| `primary_signature_status` | `text` |  |
| `secondary_signature_status` | `text` |  Nullable |
| `status` | `text` |  |
| `created_by` | `uuid` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `submitted_at` | `timestamptz` |  Nullable |
| `executed_at` | `timestamptz` |  Nullable |
| `origin` | `text` |  |
| `customer_id` | `uuid` |  Nullable |
| `seller_staff_id` | `uuid` |  Nullable |
| `purchase_terms_id` | `uuid` |  Nullable |
| `minimum_down_payment_snapshot` | `text` |  Nullable |
| `required_initial_snapshot` | `text` |  Nullable |
| `spot_cash_days_snapshot` | `int4` |  Nullable |
| `validity_months_snapshot` | `int4` |  Nullable |
| `commission_rule_id` | `uuid` |  Nullable |
| `commission_rate_snapshot` | `text` |  Nullable |
| `commission_base_snapshot` | `text` |  Nullable |
| `expected_commission_snapshot` | `text` |  Nullable |
| `spot_cash_started_at` | `timestamptz` |  Nullable |
| `spot_cash_deadline` | `timestamptz` |  Nullable |
| `finalized_by` | `uuid` |  Nullable |
| `finalized_at` | `timestamptz` |  Nullable |

## Table `reservation_agreement_holders`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `agreement_id` | `uuid` |  |
| `holder_type` | `text` |  |
| `name` | `text` |  |
| `address` | `text` |  |
| `contact_number` | `text` |  |
| `email` | `text` |  |
| `tin_number` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `reservation_agreement_schedule`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `agreement_id` | `uuid` |  |
| `line_number` | `int4` |  |
| `particular` | `text` |  |
| `amount_snapshot` | `text` |  |
| `payment_date` | `date` |  Nullable |
| `remarks` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `reservation_agreement_documents`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `agreement_id` | `uuid` |  |
| `payment_id` | `uuid` |  |
| `created_at` | `timestamptz` |  |

## Table `customer_import_jobs`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `source_type` | `text` |  |
| `source_name` | `text` |  |
| `google_sheet_id` | `text` |  Nullable |
| `status` | `text` |  |
| `total_rows` | `int4` |  |
| `valid_rows` | `int4` |  |
| `invalid_rows` | `int4` |  |
| `inserted_rows` | `int4` |  |
| `updated_rows` | `int4` |  |
| `skipped_rows` | `int4` |  |
| `created_by` | `uuid` |  |
| `created_at` | `timestamptz` |  |
| `validated_at` | `timestamptz` |  Nullable |
| `committed_at` | `timestamptz` |  Nullable |
| `failed_at` | `timestamptz` |  Nullable |
| `cancelled_at` | `timestamptz` |  Nullable |
| `failed_rows` | `int4` |  |
| `job_number` | `text` |  Unique |

## Table `customer_import_rows`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `import_job_id` | `uuid` |  |
| `row_number` | `int4` |  |
| `raw_data` | `jsonb` |  |
| `normalized_data` | `jsonb` |  |
| `validation_status` | `text` |  |
| `validation_errors` | `jsonb` |  |
| `validation_warnings` | `jsonb` |  |
| `action` | `text` |  |
| `customer_id` | `uuid` |  Nullable |
| `membership_id` | `uuid` |  Nullable |
| `sale_id` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |
| `committed_at` | `timestamptz` |  Nullable |

## Table `customer_application_purchase_terms`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `application_id` | `uuid` |  |
| `customer_id` | `uuid` |  |
| `plan_id` | `uuid` |  |
| `seller_staff_id` | `uuid` |  |
| `version` | `int4` |  |
| `capture_kind` | `text` |  |
| `reason` | `text` |  Nullable |
| `captured_by` | `uuid` |  |
| `captured_at` | `timestamptz` |  |
| `tier` | `text` |  |
| `payment_scheme` | `text` |  |
| `total_price` | `text` |  |
| `reservation_fee` | `text` |  |
| `minimum_down_payment` | `text` |  |
| `required_initial` | `text` |  |
| `installment_months` | `int4` |  Nullable |
| `monthly_amount` | `text` |  Nullable |
| `spot_cash_days` | `int4` |  |
| `validity_months` | `int4` |  |
| `discount_percent` | `int4` |  |
| `yearly_points` | `int4` |  |
| `annual_points_tranches` | `int4` |  |
| `holder_limit` | `int4` |  |
| `inclusions` | `jsonb` |  |
| `commission_rule_id` | `uuid` |  Nullable |
| `commission_rate` | `text` |  |
| `commission_base` | `text` |  |
| `expected_commission` | `text` |  |

## Table `tier_points_config`

The sole authority for an annual points cap, one row per VIP tier. Points periods snapshot the cap at open time, so editing a cap here never rewrites a running period.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `tier` | `text` | Primary |
| `annual_points_cap` | `int8` |  |
| `updated_at` | `timestamptz` |  |
| `updated_by` | `uuid` |  Nullable |

## Table `points_periods`

Anniversary-based points periods, half-open [period_start, period_end) in Asia/Manila. One row per account per points year; the tier and cap are snapshots taken when the period opened.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `account_id` | `uuid` |  |
| `period_start` | `date` |  |
| `period_end` | `date` |  |
| `tier` | `text` |  |
| `annual_points_cap` | `int8` |  |
| `opening_balance` | `int8` |  Nullable |
| `closing_balance` | `int8` |  Nullable |
| `status` | `text` |  |
| `reset_at` | `timestamptz` |  Nullable |
| `reset_source` | `text` |  Nullable |
| `reset_actor_id` | `uuid` |  Nullable |
| `authoritative_from` | `date` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `service_catalog`

Eligible AF Homes products and services (Teppanyaki, Resort Stay, Hotel). Admin-managed; no service is hardcoded in application code. is_staycation_eligible is the ONLY eligibility classification; a non-eligible service can still be discounted by an active promotion (point_redemption_rules).

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `code` | `text` |  Unique |
| `name` | `text` |  |
| `description` | `text` |  Nullable |
| `base_price` | `text` |  |
| `is_active` | `bool` |  |
| `is_staycation_eligible` | `bool` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `published` | `bool` |  |
| `availability` | `text` |  |
| `photos` | `jsonb` |  |
| `details` | `jsonb` |  |

## Table `point_earning_rules`

Configurable point awards. Selection takes the ACTIVE rule that is in date and tier-eligible with the HIGHEST points_amount, so a promotion outranks a base rule automatically. No eligible rule means no claim and no award.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `service_id` | `uuid` |  |
| `points_amount` | `int8` |  |
| `eligible_tiers` | `_text` |  |
| `effective_start` | `date` |  |
| `effective_end` | `date` |  |
| `is_active` | `bool` |  |
| `min_quantity` | `int4` |  |
| `max_award` | `int8` |  Nullable |
| `promotion_reference` | `text` |  Nullable |
| `created_by` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `point_redemption_rules`

Date-bounded promotions that make a NON-staycation service discountable by points. Half-open [effective_start, effective_end) in Asia/Manila; both ends NOT NULL, so no indefinite promotion exists. Never applied to VIP card pricing and never stacks with card_plans.discount_percent.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `service_id` | `uuid` |  |
| `peso_value_per_point` | `numeric` |  |
| `eligible_tiers` | `_text` |  |
| `min_points` | `int8` |  |
| `max_points` | `int8` |  Nullable |
| `min_purchase_amount` | `text` |  Nullable |
| `effective_start` | `date` |  |
| `effective_end` | `date` |  |
| `is_active` | `bool` |  |
| `promotion_reference` | `text` |  |
| `created_by` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `allow_discount_stacking` | `bool` |  |
| `rule_kind` | `text` |  |

## Table `purchases`

A completed AF Homes service purchase. Only status='completed' can generate an earning claim, and completion requires verified receipts in purchase_payments to cover net_amount.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `purchase_number` | `text` |  Unique |
| `customer_id` | `uuid` |  |
| `membership_id` | `uuid` |  |
| `status` | `text` |  |
| `gross_amount` | `text` |  |
| `points_discount_amount` | `text` |  |
| `net_amount` | `text` |  |
| `completed_at` | `timestamptz` |  Nullable |
| `reversed_at` | `timestamptz` |  Nullable |
| `reversal_reason` | `text` |  Nullable |
| `created_by` | `uuid` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `tier_discount_amount` | `text` |  |
| `tier_snapshot` | `text` |  Nullable |
| `points_discount_reference` | `text` |  Nullable |
| `idempotency_reference` | `text` |  Nullable |

## Table `purchase_lines`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `purchase_id` | `uuid` |  |
| `service_id` | `uuid` |  |
| `quantity` | `int4` |  |
| `unit_amount` | `text` |  |
| `line_total` | `text` |  |
| `points_discount_amount` | `text` |  |
| `discount_eligible` | `bool` |  |
| `tier_discount_amount` | `text` |  |
| `tier_discount_rate` | `numeric` |  Nullable |
| `tier` | `text` |  Nullable |
| `tier_discount_rule_id` | `uuid` |  Nullable |
| `service_name_snapshot` | `text` |  Nullable |
| `pricing_unit_snapshot` | `text` |  Nullable |

## Table `purchase_payments`

Operational Services receipts ONLY. References purchases(id) and nothing from the VIP-card workflow: no FK to card_sales, reservations or public.payments, so an operational receipt can never appear on a card sale. Only 'verified' rows are money received. Verified by finance.payment_verification-independent operations.payments UPDATE, never by the seller who recorded it.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `payment_number` | `text` |  Unique |
| `purchase_id` | `uuid` |  |
| `amount` | `text` |  |
| `method` | `text` |  |
| `reference` | `text` |  Nullable |
| `status` | `text` |  |
| `recorded_by` | `uuid` |  |
| `verified_by` | `uuid` |  Nullable |
| `recorded_at` | `timestamptz` |  |
| `verified_at` | `timestamptz` |  Nullable |
| `rejection_reason` | `text` |  Nullable |
| `voided_at` | `timestamptz` |  Nullable |
| `notes` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `redemption_quotes`

A short-lived priced offer for spending points on a purchase. The peso value and the conversion rate are snapshots of the matched promotion; commit spends exactly what was quoted and re-reads no configuration.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `quote_number` | `text` |  Unique |
| `purchase_id` | `uuid` |  |
| `account_id` | `uuid` |  |
| `membership_id` | `uuid` |  |
| `points_requested` | `int8` |  |
| `peso_value_per_point` | `numeric` |  |
| `peso_value` | `text` |  |
| `eligible_line_total` | `text` |  |
| `points_balance_snapshot` | `int8` |  |
| `remaining_points_after` | `int8` |  |
| `status` | `text` |  |
| `expires_at` | `timestamptz` |  |
| `committed_at` | `timestamptz` |  Nullable |
| `ledger_entry_id` | `int8` |  Nullable |
| `created_by` | `uuid` |  |
| `created_at` | `timestamptz` |  |
| `approval_snapshot` | `jsonb` |  Nullable |
| `approval_expires_at` | `timestamptz` |  Nullable |
| `approval_customer_id` | `uuid` |  Nullable |
| `approval_auth_user_id` | `uuid` |  Nullable |
| `approved_at` | `timestamptz` |  Nullable |
| `rejected_at` | `timestamptz` |  Nullable |
| `approval_consumed_at` | `timestamptz` |  Nullable |
| `redemption_rule_id` | `uuid` |  Nullable |
| `reserved_at` | `timestamptz` |  Nullable |
| `released_at` | `timestamptz` |  Nullable |

## Table `earning_claims`

A customer-bound, single-use point award created from one completed purchase. Tokens are stored hash-only and rotate rather than recover; an ownership mismatch is refused generically.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `claim_number` | `text` |  Unique |
| `purchase_id` | `uuid` |  Unique |
| `customer_id` | `uuid` |  |
| `membership_id` | `uuid` |  |
| `account_id` | `uuid` |  |
| `service_id` | `uuid` |  |
| `rule_id` | `uuid` |  |
| `period_id` | `uuid` |  |
| `tier` | `text` |  |
| `points_requested` | `int8` |  |
| `points_awarded` | `int8` |  |
| `points_capped` | `int8` |  |
| `counts_toward_cap` | `bool` |  |
| `status` | `text` |  |
| `qr_token_hash` | `text` |  Nullable |
| `fallback_code_hash` | `text` |  Nullable |
| `token_issued_at` | `timestamptz` |  Nullable |
| `expires_at` | `timestamptz` |  |
| `claimed_at` | `timestamptz` |  Nullable |
| `created_at` | `timestamptz` |  |
| `min_quantity_snapshot` | `int4` |  Nullable |
| `original_quantity` | `int4` |  Nullable |
| `points_per_unit_snapshot` | `int8` |  Nullable |
| `max_award_snapshot` | `int8` |  Nullable |

## Table `service_tier_discounts`

Operational Services VIP tier discounts: an admin-configured percentage per service per tier, effective-dated. Never derived from card_plans.discount_percent, which discounts CARD purchases only. The applied rate is SNAPSHOT onto each sale, so editing a rule here never rewrites a settled transaction.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `service_id` | `uuid` |  |
| `tier` | `text` |  |
| `discount_rate` | `numeric` |  |
| `effective_start` | `date` |  |
| `effective_end` | `date` |  |
| `is_active` | `bool` |  |
| `created_by` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `purchase_point_refunds`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `purchase_id` | `uuid` |  |
| `quote_id` | `uuid` |  Nullable |
| `refund_reference` | `text` |  Unique |
| `service_value` | `text` |  |
| `points_restored` | `int8` |  |
| `ledger_entry_id` | `int8` |  Nullable |
| `reviewed_by` | `uuid` |  |
| `reason` | `text` |  |
| `reviewed_at` | `timestamptz` |  |

## Table `service_refunds`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `purchase_id` | `uuid` |  |
| `reference` | `text` |  Unique |
| `service_value` | `text` |  |
| `cash_amount` | `text` |  |
| `status` | `text` |  |
| `reason` | `text` |  |
| `requested_by` | `uuid` |  |
| `requested_at` | `timestamptz` |  |
| `reviewed_by` | `uuid` |  Nullable |
| `reviewed_at` | `timestamptz` |  Nullable |
| `points_restored` | `int8` |  |
| `earned_points_adjusted` | `int8` |  |
| `point_refund_id` | `uuid` |  Nullable |

## Table `service_refund_repayments`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `refund_id` | `uuid` |  |
| `amount` | `text` |  |
| `method` | `text` |  |
| `reference` | `text` |  |
| `repaid_at` | `timestamptz` |  |
| `recorded_by` | `uuid` |  |
| `recorded_at` | `timestamptz` |  |
| `receipt_path` | `text` |  Nullable |

## RLS Policies

### `payments`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `payments_read` | SELECT | authenticated | PERMISSIVE | `(private.has_permission('finance.payment_verification'::text) OR (EXISTS ( SELECT 1    FROM card_sales s   WHERE ((s.id = payments.sale_id) AND ((s.seller_staff_id = ( SELECT auth.uid() AS uid)) OR (s.seller_ost_id = ( SELECT auth.uid() AS uid)))))))` | — |

### `memberships`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `memberships_read` | SELECT | authenticated | PERMISSIVE | `((EXISTS ( SELECT 1    FROM customers c   WHERE ((c.id = memberships.customer_id) AND (c.auth_user_id = ( SELECT auth.uid() AS uid))))) OR private.has_permission('sales.customers'::text) OR private.has_permission('finance.card_activation'::text) OR private.has_permission('operations.redemption'::text))` | — |

### `points_accounts`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `points_accounts_read` | SELECT | authenticated | PERMISSIVE | `((EXISTS ( SELECT 1    FROM (memberships m      JOIN customers c ON ((c.id = m.customer_id)))   WHERE ((m.id = points_accounts.membership_id) AND (c.auth_user_id = ( SELECT auth.uid() AS uid))))) OR private.has_permission('finance.points'::text) OR private.has_permission('operations.redemption'::text))` | — |

### `points_ledger`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `points_ledger_read` | SELECT | authenticated | PERMISSIVE | `((EXISTS ( SELECT 1    FROM ((points_accounts pa      JOIN memberships m ON ((m.id = pa.membership_id)))      JOIN customers c ON ((c.id = m.customer_id)))   WHERE ((pa.id = points_ledger.account_id) AND (c.auth_user_id = ( SELECT auth.uid() AS uid))))) OR private.has_permission('finance.points'::text) OR private.has_permission('operations.redemption'::text))` | — |

### `commissions`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `commissions_read` | SELECT | authenticated | PERMISSIVE | `((beneficiary_staff_id = ( SELECT auth.uid() AS uid)) OR (beneficiary_ost_id = ( SELECT auth.uid() AS uid)) OR private.has_permission('network.commissions'::text))` | — |

### `referral_relationships`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `referral_relationships_read` | SELECT | authenticated | PERMISSIVE | `private.can_view_genealogy_edge(subject_staff_id, upline_staff_id)` | — |

### `redemption_items`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `redemption_items_read` | SELECT | authenticated | PERMISSIVE | `(private.has_permission('operations.catalog'::text) OR private.has_permission('operations.redemption'::text))` | — |

### `redemptions`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `redemptions_read` | SELECT | authenticated | PERMISSIVE | `private.has_permission('operations.redemption'::text)` | — |

### `cms_documents`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `cms_documents_staff_read` | SELECT | authenticated | PERMISSIVE | `(private.has_permission('cms.pages'::text) OR private.has_permission('cms.settings'::text))` | — |

### `cms_pages`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `cms_pages_staff_read` | SELECT | authenticated | PERMISSIVE | `private.has_permission('cms.pages'::text)` | — |

### `cms_page_sections`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `cms_page_sections_staff_read` | SELECT | authenticated | PERMISSIVE | `private.has_permission('cms.pages'::text)` | — |

### `cms_media_assets`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `cms_media_assets_staff_read` | SELECT | authenticated | PERMISSIVE | `private.has_permission('cms.media'::text)` | — |

### `cms_document_versions`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `cms_document_versions_staff_read` | SELECT | authenticated | PERMISSIVE | `private.has_permission('cms.history'::text)` | — |

### `departments`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `departments_read` | SELECT | authenticated | PERMISSIVE | `private.has_permission('organization.staff'::text)` | — |

### `roles`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `roles_read` | SELECT | authenticated | PERMISSIVE | `private.has_permission('organization.roles'::text)` | — |

### `modules`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `modules_read` | SELECT | authenticated | PERMISSIVE | `private.has_permission('organization.roles'::text)` | — |

### `role_permissions`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `role_permissions_read` | SELECT | authenticated | PERMISSIVE | `private.has_permission('organization.roles'::text)` | — |

### `staff_role_assignments`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `staff_roles_read` | SELECT | authenticated | PERMISSIVE | `((staff_id = ( SELECT auth.uid() AS uid)) OR private.has_permission('organization.staff'::text))` | — |

### `staff_permission_restrictions`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `staff_restrictions_read` | SELECT | authenticated | PERMISSIVE | `((staff_id = ( SELECT auth.uid() AS uid)) OR private.has_permission('organization.roles'::text))` | — |

### `staff_invitations`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `staff_invitations_read` | SELECT | authenticated | PERMISSIVE | `private.has_permission('organization.staff'::text)` | — |

### `referral_codes`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `referral_codes_read` | SELECT | authenticated | PERMISSIVE | `((sponsor_staff_id = ( SELECT auth.uid() AS uid)) OR private.has_permission('network.referrals'::text))` | — |

### `ost_applications`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `ost_applications_read` | SELECT | authenticated | PERMISSIVE | `((sponsor_staff_id = ( SELECT auth.uid() AS uid)) OR private.has_permission('network.ost_registrations'::text))` | — |

### `card_categories`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `card_categories_read` | SELECT | authenticated | PERMISSIVE | `(private.has_permission('sales.card_sales'::text) OR private.has_permission('sales.card_plans'::text))` | — |

### `final_qualifications`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `qualifications_read` | SELECT | authenticated | PERMISSIVE | `private.has_permission('finance.final_qualification'::text)` | — |

### `audit_events`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `audit_events_read` | SELECT | authenticated | PERMISSIVE | `private.has_permission('governance.audit'::text)` | — |

### `identity_documents`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `identity_documents_read` | SELECT | authenticated | PERMISSIVE | `private.can_read_identity_document(id)` | — |

### `staff_users`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `staff_users_read` | SELECT | authenticated | PERMISSIVE | `((id = ( SELECT auth.uid() AS uid)) OR private.has_permission('organization.staff'::text))` | — |

### `ost_members`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `ost_members_read` | SELECT | authenticated | PERMISSIVE | `((id = ( SELECT auth.uid() AS uid)) OR (sponsor_staff_id = ( SELECT auth.uid() AS uid)) OR private.has_permission('network.ost_members'::text))` | — |

### `cms_page_versions`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `cms_page_versions_staff_read` | SELECT | authenticated | PERMISSIVE | `private.has_permission('cms.history'::text)` | — |

### `commission_rules`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `commission_rules_read` | SELECT | authenticated | PERMISSIVE | `private.has_permission('network.commissions'::text)` | — |

### `card_sales`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `card_sales_read` | SELECT | authenticated | PERMISSIVE | `((seller_staff_id = ( SELECT auth.uid() AS uid)) OR (seller_ost_id = ( SELECT auth.uid() AS uid)) OR private.has_permission('sales.card_sales'::text) OR private.has_permission('finance.payment_verification'::text) OR private.has_permission('finance.card_activation'::text))` | — |

### `card_plans`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `card_plans_read` | SELECT | authenticated | PERMISSIVE | `(private.has_permission('sales.card_sales'::text) OR private.has_permission('sales.card_plans'::text))` | — |

### `customer_application_documents`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `customer_application_documents_read` | SELECT | authenticated | PERMISSIVE | `(private.has_permission('sales.customers'::text) OR private.has_permission('sales.card_sales'::text))` | — |

### `reservation_agreement_holders`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `reservation_agreement_holders_read` | SELECT | authenticated | PERMISSIVE | `(private.has_permission('sales.customers'::text) OR private.has_permission('sales.card_sales'::text))` | — |

### `customer_import_jobs`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `customer_import_jobs_read` | SELECT | authenticated | PERMISSIVE | `private.has_permission('governance.customer_import'::text)` | — |

### `reservation_agreement_schedule`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `reservation_agreement_schedule_read` | SELECT | authenticated | PERMISSIVE | `(private.has_permission('sales.customers'::text) OR private.has_permission('sales.card_sales'::text))` | — |

### `reservation_agreement_documents`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `reservation_agreement_documents_read` | SELECT | authenticated | PERMISSIVE | `(private.has_permission('sales.customers'::text) OR private.has_permission('sales.card_sales'::text))` | — |

### `customer_application_holders`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `customer_application_holders_read` | SELECT | authenticated | PERMISSIVE | `(private.has_permission('sales.customers'::text) OR private.has_permission('sales.card_sales'::text))` | — |

### `customer_import_rows`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `customer_import_rows_read` | SELECT | authenticated | PERMISSIVE | `private.has_permission('governance.customer_import'::text)` | — |

### `customer_applications`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `customer_applications_read` | SELECT | authenticated | PERMISSIVE | `(private.has_permission('sales.customers'::text) OR private.has_permission('sales.card_sales'::text))` | — |

### `reservation_agreements`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `reservation_agreements_read` | SELECT | authenticated | PERMISSIVE | `(private.has_permission('sales.customers'::text) OR private.has_permission('sales.card_sales'::text))` | — |

### `service_tier_discounts`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `service_tier_discounts_select` | SELECT | authenticated | PERMISSIVE | `private.has_permission('operations.catalog'::text, 'view'::text)` | — |

### `customers`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `customers_read` | SELECT | authenticated | PERMISSIVE | `((auth_user_id = ( SELECT auth.uid() AS uid)) OR private.has_permission('sales.customers'::text) OR private.has_permission('finance.payment_verification'::text) OR private.has_permission('finance.card_activation'::text))` | — |

