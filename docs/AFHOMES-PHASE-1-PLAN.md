# AF Homes Ecofarm v2 - Phase 1 plan

Status: implementation in progress (2026-09-26). This file is the AF Homes rebuild map; legacy JAD documents are reference material only.

## Current application structure

- `apps/web`: React 19/Vite public and authenticated web SPA.
- `apps/admin`: React 19/Vite operations SPA.
- `api`: Vercel REST functions and shared server-only authorization helpers.
- `packages/contracts`: shared Zod request/response contracts.
- `packages/config`, `packages/shared`, `packages/ui`: environment, framework-free utilities, and UI primitives.
- `supabase/migrations`: AF Homes-only migrations. Preserved JAD SQL is isolated in `supabase/legacy-jad-migrations` and must never be applied to the AF Homes project.

## Conversion map

Keep and adapt: application shells, Supabase sessions, API envelope/router, audit/RBAC patterns, Query clients, tables, filters, dialogs, status chips, loading/error/empty states.

Replace: JAD member registration with customer activation and separate OST registration; property catalog with card categories/plans; property sales with card sales; voucher redemption with points redemption; JAD referrals with the VD -> SSM -> SM -> OST genealogy.

Remove from AF Homes navigation/routes: property CMS, JAD public property data, JAD membership signup, vouchers, and all JAD seed identities/content. Website CMS stays disabled until backed by working APIs.

## Phase 1 schema

Organization: departments, roles, modules, role permissions, staff users/assignments, restrictive staff overrides, invitations.

Network: referral codes, OST applications, OST members with immutable approved placement.

Cards: categories, plans, customers, private identity-document metadata, card sales, payments, qualifications, memberships, commissions.

Governance: append-only audit events and private Storage buckets. Browser roles receive explicit SELECT-only grants where needed; all mutations use server-authorized APIs or narrowly scoped RPCs.

## Delivery phases

1. Database/RLS/storage/audit foundation and safe reference seed.
2. Server-side permissions, role builder, and staff invitations.
3. OST referral, registration review, members, and genealogy.
4. Card plans, customer intake, private documents, and card sales.
5. Database-backed dashboard shell and queues.
6. Lint, typecheck, tests, build, RLS invariant checks, and browser verification.

Later phases add atomic finance transitions, activation/points, commission withdrawal, POS/redemption, messaging, reports, and enabled website CMS.

## Environment variable names

Browser-safe: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (legacy fallback: `VITE_SUPABASE_ANON_KEY`), `VITE_API_BASE_URL`, `VITE_WEB_URL`, `VITE_ADMIN_URL`.

Server-only: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `AFHOMES_SUPERADMIN_EMAIL`, `AFHOMES_WEB_URL`, `AFHOMES_ADMIN_URL`, `EMAIL_FROM`, `RESEND_API_KEY`, `DOCUMENT_HASH_PEPPER`, and optional `OCR_PROVIDER_URL` / `OCR_PROVIDER_API_KEY`.

The first Super Admin is created by a server-controlled Supabase Auth invitation. No Super Admin password variable, seed password, or plaintext credential is permitted.

No secret values belong in source control or any `VITE_` variable.
