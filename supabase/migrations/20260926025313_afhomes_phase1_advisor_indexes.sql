-- AF Homes Phase 1 advisor remediation: covering indexes for every foreign key.
-- Down: drop each index named below. No data or authorization behavior changes.

create index audit_events_actor_id_idx on public.audit_events(actor_id);
create index card_plans_category_id_idx on public.card_plans(category_id);
create index card_sales_customer_id_idx on public.card_sales(customer_id);
create index card_sales_plan_id_idx on public.card_sales(plan_id);
create index card_sales_seller_ost_id_idx on public.card_sales(seller_ost_id);
create index card_sales_seller_staff_id_idx on public.card_sales(seller_staff_id);
create index commissions_ost_id_idx on public.commissions(ost_id);
create index final_qualifications_reviewed_by_idx on public.final_qualifications(reviewed_by);
create index identity_documents_customer_id_idx on public.identity_documents(customer_id);
create index identity_documents_ost_application_id_idx on public.identity_documents(ost_application_id);
create index identity_documents_reviewed_by_idx on public.identity_documents(reviewed_by);
create index memberships_activated_by_idx on public.memberships(activated_by);
create index ost_applications_referral_code_id_idx on public.ost_applications(referral_code_id);
create index ost_applications_reviewed_by_idx on public.ost_applications(reviewed_by);
create index ost_applications_sponsor_staff_id_idx on public.ost_applications(sponsor_staff_id);
create index ost_members_approved_by_idx on public.ost_members(approved_by);
create index ost_members_sponsor_staff_id_idx on public.ost_members(sponsor_staff_id);
create index payments_recorded_by_idx on public.payments(recorded_by);
create index payments_sale_id_idx on public.payments(sale_id);
create index payments_verified_by_idx on public.payments(verified_by);
create index referral_codes_created_by_idx on public.referral_codes(created_by);
create index referral_codes_sponsor_staff_id_idx on public.referral_codes(sponsor_staff_id);
create index role_permissions_module_id_idx on public.role_permissions(module_id);
create index staff_invitations_department_id_idx on public.staff_invitations(department_id);
create index staff_invitations_invited_by_idx on public.staff_invitations(invited_by);
create index staff_invitations_role_id_idx on public.staff_invitations(role_id);
create index staff_permission_restrictions_module_id_idx on public.staff_permission_restrictions(module_id);
create index staff_role_assignments_assigned_by_idx on public.staff_role_assignments(assigned_by);
create index staff_role_assignments_role_id_idx on public.staff_role_assignments(role_id);
create index staff_users_department_id_idx on public.staff_users(department_id);
