# Public Verification UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the public IST/OST verification search result to use a unified layout with company payment information, redesign the Admin Public Verification Settings page to manage all company-facing settings, and improve the Privacy Notice editing/presentation experience.

**Architecture:** 
- Extend the existing `private.public_verification_settings` table with new columns for customer support, bank accounts, and payment notices
- Update contracts schemas to include new fields
- Create a shared `VerificationResultCard` component used by both IST and OST results
- Redesign `SaleTeamSearch.tsx` to use the new result layout
- Redesign `PublicVerificationSettingsPage.tsx` with organized sections and edit/preview for Privacy Notice
- Update API handlers to serve new settings and pass them to the public result

**Tech Stack:** React 19, TypeScript, Zod, TanStack Query, Vite, Supabase/PostgreSQL, CSS Modules

**Spec:** This plan implements the requirements in the task description provided by the user.

## Global Constraints

- IST and OST must have exactly the same public verification result UI; only AAI/AAO prefix differs
- No "Valid Until" field displayed for either role
- "Registration Status" renamed to "Verification Status"
- Old "Company Verification Contact" card removed
- Bank account numbers must be strings (preserve leading zeros)
- All company-facing settings stored in backend, editable via Admin
- Employee identity/accreditation data remains authoritative and protected
- Existing privacy/legal content preserved; no new legal claims
- Existing accreditation business logic unchanged
- Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` before completion

## Review Focus

1. **IST/OST visual identity** — Both results must render identically with only prefix difference; test both kinds
2. **Settings persistence** — New Admin fields must save/load correctly and appear in public results without redeploy
3. **Bank account handling** — Account numbers as strings, copy-to-clipboard works, leading zeros preserved
4. **Privacy Notice safety** — Edit/Preview modes work, no XSS risk from rendered content
5. **Authorization boundaries** — Public users read only approved settings; Admin writes require governance.config update permission

---

### Task 1: Database Migration for Extended Settings

**Files:**
- Create: `supabase/migrations/20261024000001_afhomes_public_verification_extended_settings.sql`
- Modify: None
- Test: `pnpm test:db:local` (after migration applied)

**Interfaces:**
- Produces: New columns in `private.public_verification_settings` table, updated `get_public_verification_settings()` and `update_public_verification_settings()` functions

- [ ] **Step 1: Write the migration file**

```sql
-- Add customer support, bank accounts, and payment notice fields to public_verification_settings
-- Validate: new fields readable via get_public_verification_settings, writable via update_public_verification_settings
-- Down: remove added columns; retain existing data in other columns
begin;
alter table private.public_verification_settings
  add column if not exists support_heading text not null default 'Customer Support & Payment Inquiries',
  add column if not exists support_email text not null default 'info@afhomes.com.ph' check(support_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column if not exists support_phone text not null default '+63 960 431 6867' check(support_phone ~ '^\+?[0-9 ()-]{7,30}$'),
  add column if not exists bank_holder text not null default 'AFhomes Hotspring & Ecofarm Resort Corp.',
  add column if not exists bank1_name text not null default 'SECURITY BANK',
  add column if not exists bank1_account text not null default '0000082595577',
  add column if not exists bank2_name text not null default 'CHINABANK',
  add column if not exists bank2_account text not null default '150700006468',
  add column if not exists check_payee text not null default 'AFhomes Hotspring & Ecofarm Resort Corp.',
  add column if not exists bank_reminder text not null default 'Please double-check the provided company bank account details before sending any payment. Thank you!',
  add column if not exists agent_reminder text not null default 'A friendly reminder: All agents are strictly prohibited from directly collecting payments from buyers.';

-- Update get_public_verification_settings to include new fields
create or replace function public.get_public_verification_settings() returns jsonb
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select jsonb_build_object(
   'enabled',s.enabled,
   'dailyLimitEnabled',s.daily_limit_enabled,
   'verificationPhone',s.verification_phone,
   'privacyNotice',s.privacy_notice,
   'retentionDays',s.retention_days,
   'noticeVersion',s.notice_version,
   'revision',s.revision,
   'updatedAt',s.updated_at,
   'supportHeading',s.support_heading,
   'supportEmail',s.support_email,
   'supportPhone',s.support_phone,
   'bankHolder',s.bank_holder,
   'bank1Name',s.bank1_name,
   'bank1Account',s.bank1_account,
   'bank2Name',s.bank2_name,
   'bank2Account',s.bank2_account,
   'checkPayee',s.check_payee,
   'bankReminder',s.bank_reminder,
   'agentReminder',s.agent_reminder
 )
 from private.public_verification_settings s where s.singleton;
$$;

-- Update update_public_verification_settings to handle new fields
create or replace function public.update_public_verification_settings(p_actor uuid,p_input jsonb,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_role text; v_before private.public_verification_settings%rowtype; v_version text;
begin
 v_role:=private.mutation_actor_role(p_actor,'governance.config','update');
 if v_role is null or v_role not in ('admin','super_admin') then raise exception 'SETTINGS_FORBIDDEN' using errcode='42501'; end if;
 select s.* into v_before from private.public_verification_settings s where s.singleton for update;
 if not found or p_expected_revision is distinct from v_before.revision then
  raise exception 'SETTINGS_CHANGED' using errcode='23505';
 end if;
 -- Validate all fields
 if (p_input ? 'dailyLimitEnabled' and jsonb_typeof(p_input->'dailyLimitEnabled') is distinct from 'boolean') or
    jsonb_typeof(p_input->'verificationPhone') is distinct from 'string' or
    jsonb_typeof(p_input->'privacyNotice') is distinct from 'string' or
    jsonb_typeof(p_input->'enabled') is distinct from 'boolean' or
    jsonb_typeof(p_input->'retentionDays') is distinct from 'number' or
    (p_input->>'retentionDays') !~ '^[0-9]+$' or
    jsonb_typeof(p_input->'supportHeading') is distinct from 'string' or
    jsonb_typeof(p_input->'supportEmail') is distinct from 'string' or
    jsonb_typeof(p_input->'supportPhone') is distinct from 'string' or
    jsonb_typeof(p_input->'bankHolder') is distinct from 'string' or
    jsonb_typeof(p_input->'bank1Name') is distinct from 'string' or
    jsonb_typeof(p_input->'bank1Account') is distinct from 'string' or
    jsonb_typeof(p_input->'bank2Name') is distinct from 'string' or
    jsonb_typeof(p_input->'bank2Account') is distinct from 'string' or
    jsonb_typeof(p_input->'checkPayee') is distinct from 'string' or
    jsonb_typeof(p_input->'bankReminder') is distinct from 'string' or
    jsonb_typeof(p_input->'agentReminder') is distinct from 'string' then
  raise exception 'SETTINGS_INVALID' using errcode='22023';
 end if;
 v_version:=case when (
   v_before.verification_phone,v_before.privacy_notice,v_before.retention_days,v_before.daily_limit_enabled,
   v_before.support_heading,v_before.support_email,v_before.support_phone,
   v_before.bank_holder,v_before.bank1_name,v_before.bank1_account,
   v_before.bank2_name,v_before.bank2_account,v_before.check_payee,
   v_before.bank_reminder,v_before.agent_reminder
 ) is distinct from (
   btrim(p_input->>'verificationPhone'),btrim(p_input->>'privacyNotice'),(p_input->>'retentionDays')::integer,
   coalesce((p_input->>'dailyLimitEnabled')::boolean,v_before.daily_limit_enabled),
   btrim(p_input->>'supportHeading'),btrim(p_input->>'supportEmail'),btrim(p_input->>'supportPhone'),
   btrim(p_input->>'bankHolder'),btrim(p_input->>'bank1Name'),btrim(p_input->>'bank1Account'),
   btrim(p_input->>'bank2Name'),btrim(p_input->>'bank2Account'),btrim(p_input->>'checkPayee'),
   btrim(p_input->>'bankReminder'),btrim(p_input->>'agentReminder')
 ) then gen_random_uuid()::text else v_before.notice_version end;
 update private.public_verification_settings s set
   enabled=(p_input->>'enabled')::boolean,
   daily_limit_enabled=coalesce((p_input->>'dailyLimitEnabled')::boolean,v_before.daily_limit_enabled),
   verification_phone=btrim(p_input->>'verificationPhone'),
   privacy_notice=btrim(p_input->>'privacyNotice'),
   retention_days=(p_input->>'retentionDays')::integer,
   support_heading=btrim(p_input->>'supportHeading'),
   support_email=btrim(p_input->>'supportEmail'),
   support_phone=btrim(p_input->>'supportPhone'),
   bank_holder=btrim(p_input->>'bankHolder'),
   bank1_name=btrim(p_input->>'bank1Name'),
   bank1_account=btrim(p_input->>'bank1Account'),
   bank2_name=btrim(p_input->>'bank2Name'),
   bank2_account=btrim(p_input->>'bank2Account'),
   check_payee=btrim(p_input->>'checkPayee'),
   bank_reminder=btrim(p_input->>'bankReminder'),
   agent_reminder=btrim(p_input->>'agentReminder'),
   notice_version=v_version,
   revision=s.revision+1,
   updated_at=clock_timestamp()
 where s.singleton;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data)
 values(p_actor,'PUBLIC_VERIFICATION_SETTINGS_UPDATED','public_verification_settings','singleton',
   jsonb_build_object(
     'dailyLimitEnabled',v_before.daily_limit_enabled,'enabled',v_before.enabled,'retentionDays',v_before.retention_days,'revision',v_before.revision
   ),
   jsonb_build_object(
     'dailyLimitEnabled',coalesce((p_input->>'dailyLimitEnabled')::boolean,v_before.daily_limit_enabled),
     'enabled',(p_input->>'enabled')::boolean,
     'retentionDays',(p_input->>'retentionDays')::integer,
     'revision',v_before.revision+1,
     'noticeVersion',v_version
   ));
 return public.get_public_verification_settings();
end;
$$;
commit;
```

- [ ] **Step 2: Apply migration locally and run DB tests**

Run: `pnpm db:migrate` then `pnpm test:db:local`
Expected: Migration applies cleanly, tests pass

---

### Task 2: Update Contracts Schemas

**Files:**
- Modify: `packages/contracts/src/schemas/public-verification-settings.ts`
- Modify: `packages/contracts/src/schemas/sale-team.ts` (if public result schema needs update)
- Test: `packages/contracts/src/schemas/public-verification-settings.spec.ts`, `packages/contracts/src/schemas/sale-team.spec.ts`

**Interfaces:**
- Consumes: Database migration from Task 1
- Produces: Updated Zod schemas for settings and public result

- [ ] **Step 1: Update `public-verification-settings.ts` with new fields**

Add to `publicVerificationFieldsSchema`:
- `supportHeading`, `supportEmail`, `supportPhone`
- `bankHolder`, `bank1Name`, `bank1Account`, `bank2Name`, `bank2Account`, `checkPayee`
- `bankReminder`, `agentReminder`

Add to `publicVerificationSettingsSchema` (extends fields):
- Same fields as above

Update `updatePublicVerificationSettingsSchema` accordingly

- [ ] **Step 2: Run contract tests**

Run: `pnpm --filter @afhomes/contracts test`
Expected: All tests pass

---

### Task 3: Create Shared VerificationResultCard Component

**Files:**
- Create: `apps/web/src/marketing/components/VerificationResultCard.tsx`
- Create: `apps/web/src/marketing/components/VerificationResultCard.spec.tsx`
- Create: `apps/web/src/marketing/components/VerificationResultCard.module.css`
- Test: Component tests

**Interfaces:**
- Consumes: `PublicSaleTeamSearchResult` from contracts, config settings from search config
- Produces: Reusable result card component

- [ ] **Step 1: Write failing component tests**

Test cases:
- IST result renders with AAI prefix, "Employee identity" badge, masked name, accreditation ID with copy button, Verification Status "Accredited"
- OST result renders with AAO prefix, "Employee identity" badge, masked name, accreditation ID with copy button, Verification Status "Accredited"
- Both have identical structure (Customer Support, Bank Accounts, Reminders)
- No "Valid Until" field displayed
- Email link uses mailto:, phone link uses tel:
- Bank account copy buttons work
- Friendly reminder styling (no warning triangle, soft blue/neutral)

- [ ] **Step 2: Implement `VerificationResultCard` component**

Component structure:
```tsx
interface VerificationResultCardProps {
  result: PublicSaleTeamSearchResult;
  config: SaleTeamSearchConfig; // contains supportEmail, supportPhone, bankHolder, bank1Name, bank1Account, etc.
}
```

Sections:
1. Employee Identity (badge, photo, masked name, AccreditationId, Verification Status)
2. Customer Support & Payment Inquiries (email + phone side-by-side desktop, stacked mobile)
3. Official Company Bank Accounts (two cards desktop, stacked mobile, copy buttons)
4. Check Payment Instructions (payee name)
5. Bank Detail Reminder
6. Friendly Agent Payment Reminder (soft blue/neutral, no warning icon)

- [ ] **Step 3: Run component tests**

Run: `pnpm --filter @afhomes/web test VerificationResultCard`
Expected: All tests pass

---

### Task 4: Update SaleTeamSearch Page to Use New Result Card

**Files:**
- Modify: `apps/web/src/marketing/pages/SaleTeamSearch.tsx`
- Modify: `apps/web/src/marketing/pages/SaleTeamSearch.spec.tsx`
- Test: Updated page tests

**Interfaces:**
- Consumes: `VerificationResultCard` from Task 3, updated config from API
- Produces: Updated search page with new result layout

- [ ] **Step 1: Update page to pass new config fields to VerificationResultCard**

Replace the inline result rendering (lines 267-341) with `<VerificationResultCard result={result} config={config} />`

- [ ] **Step 2: Update tests to match new result structure**

Update test expectations for:
- "Employee identity" badge for both IST and OST
- "Verification Status" instead of "Registration Status"
- Customer Support section with email/phone
- Bank Accounts section
- Friendly reminder without warning triangle

- [ ] **Step 3: Run page tests**

Run: `pnpm --filter @afhomes/web test SaleTeamSearch`
Expected: All tests pass

---

### Task 5: Update Public Sale Team Search API to Include New Settings

**Files:**
- Modify: `api/_lib/sale-team-search.ts` (searchConfiguration function)
- Modify: `api/_lib/sale-team-public-search.ts` (pass config to result)
- Test: `api/_lib/sale-team-search.spec.ts`, `api/_handlers/sale-team-search.spec.ts`

**Interfaces:**
- Consumes: Updated `get_public_verification_settings` from Task 1, updated contracts from Task 2
- Produces: Config object with new fields, passed to public result

- [ ] **Step 1: Update `searchConfiguration` to include new fields from settings**

Add: `supportHeading`, `supportEmail`, `supportPhone`, `bankHolder`, `bank1Name`, `bank1Account`, `bank2Name`, `bank2Account`, `checkPayee`, `bankReminder`, `agentReminder` to the returned `public` object

- [ ] **Step 2: Update API handler tests to expect new config fields**

- [ ] **Step 3: Run API tests**

Run: `pnpm --filter api test sale-team-search`
Expected: All tests pass

---

### Task 6: Redesign Admin PublicVerificationSettingsPage

**Files:**
- Modify: `apps/admin/src/features/afhomes/PublicVerificationSettingsPage.tsx`
- Modify: `apps/admin/src/features/afhomes/PublicVerificationSettingsPage.module.css`
- Create: `apps/admin/src/features/afhomes/PublicVerificationSettingsPage.spec.tsx`
- Test: Page component tests

**Interfaces:**
- Consumes: Updated contracts from Task 2, updated API from Task 5
- Produces: Redesigned settings page with organized sections

- [ ] **Step 1: Write failing tests for new sections**

Test cases:
- Customer Support section loads/saves (heading, email, phone)
- Official Bank Accounts section loads/saves (holder, 2 banks, check payee)
- Payment Notices section loads/saves (bank reminder, agent reminder)
- Privacy Notice has Edit/Preview modes
- Sections are clearly organized with headings
- Validation works for email, phone, bank account fields
- Unsaved changes indicator
- Read-only mode works correctly

- [ ] **Step 2: Implement redesigned SettingsForm with sections**

Sections in order:
1. Public Search Controls (existing: enabled, dailyLimitEnabled, retentionDays)
2. Customer Support (heading, email, phone) — phone reuses verificationPhone or separate?
3. Official Company Bank Accounts (holder, bank1 name/account, bank2 name/account, check payee)
4. Payment Notices (bank reminder, agent reminder)
5. Privacy Notice (Edit/Preview tabs or side-by-side)

Key changes:
- Privacy Notice: Add tab toggle (Edit/Preview), render preview safely (escape HTML, preserve paragraphs)
- Use text inputs for bank account numbers (not numeric)
- Group related fields visually
- Add unsaved changes tracking
- Responsive layout

- [ ] **Step 3: Run admin tests**

Run: `pnpm --filter @afhomes/admin test PublicVerificationSettingsPage`
Expected: All tests pass

---

### Task 7: Update Admin API Handler for New Fields

**Files:**
- Modify: `api/_handlers/admin/afhomes.ts` (public-verification-settings path)
- Test: `api/_handlers/admin/public-verification-settings.spec.ts`

**Interfaces:**
- Consumes: Updated contracts from Task 2, updated DB functions from Task 1
- Produces: Handler that accepts/saves new fields

- [ ] **Step 1: Update handler to pass new fields to RPC**

The handler already passes the entire `fields` object to the RPC, so it should work automatically if the RPC is updated (Task 1).

- [ ] **Step 2: Update handler tests to verify new fields round-trip**

- [ ] **Step 3: Run handler tests**

Run: `pnpm --filter api test public-verification-settings`
Expected: All tests pass

---

### Task 8: Integration Tests and Full Build

**Files:**
- Modify: Various test files as needed
- Test: Full test suite, typecheck, lint, build

**Interfaces:**
- Consumes: All previous tasks
- Produces: Verified working system

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 4: Run build**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 5: Manual verification**

Start dev servers (`pnpm dev`), navigate to `/sale-team-search` and `/admin/settings/public-verification`, verify:
- IST and OST results look identical
- All new sections display correctly
- Admin settings save and reflect in public result
- Privacy Notice edit/preview works
- Copy buttons work
- Responsive layout works

---

### Task 9: Final Report

**Files:**
- None (documentation)

**Interfaces:**
- Consumes: All implementation results
- Produces: Final report per section 15 of spec

- [ ] **Step 1: Compile final report**

Sections A-J as specified in the task requirements.