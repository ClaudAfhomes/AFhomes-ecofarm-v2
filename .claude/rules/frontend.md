---
paths:
  - "apps/web/**"
  - "apps/admin/**"
  - "packages/ui/**"
---

# Frontend rules

- Stack: React 19 + Vite 8 + TanStack Query + CSS Modules + `@afhomes/ui`. No antd, Tailwind or shadcn here.
- All HTTP via `src/lib/api/client.ts` (`request`/`requestList`) validated by `@afhomes/contracts`. No ad-hoc `fetch`.
- Form controls from `@afhomes/ui` (`Select`, `TextField`, `DateField`…); optional fields show "(Optional)".
- Admin: query keys from `features/business/queryKeys.ts`; mutations via `useBusinessMutation`;
  live search via `useDebouncedValue`.
- Guards (`RequireRole`, `canViewModule`, `isFeaturePathEnabled`) are UX only — never the only control.
- Money/count display only via `@afhomes/shared` formatters; never concat `₱`.
- Admin staff times are browser-zone (`apps/admin/src/lib/format.ts`); business dates are Manila.
- Tests colocated `*.spec.tsx` with `renderWithProviders`; routes are lazy — use `findBy*`.
- Never stub global `URL` with a plain object.
