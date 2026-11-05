---
name: afhomes-frontend
description: Implement or fix UI in the AF Homes V2 React/Vite apps (apps/admin staff console, apps/web public site and customer/OST portals) using existing @afhomes/ui primitives, contracts and query patterns. Use for screens, forms, navigation and UI tests.
---

# Frontend (V2 primary repo)

## Detect first
This repo: React 19, Vite 8, TanStack Query 5, CSS Modules, `@afhomes/ui`. **Not** Ant Design —
antd + regular CSS belongs only to the separate `orlando-afhomes/afhomes-platform` prototype.

## Where
- Admin features: `apps/admin/src/features/<area>/`; routes `apps/admin/src/app/App.tsx` (lazy);
  nav/permissions `apps/admin/src/app/navigation.ts`.
- Web: `apps/web/src/features/{customer,ost,...}`, marketing `apps/web/src/marketing/`.
- API client: `apps/<app>/src/lib/api/client.ts`; normalization `apps/admin/src/lib/normalize.ts`.
- Feature paths: `isFeaturePathEnabled` from `@afhomes/shared`.

## Procedure
1. Find the nearest existing screen/component and copy its patterns (`rg --files apps/admin/src/features/<area>`).
2. Reuse contract types from `@afhomes/contracts`; never redeclare.
3. Validation/normalization from shared input rules (`packages/contracts/src/schemas/input.ts`).
4. Permission-aware nav: `canViewModule`/`navItemsForPermissions`; server still enforces.
5. Spec: `pnpm --filter @afhomes/admin exec vitest run <file>`; typecheck the app.
6. Check ~400px width and keyboard/labels for accessibility.

## Never
Switch framework/UI library, add Tailwind/antd here, put business rules in components,
or enable disabled module routes.
