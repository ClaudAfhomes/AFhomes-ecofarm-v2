-- Schema-only changes for IST employee identity (no function replacements).
-- Business-owner clarification 2026-10-18:
-- IST is an employee identity, not an annually accredited external seller.
-- Keep the existing canonical number registry and every legacy row unchanged.
-- New IST identities have no validity dates. OST still requires both dates.
-- This migration is backward compatible: existing function signatures unchanged.
begin;
alter table private.sale_team_accreditations alter column starts_on drop not null;
alter table private.sale_team_accreditations alter column expires_on drop not null;
alter table private.sale_team_accreditations add constraint sale_team_identity_dates
  check ((kind='IST' and ((starts_on is null and expires_on is null) or (starts_on is not null and expires_on is not null)))
      or (kind='OST' and starts_on is not null and expires_on is not null));
alter table private.sale_team_accreditation_history alter column starts_on drop not null;
alter table private.sale_team_accreditation_history alter column expires_on drop not null;
alter table private.sale_team_accreditation_history add constraint sale_team_history_identity_dates
  check ((kind='IST' and ((starts_on is null and expires_on is null) or (starts_on is not null and expires_on is not null)))
      or (kind='OST' and starts_on is not null and expires_on is not null));
commit;