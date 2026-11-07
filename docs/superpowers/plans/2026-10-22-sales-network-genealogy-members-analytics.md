# Sales Network Genealogy, Members Directory, and Sales Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finalize the Sales Network module with three integrated improvements: (1) Interactive Genealogy hierarchy with member details, (2) Original flat Members directory, (3) Simple sales-performance analytics for IST team leaders and administrators.

**Architecture:** 
- Backend: Extend existing `analytics.ts` handler with new `/analytics/team-sales` endpoint family for role-scoped sales performance data. Reuse existing `scopedSales`, `currentTeam`, and genealogy visibility logic.
- Frontend: Modify `GenealogyDetailsPage.tsx` to add expandable descendant tree and Team Sales Activity section. Restore `MembersPage.tsx` to flat table (remove grouping). Reuse existing `MemberDetailDialog` and genealogy services.
- Contracts: Add new Zod schemas for team sales analytics response in `packages/contracts/src/schemas/analytics.ts`.

**Tech Stack:** React 19 + Vite 8, TanStack Query, TypeScript, Zod, existing AF Homes UI components, CSS Modules.

**Spec:** This plan implements the requirements in the user's task description.

## Global Constraints

- Preserve previous local genealogy authorization changes (`canAccessMemberDetail`, `getVisibleGenealogyIds`, `detailAuthorized` flag).
- Do not weaken RLS or existing permissions. Server remains security boundary.
- Use existing `card_sales.status = 'active'` as qualifying sale definition (per `QUALIFYING_SALE_STATUS` in analytics.ts).
- Preserve frozen historical sales attribution via `card_sale_hierarchy_snapshots`.
- Count distinct qualifying sale IDs once per scope. No double-counting.
- Exclude draft applications, unverified payments, cancelled/voided sales.
- Use UTC calendar windows (day/week/month/year) from existing `calendarWindow`.
- Default period: current month.
- Maintain existing AF Homes UI styling (CSS Modules, design tokens).
- No push, deploy, or live DB mutations.

## Review Focus

1. **Unauthorized analytics access** — Direct API requests with manipulated team IDs must return 403, not data from another team.
2. **Double-counting sales** — A sale attributed to both VD and SM must appear once in VD's team total and once in SM's team total, but admin's global view must not double-count.
3. **Zero-sales members excluded** — Members with zero qualifying sales must appear in "No Sales" list by joining against authorized roster, not only sellers with transactions.
4. **OST sales visibility** — OST must not see team-wide rankings or other members' performance; only their own sales.
5. **Historical seller transfers** — Sales must stay attributed to the team at time of sale (frozen snapshot), not reassigned to new team.

---

### Task 1: Add Team Sales Analytics Schemas to Contracts

**Files:**
- Modify: `packages/contracts/src/schemas/analytics.ts`

**Interfaces:**
- Produces: New Zod schemas `teamSalesMemberSchema`, `teamSalesAnalyticsSchema`, `teamSalesTeamSchema`, `teamSalesOverviewSchema`

- [ ] **Step 1: Add new schemas for team sales analytics**

```typescript
// Member sales performance within a team
export const teamSalesMemberSchema = z.object({
  staffId: z.string().uuid(),
  fullName: z.string(),
  role: hierarchyRoleSchema,
  status: genealogyStatusSchema,
  salesCount: z.number().int().nonnegative(),
  salesActivity: z.enum(['Top Seller', 'With Sales', 'Low Sales', 'No Sales']),
});

// Team sales analytics for a single team (VD/SSM/SM view)
export const teamSalesAnalyticsSchema = z.object({
  period: analyticsPeriodSchema,
  window: z.object({ from: z.string(), to: z.string(), timezone: z.literal('UTC') }),
  viewerStaffId: z.string().uuid(),
  viewerRole: z.string(),
  kpis: z.object({
    totalTeamSales: z.number().int().nonnegative(),
    membersWithSales: z.number().int().nonnegative(),
    membersNoSales: z.number().int().nonnegative(),
    topSellerCount: z.number().int().nonnegative(),
    participationRate: z.number().min(0).max(100),
  }),
  members: z.array(teamSalesMemberSchema),
});

// Team comparison for admin view
export const teamSalesTeamSchema = z.object({
  teamHead: z.object({
    staffId: z.string().uuid(),
    fullName: z.string(),
    role: hierarchyRoleSchema,
  }),
  memberCount: z.number().int().nonnegative(),
  totalSales: z.number().int().nonnegative(),
  membersWithSales: z.number().int().nonnegative(),
  membersNoSales: z.number().int().nonnegative(),
});

// Admin global overview
export const teamSalesOverviewSchema = z.object({
  period: analyticsPeriodSchema,
  window: z.object({ from: z.string(), to: z.string(), timezone: z.literal('UTC') }),
  totalSales: z.number().int().nonnegative(),
  totalEligibleSellers: z.number().int().nonnegative(),
  sellersWithSales: z.number().int().nonnegative(),
  sellersNoSales: z.number().int().nonnegative(),
  topTeam: teamSalesTeamSchema.nullable(),
  teams: z.array(teamSalesTeamSchema),
});
```

- [ ] **Step 2: Run typecheck to verify schemas compile**

Run: `pnpm typecheck`
Expected: PASS

---

### Task 2: Extend Analytics Handler with Team Sales Endpoint

**Files:**
- Modify: `api/_handlers/analytics.ts`

**Interfaces:**
- Consumes: `scopedSales`, `currentTeam`, `calendarWindow`, `QUALIFYING_SALE_STATUS` from same file
- Produces: New handler branches for `/analytics/team-sales` (single team) and `/analytics/team-sales/overview` (admin)

- [ ] **Step 1: Add helper function to compute member sales rankings**

```typescript
// Inside analytics.ts, after currentTeam function
async function teamSalesAnalytics(
  db: Db,
  principal: AfHomesPrincipal,
  period: AnalyticsPeriod,
  kind: ScopeKind,
): Promise<{ kpis: {...}; members: {...}[] }> {
  const { from, to } = calendarWindow(period);
  const scoped = await scopedSales(db, principal, kind);
  const team = await currentTeam(db, principal, kind);
  if (!team) return { kpis: {...}, members: [] };

  // Get all descendant staff IDs (authorized roster)
  const [relationships, staff, assignments, roles] = await Promise.all([
    rows(db, 'referral_relationships', 'subject_staff_id,upline_staff_id,is_active'),
    rows(db, 'staff_users', 'id,full_name,status'),
    rows(db, 'staff_role_assignments', 'staff_id,role_id'),
    rows(db, 'roles', 'id,slug'),
  ]);
  // Build descendant tree from principal.userId
  const children = new Map<string, string[]>();
  for (const edge of relationships.filter((r) => r.is_active === true)) {
    const parent = String(edge.upline_staff_id);
    children.set(parent, [...(children.get(parent) ?? []), String(edge.subject_staff_id)]);
  }
  const descendants: string[] = [];
  const queue = [...(children.get(principal.userId) ?? [])];
  const seen = new Set([principal.userId]);
  while (queue.length && descendants.length < 10_000) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    descendants.push(id);
    queue.push(...(children.get(id) ?? []));
  }

  // Role and status maps
  const roleById = new Map(roles.map((r) => [String(r.id), String(r.slug)]));
  const roleByStaff = new Map(assignments.map((a) => [String(a.staff_id), roleById.get(String(a.role_id)) ?? 'unknown']));
  const statusById = new Map(staff.map((s) => [String(s.id), String(s.status)]));
  const nameById = new Map(staff.map((s) => [String(s.id), String(s.full_name)]));

  // Filter period qualifying sales
  const periodSales = scoped.sales.filter((s) => 
    s.status === QUALIFYING_SALE_STATUS && inWindow(s.created_at, from, to)
  );

  // Count sales per seller (seller_staff_id or seller_ost_id)
  const salesBySeller = new Map<string, number>();
  for (const sale of periodSales) {
    const sellerId = String(sale.seller_staff_id ?? sale.seller_ost_id ?? '');
    if (sellerId) {
      salesBySeller.set(sellerId, (salesBySeller.get(sellerId) ?? 0) + 1);
    }
  }

  // Build member list with sales counts
  const members = descendants
    .filter((id) => SELLER_ROLES.has(roleByStaff.get(id) ?? ''))
    .map((id) => {
      const count = salesBySeller.get(id) ?? 0;
      let activity: 'Top Seller' | 'With Sales' | 'Low Sales' | 'No Sales' = 'No Sales';
      if (count > 0) activity = 'With Sales';
      return {
        staffId: id,
        fullName: nameById.get(id) ?? 'Unknown',
        role: roleByStaff.get(id) ?? 'unknown',
        status: statusById.get(id) ?? 'unknown',
        salesCount: count,
        salesActivity: activity,
      };
    });

  // Determine Top Seller and Low Sales
  const withSales = members.filter((m) => m.salesCount > 0).sort((a, b) => b.salesCount - a.salesCount);
  const topCount = withSales[0]?.salesCount ?? 0;
  for (const m of members) {
    if (m.salesCount === topCount && topCount > 0) m.salesActivity = 'Top Seller';
    else if (m.salesCount > 0 && m.salesCount < topCount) m.salesActivity = 'Low Sales';
  }

  const kpis = {
    totalTeamSales: periodSales.length,
    membersWithSales: withSales.length,
    membersNoSales: members.filter((m) => m.salesCount === 0).length,
    topSellerCount: topCount,
    participationRate: members.length > 0 ? (withSales.length / members.length) * 100 : 0,
  };

  return { kpis, members };
}
```

- [ ] **Step 2: Add admin team comparison function**

```typescript
async function teamSalesOverview(
  db: Db,
  principal: AfHomesPrincipal,
  period: AnalyticsPeriod,
): Promise<{ totalSales: number; totalEligibleSellers: number; sellersWithSales: number; sellersNoSales: number; topTeam: {...} | null; teams: {...}[] }> {
  const { from, to } = calendarWindow(period);
  const scoped = await scopedSales(db, principal, 'global');
  
  // Get all VDs (top-level heads)
  const [staff, assignments, roles, relationships] = await Promise.all([
    rows(db, 'staff_users', 'id,full_name,status'),
    rows(db, 'staff_role_assignments', 'staff_id,role_id'),
    rows(db, 'roles', 'id,slug'),
    rows(db, 'referral_relationships', 'subject_staff_id,upline_staff_id,is_active'),
  ]);
  
  const roleById = new Map(roles.map((r) => [String(r.id), String(r.slug)]));
  const roleByStaff = new Map(assignments.map((a) => [String(a.staff_id), roleById.get(String(a.role_id)) ?? 'unknown']));
  const statusById = new Map(staff.map((s) => [String(s.id), String(s.status)]));
  const nameById = new Map(staff.map((s) => [String(s.id), String(s.full_name)]));

  // Find VDs (vice_directors with no upline)
  const vdIds = staff
    .filter((s) => roleByStaff.get(String(s.id)) === 'vice_director')
    .map((s) => String(s.id));

  // Build descendant trees for each VD
  const children = new Map<string, string[]>();
  for (const edge of relationships.filter((r) => r.is_active === true)) {
    const parent = String(edge.upline_staff_id);
    children.set(parent, [...(children.get(parent) ?? []), String(edge.subject_staff_id)]);
  }

  const periodSales = scoped.sales.filter((s) => 
    s.status === QUALIFYING_SALE_STATUS && inWindow(s.created_at, from, to)
  );

  const salesBySeller = new Map<string, number>();
  for (const sale of periodSales) {
    const sellerId = String(sale.seller_staff_id ?? sale.seller_ost_id ?? '');
    if (sellerId) salesBySeller.set(sellerId, (salesBySeller.get(sellerId) ?? 0) + 1);
  }

  const teams = [];
  for (const vdId of vdIds) {
    const descendants: string[] = [];
    const queue = [...(children.get(vdId) ?? [])];
    const seen = new Set([vdId]);
    while (queue.length && descendants.length < 10_000) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (SELLER_ROLES.has(roleByStaff.get(id) ?? '')) descendants.push(id);
      queue.push(...(children.get(id) ?? []));
    }

    const teamSales = descendants.reduce((sum, id) => sum + (salesBySeller.get(id) ?? 0), 0);
    const withSales = descendants.filter((id) => (salesBySeller.get(id) ?? 0) > 0).length;
    const noSales = descendants.length - withSales;

    teams.push({
      teamHead: { staffId: vdId, fullName: nameById.get(vdId) ?? 'Unknown', role: 'vice_director' },
      memberCount: descendants.length,
      totalSales: teamSales,
      membersWithSales: withSales,
      membersNoSales: noSales,
    });
  }

  teams.sort((a, b) => b.totalSales - a.totalSales);
  const totalEligible = teams.reduce((sum, t) => sum + t.memberCount, 0);
  const sellersWithSales = teams.reduce((sum, t) => sum + t.membersWithSales, 0);
  const sellersNoSales = teams.reduce((sum, t) => sum + t.membersNoSales, 0);

  return {
    totalSales: periodSales.length,
    totalEligibleSellers: totalEligible,
    sellersWithSales,
    sellersNoSales,
    topTeam: teams[0] ?? null,
    teams,
  };
}
```

- [ ] **Step 3: Add handler branches in main handler**

```typescript
// In handler, after familyPath check
if (familyPath === 'team-sales') {
  // Single team view for VD/SSM/SM
  const parsed = analyticsPeriodSchema.safeParse(req.query.period ?? 'month');
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'period must be day, week, month, or year', 400);
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);
  const principal = await authorizeAfHomes(req, 'dashboard.view');
  if ('error' in principal) return deny(res, principal);
  const kind = roleScope(principal);
  if (kind !== 'team' && kind !== 'self') return fail(res, 'FORBIDDEN', 'Team sales view requires team or self scope', 403);
  const result = await teamSalesAnalytics(db, principal, parsed.data, kind);
  return res.status(200).json({ period: parsed.data, window: calendarWindow(parsed.data), viewerStaffId: principal.userId, viewerRole: principal.roleSlug, ...result });
}

if (familyPath === 'team-sales/overview') {
  // Admin global view
  const parsed = analyticsPeriodSchema.safeParse(req.query.period ?? 'month');
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'period must be day, week, month, or year', 400);
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);
  const principal = await authorizeAfHomes(req, 'dashboard.view');
  if ('error' in principal) return deny(res, principal);
  const kind = roleScope(principal);
  if (kind !== 'global' && kind !== 'finance') return fail(res, 'FORBIDDEN', 'Overview requires global or finance scope', 403);
  const result = await teamSalesOverview(db, principal, parsed.data);
  return res.status(200).json({ period: parsed.data, window: calendarWindow(parsed.data), ...result });
}
```

- [ ] **Step 4: Run API tests**

Run: `pnpm --filter api exec vitest run _handlers/analytics.spec.ts`
Expected: PASS (or add tests if missing)

---

### Task 3: Add Team Sales Analytics Service and Query Keys

**Files:**
- Modify: `apps/admin/src/features/genealogy/services.ts`
- Modify: `apps/admin/src/features/business/queryKeys.ts`

**Interfaces:**
- Consumes: `analyticsOverviewSchema`, `teamSalesAnalyticsSchema`, `teamSalesOverviewSchema` from contracts
- Produces: `getTeamSalesAnalytics(staffId, period)`, `getTeamSalesOverview(period)`, `teamSalesKeys`

- [ ] **Step 1: Add query keys for team sales**

```typescript
// In queryKeys.ts, genealogyKeys section
export const teamSalesKeys = {
  analytics: (staffId: string | undefined, period: string) => key('team-sales', staffId, period),
  overview: (period: string) => key('team-sales', 'overview', period),
};
```

- [ ] **Step 2: Add service functions**

```typescript
// In genealogy/services.ts
import { teamSalesAnalyticsSchema, teamSalesOverviewSchema, type AnalyticsPeriod } from '@afhomes/contracts';
import { protectedRequest as request } from '../../lib/api/client';

export const getTeamSalesAnalytics = (staffId: string, period: AnalyticsPeriod) =>
  request(`/analytics/team-sales?period=${encodeURIComponent(period)}`, teamSalesAnalyticsSchema);

export const getTeamSalesOverview = (period: AnalyticsPeriod) =>
  request(`/analytics/team-sales/overview?period=${encodeURIComponent(period)}`, teamSalesOverviewSchema);
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

---

### Task 4: Implement Genealogy Descendant Tree Component

**Files:**
- Create: `apps/admin/src/features/genealogy/GenealogyTree.tsx`
- Create: `apps/admin/src/features/genealogy/GenealogyTree.module.css`
- Modify: `apps/admin/src/features/genealogy/GenealogyDetailsPage.tsx`
- Modify: `apps/admin/src/features/genealogy/GenealogyDetailsPage.module.css`

**Interfaces:**
- Consumes: `getGenealogyDownline`, `genealogyNodeSchema`, `getMember` from network-members services, `MemberDetailDialog`
- Produces: `GenealogyTree` component with expand/collapse, click handlers

- [ ] **Step 1: Create GenealogyTree component**

```tsx
// GenealogyTree.tsx
import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { StatusChip } from '@afhomes/ui';
import { humanizeCode } from '../business/format';
import { getGenealogyDownline } from './services';
import { useQuery } from '@tanstack/react-query';
import { genealogyKeys } from '../business/queryKeys';
import { useSession } from '../../lib/session';
import { canAccessMemberDetail } from '../../app/navigation'; // or import from contracts/utils
import styles from './GenealogyTree.module.css';

interface GenealogyTreeProps {
  rootStaffId: string;
  viewerRole: string;
  viewerId: string;
  onMemberClick?: (member: GenealogyNode) => void;
}

export function GenealogyTree({ rootStaffId, viewerRole, viewerId, onMemberClick }: GenealogyTreeProps) {
  const { user } = useSession();
  const [expanded, setExpanded] = useState<Set<string>>(new Set([rootStaffId]));
  
  const query = useQuery({
    queryKey: genealogyKeys.downline(rootStaffId),
    queryFn: () => getGenealogyDownline(rootStaffId),
  });

  const nodes = query.data ?? [];
  
  // Build tree structure
  const childrenMap = useMemo(() => {
    const map = new Map<string, typeof nodes>();
    for (const node of nodes) {
      if (node.uplineStaffId) {
        map.set(node.uplineStaffId, [...(map.get(node.uplineStaffId) ?? []), node]);
      }
    }
    return map;
  }, [nodes]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderNode = (node: GenealogyNode, depth: number) => {
    const kids = childrenMap.get(node.staffId) ?? [];
    const isExpanded = expanded.has(node.staffId);
    const hasChildren = kids.length > 0;
    const clickable = viewerId === node.staffId || (onMemberClick && viewerRole !== 'ost');

    return (
      <div key={node.staffId} className={styles.nodeWrapper} style={{ paddingLeft: depth * 24 }}>
        <div 
          className={`${styles.nodeRow} ${clickable ? styles.clickable : ''}`}
          onClick={() => clickable && onMemberClick?.(node)}
        >
          {hasChildren && (
            <button 
              className={styles.expandBtn}
              onClick={(e) => { e.stopPropagation(); toggle(node.staffId); }}
              aria-expanded={isExpanded}
            >
              {isExpanded ? '▼' : '▶'}
            </button>
          )}
          <span className={styles.avatar} aria-hidden="true">
            {node.fullName.trim().charAt(0).toUpperCase() || '•'}
          </span>
          <span className={styles.name}>{node.fullName}</span>
          <StatusChip label={humanizeCode(node.role)} tone="neutral" />
          <StatusChip label={humanizeCode(node.ostStatus ?? node.status)} />
        </div>
        {isExpanded && hasChildren && (
          <div className={styles.children}>
            {kids.map((kid) => renderNode(kid, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (query.isPending) return <div className={styles.loading}>Loading team…</div>;
  if (query.isError) return <div className={styles.error}>Failed to load team</div>;

  const root = nodes.find((n) => n.staffId === rootStaffId);
  if (!root) return <div className={styles.error}>Root member not found</div>;

  return <div className={styles.tree}>{renderNode(root, 0)}</div>;
}
```

- [ ] **Step 2: Create CSS module for tree**

```css
/* GenealogyTree.module.css */
.tree { display: grid; gap: var(--space-1); }
.nodeWrapper { min-width: 0; }
.nodeRow { 
  display: flex; align-items: center; gap: var(--space-3); 
  padding: var(--space-2) var(--space-3); 
  border-radius: var(--radius-sm); 
  transition: background var(--transition-fast);
}
.nodeRow.clickable { cursor: pointer; }
.nodeRow.clickable:hover { background: var(--color-state-hover); }
.expandBtn { 
  width: 24px; height: 24px; flex: 0 0 auto; 
  border: none; background: transparent; color: var(--color-text-secondary);
  font-size: 12px; line-height: 1; cursor: pointer;
}
.avatar { 
  width: 28px; height: 28px; flex: 0 0 auto; border-radius: 50%; 
  background: linear-gradient(135deg, var(--color-brand-primary), var(--color-brand-secondary));
  color: #fff; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center;
}
.name { flex: 1 1 auto; font-weight: 500; overflow-wrap: anywhere; }
.children { display: grid; gap: var(--space-1); border-left: 2px solid var(--color-border-subtle); }
.loading, .error { padding: var(--space-4); color: var(--color-text-secondary); }
```

- [ ] **Step 3: Integrate tree into GenealogyDetailsPage**

```tsx
// In GenealogyDetailsPage.tsx, after Team Summary section
import { GenealogyTree } from './GenealogyTree';
import { getMember } from '../network-members/services';
import { MemberDetailDialog } from '../network-members/MemberDetailDialog';
import { useState } from 'react';

// Add state for member detail dialog
const [viewingMember, setViewingMember] = useState<GenealogyNode | null>(null);

// After Team Summary section, add:
<section className={styles.panel} aria-label="My Downline">
  <h2 className={styles.panelTitle}>My Downline</h2>
  <GenealogyTree 
    rootStaffId={staffId} 
    viewerRole={user?.roleSlug ?? ''} 
    viewerId={user?.id ?? ''}
    onMemberClick={setViewingMember}
  />
</section>

{viewingMember && (
  <MemberDetailDialog
    member={viewingMember}
    onClose={() => setViewingMember(null)}
    onChanged={() => { /* invalidate */ }}
  />
)}
```

- [ ] **Step 4: Run frontend tests**

Run: `pnpm --filter @afhomes/admin exec vitest run src/features/genealogy/`
Expected: PASS

---

### Task 5: Add Team Sales Activity Section to Genealogy Details Page

**Files:**
- Modify: `apps/admin/src/features/genealogy/GenealogyDetailsPage.tsx`
- Modify: `apps/admin/src/features/genealogy/GenealogyDetailsPage.module.css`

**Interfaces:**
- Consumes: `getTeamSalesAnalytics`, `teamSalesKeys`, `AnalyticsPeriod`
- Produces: Team Sales Activity section with KPI cards and ranked member table

- [ ] **Step 1: Add period selector and fetch team sales analytics**

```tsx
// In GenealogyDetailsPage.tsx
import { useState } from 'react';
import { AnalyticsPeriod } from '@afhomes/contracts';
import { getTeamSalesAnalytics, teamSalesKeys } from './services';
import { useQuery } from '@tanstack/react-query';
import { Select } from '@afhomes/ui';
import { formatCountOrDash } from '@afhomes/shared';

// Add period state
const [period, setPeriod] = useState<AnalyticsPeriod>('month');

// Fetch team sales analytics
const salesQuery = useQuery({
  queryKey: teamSalesKeys.analytics(staffId, period),
  queryFn: () => getTeamSalesAnalytics(staffId, period),
  placeholderData: keepPreviousData,
});
```

- [ ] **Step 2: Add Team Sales Activity section after My Downline**

```tsx
// After My Downline section
<section className={styles.panel} aria-label="Team sales activity">
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
    <h2 className={styles.panelTitle}>Team Sales Activity</h2>
    <Select
      aria-label="Reporting period"
      value={period}
      onChange={(e) => setPeriod(e.target.value as AnalyticsPeriod)}
      options={[
        { value: 'day', label: 'Today' },
        { value: 'week', label: 'This Week' },
        { value: 'month', label: 'This Month' },
        { value: 'year', label: 'This Year' },
      ]}
    />
  </div>

  {salesQuery.isPending ? (
    <div className={styles.salesLoading}>
      <Skeleton style={{ height: 120 }} />
      <Skeleton style={{ height: 200 }} />
    </div>
  ) : salesQuery.isError ? (
    <ErrorState error={salesQuery.error} title="Sales activity could not be loaded" onRetry={() => void salesQuery.refetch()} />
  ) : (
    <>
      {/* KPI Cards */}
      <div className={styles.kpiGrid}>
        <article className={styles.kpiCard}>
          <dt>Total Sales</dt>
          <dd>{formatCountOrDash(salesQuery.data.kpis.totalTeamSales)}</dd>
        </article>
        <article className={styles.kpiCard}>
          <dt>Members With Sales</dt>
          <dd>{formatCountOrDash(salesQuery.data.kpis.membersWithSales)}</dd>
        </article>
        <article className={styles.kpiCard}>
          <dt>No Sales</dt>
          <dd>{formatCountOrDash(salesQuery.data.kpis.membersNoSales)}</dd>
        </article>
        <article className={styles.kpiCard}>
          <dt>Top Seller</dt>
          <dd>{formatCountOrDash(salesQuery.data.kpis.topSellerCount)}</dd>
        </article>
        <article className={styles.kpiCard}>
          <dt>Participation</dt>
          <dd>{salesQuery.data.kpis.participationRate.toFixed(1)}%</dd>
        </article>
      </div>

      {/* Ranked Member Table */}
      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              <th style={{ textAlign: 'right' }}>Sales</th>
              <th>Activity</th>
            </tr>
          </thead>
          <tbody>
            {salesQuery.data.members
              .sort((a, b) => b.salesCount - a.salesCount)
              .map((member) => (
                <tr key={member.staffId}>
                  <td>
                    <span className={styles.memberName}>
                      {member.fullName}
                      {member.staffId === user?.id && <span className={styles.youBadge}>(You)</span>}
                    </span>
                  </td>
                  <td><StatusChip label={humanizeCode(member.role)} tone="neutral" /></td>
                  <td style={{ textAlign: 'right' }}>{formatCountOrDash(member.salesCount)}</td>
                  <td>
                    <StatusChip 
                      label={member.salesActivity} 
                      tone={
                        member.salesActivity === 'Top Seller' ? 'success' :
                        member.salesActivity === 'With Sales' ? 'info' :
                        member.salesActivity === 'Low Sales' ? 'warning' : 'neutral'
                      } 
                    />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <p className={styles.periodNote}>
        Reporting period: {salesQuery.data.window.from.slice(0, 10)} to {salesQuery.data.window.to.slice(0, 10)} (UTC)
      </p>
    </>
  )}
</section>
```

- [ ] **Step 3: Add CSS for KPI grid and table**

```css
/* In GenealogyDetailsPage.module.css */
.kpiGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}
.kpiCard {
  padding: var(--space-3);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  background: var(--color-bg-surface);
  display: grid;
  gap: var(--space-1);
}
.kpiCard dt { font-size: var(--text-caption); color: var(--color-text-secondary); }
.kpiCard dd { margin: 0; font-size: var(--text-h3); font-variant-numeric: tabular-nums; }
.tableWrap { overflow-x: auto; }
.tableWrap table { width: 100%; border-collapse: collapse; }
.tableWrap th, .tableWrap td { padding: var(--space-2) var(--space-3); text-align: left; border-bottom: 1px solid var(--color-border-subtle); }
.tableWrap th { font-size: var(--text-caption); text-transform: uppercase; color: var(--color-text-secondary); }
.memberName { display: flex; align-items: center; gap: var(--space-2); font-weight: 500; }
.youBadge { font-size: var(--text-caption); color: var(--color-brand-primary); font-weight: 600; }
.salesLoading { display: grid; gap: var(--space-3); }
.periodNote { margin: var(--space-3) 0 0; font-size: var(--text-body-s); color: var(--color-text-secondary); }
```

- [ ] **Step 4: Run frontend tests**

Run: `pnpm --filter @afhomes/admin exec vitest run src/features/genealogy/`
Expected: PASS

---

### Task 6: Add Admin Global Team Sales Analytics to Genealogy Page

**Files:**
- Modify: `apps/admin/src/features/genealogy/GenealogyPage.tsx`
- Modify: `apps/admin/src/features/genealogy/GenealogyPage.module.css`
- Modify: `apps/admin/src/features/genealogy/services.ts`

**Interfaces:**
- Consumes: `getTeamSalesOverview`, `teamSalesKeys`, `teamSalesOverviewSchema`
- Produces: Team Sales Activity section on Genealogy page for admin roles

- [ ] **Step 1: Add service function**

```typescript
// In genealogy/services.ts
export const getTeamSalesOverview = (period: AnalyticsPeriod) =>
  request(`/analytics/team-sales/overview?period=${encodeURIComponent(period)}`, teamSalesOverviewSchema);
```

- [ ] **Step 2: Add admin-only Team Sales Activity section to GenealogyPage**

```tsx
// In GenealogyPage.tsx
import { useState } from 'react';
import { getTeamSalesOverview, teamSalesKeys } from './services';
import { useQuery } from '@tanstack/react-query';
import { Select, StatusChip } from '@afhomes/ui';
import { formatCountOrDash } from '@afhomes/shared';
import { useSession } from '../../lib/session';

const { user } = useSession();
const [period, setPeriod] = useState<AnalyticsPeriod>('month');

const overviewQuery = useQuery({
  queryKey: teamSalesKeys.overview(period),
  queryFn: () => getTeamSalesOverview(period),
  enabled: user?.roleSlug === 'admin' || user?.roleSlug === 'super_admin',
  placeholderData: keepPreviousData,
});

// After filter bar, add:
{overviewQuery.data && (
  <section className={styles.adminSalesSection} aria-label="Global team sales analytics">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
      <h2>Team Sales Activity</h2>
      <Select
        aria-label="Reporting period"
        value={period}
        onChange={(e) => setPeriod(e.target.value as AnalyticsPeriod)}
        options={[
          { value: 'day', label: 'Today' },
          { value: 'week', label: 'This Week' },
          { value: 'month', label: 'This Month' },
          { value: 'year', label: 'This Year' },
        ]}
      />
    </div>

    <div className={styles.adminKpiGrid}>
      <article className={styles.kpiCard}><dt>Total Sales</dt><dd>{formatCountOrDash(overviewQuery.data.totalSales)}</dd></article>
      <article className={styles.kpiCard}><dt>Eligible Sellers</dt><dd>{formatCountOrDash(overviewQuery.data.totalEligibleSellers)}</dd></article>
      <article className={styles.kpiCard}><dt>With Sales</dt><dd>{formatCountOrDash(overviewQuery.data.sellersWithSales)}</dd></article>
      <article className={styles.kpiCard}><dt>No Sales</dt><dd>{formatCountOrDash(overviewQuery.data.sellersNoSales)}</dd></article>
    </div>

    <div className={styles.tableWrap}>
      <table>
        <thead>
          <tr>
            <th>Team Head</th>
            <th>Members</th>
            <th style={{ textAlign: 'right' }}>Total Sales</th>
            <th style={{ textAlign: 'right' }}>With Sales</th>
            <th style={{ textAlign: 'right' }}>No Sales</th>
          </tr>
        </thead>
        <tbody>
          {overviewQuery.data.teams.map((team) => (
            <tr key={team.teamHead.staffId}>
              <td>
                <Link to={`/admin/genealogy/${team.teamHead.staffId}`} className={styles.teamLink}>
                  {team.teamHead.fullName}
                </Link>
              </td>
              <td>{formatCountOrDash(team.memberCount)}</td>
              <td style={{ textAlign: 'right' }}>{formatCountOrDash(team.totalSales)}</td>
              <td style={{ textAlign: 'right' }}>{formatCountOrDash(team.membersWithSales)}</td>
              <td style={{ textAlign: 'right' }}>{formatCountOrDash(team.membersNoSales)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>
)}
```

- [ ] **Step 3: Add CSS**

```css
/* In GenealogyPage.module.css */
.adminSalesSection { margin-top: var(--space-6); padding-top: var(--space-4); border-top: 1px solid var(--color-border-default); }
.adminKpiGrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: var(--space-3); margin-bottom: var(--space-4); }
.adminKpiCard .kpiCard { padding: var(--space-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-md); background: var(--color-bg-surface); display: grid; gap: var(--space-1); }
.adminKpiCard dt { font-size: var(--text-caption); color: var(--color-text-secondary); }
.adminKpiCard dd { margin: 0; font-size: var(--text-h3); font-variant-numeric: tabular-nums; }
.teamLink { font-weight: 600; color: var(--color-brand-primary); text-decoration: none; }
.teamLink:hover { text-decoration: underline; }
```

- [ ] **Step 4: Run frontend tests**

Run: `pnpm --filter @afhomes/admin exec vitest run src/features/genealogy/`
Expected: PASS

---

### Task 7: Restore Members Page to Flat Directory

**Files:**
- Modify: `apps/admin/src/features/network-members/MembersPage.tsx`
- Modify: `apps/admin/src/features/network-members/MembersPage.module.css`

**Interfaces:**
- Consumes: `getMembers`, `networkMemberKeys`, `MemberDetailDialog`, etc.
- Produces: Flat table without grouping

- [ ] **Step 1: Remove grouping logic**

```tsx
// In MembersPage.tsx, remove:
// - groups useMemo (lines 81-93)
// - isClickable function (lines 95-97) - keep for row clickable logic
// - groups.flatMap in render (lines 249-305)

// Replace with flat mapping:
const active = rows.filter((member) => member.status === 'active').length;
const filtersActive = search !== '' || position !== 'all';
const rangeStart = rows.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
const rangeEnd = Math.min((safePage + 1) * PAGE_SIZE, rows.length);

// In render, replace TableBody with:
<TableBody>
  {visible.map((member) => {
    const clickable = member.detailAuthorized === true;
    return (
      <TableRow
        key={member.id}
        className={`${styles.clickable} ${clickable ? '' : styles.nonClickable}`}
        onClick={clickable ? () => setViewingId(member.id) : undefined}
        aria-disabled={!clickable}
        tabIndex={clickable ? 0 : -1}
      >
        <TableCell label="Code">...</TableCell>
        <TableCell label="Name">...</TableCell>
        <TableCell label="Position">...</TableCell>
        <TableCell label="AA Number">...</TableCell>
        <TableCell label="Status">...</TableCell>
        <TableCell label="Added">{formatDateTime(member.createdAt)}</TableCell>
      </TableRow>
    );
  })}
</TableBody>
```

- [ ] **Step 2: Remove group-specific CSS**

```css
/* In MembersPage.module.css, remove:
.groupHeader { ... }
.groupLabel { ... }
*/
/* Keep: .clickable, .nonClickable, .codeChip, .identityCell, etc. */
```

- [ ] **Step 3: Update description text**

```tsx
// Change PageHeader description from "Hierarchy sellers (IST) and OSTs with their heads." 
// to "Sales-network members. Click a row to view details."
```

- [ ] **Step 4: Run frontend tests**

Run: `pnpm --filter @afhomes/admin exec vitest run src/features/network-members/`
Expected: PASS (update test mocks if needed)

---

### Task 8: Add Backend Tests for Team Sales Analytics

**Files:**
- Create: `api/_handlers/analytics.team-sales.spec.ts` (or add to existing analytics tests)

**Interfaces:**
- Consumes: FakeSupabase, handler functions
- Produces: Tests for `/analytics/team-sales` and `/analytics/team-sales/overview`

- [ ] **Step 1: Write tests for VD team sales**

```typescript
// Test VD sees their complete downline sales with correct counts
// Test SSM sees only their downline
// Test SM sees only OST descendants
// Test OST sees only own sales
// Test Admin sees all teams
// Test period filtering (day/week/month/year)
// Test qualifying sale status filtering (only 'active')
// Test zero-sales members included in roster
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter api exec vitest run _handlers/analytics.team-sales.spec.ts`
Expected: PASS

---

### Task 9: Add Frontend Tests for Genealogy Tree and Sales Activity

**Files:**
- Create: `apps/admin/src/features/genealogy/GenealogyTree.spec.tsx`
- Modify: `apps/admin/src/features/genealogy/GenealogyDetailsPage.spec.tsx`

**Interfaces:**
- Consumes: Mocked `getGenealogyDownline`, `getTeamSalesAnalytics`
- Produces: Tests for tree rendering, expand/collapse, member click, sales activity display

- [ ] **Step 1: Write GenealogyTree tests**

```typescript
// Test tree renders root node
// Test expand/collapse toggles children
// Test member click opens MemberDetailDialog
// Test OST cannot click other members
// Test depth styling
```

- [ ] **Step 2: Write GenealogyDetailsPage sales activity tests**

```typescript
// Test KPI cards show correct values
// Test member table sorts by sales descending
// Test period selector refetches
// Test activity labels (Top Seller, With Sales, Low Sales, No Sales)
// Test zero-sales members appear in table
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @afhomes/admin exec vitest run src/features/genealogy/`
Expected: PASS

---

### Task 10: Add Frontend Tests for Members Page Restoration

**Files:**
- Modify: `apps/admin/src/features/network-members/MembersPage.spec.tsx`

**Interfaces:**
- Consumes: Mocked `getMembers`
- Produces: Tests for flat table, no groups, search, filters, pagination

- [ ] **Step 1: Update existing tests to expect flat table**

```typescript
// Test no "Under [Name]" or "Top Level" group headers
// Test single continuous table body
// Test row count matches member count
// Test search/filter/pagination still work
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @afhomes/admin exec vitest run src/features/network-members/MembersPage.spec.tsx`
Expected: PASS

---

### Task 11: Run Full Verification

**Files:** All modified files

- [ ] **Step 1: Run all API tests**

Run: `pnpm --filter api exec vitest run`
Expected: All PASS

- [ ] **Step 2: Run all Admin frontend tests**

Run: `pnpm --filter @afhomes/admin exec vitest run`
Expected: All PASS (pre-existing flaky tests may fail - document)

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: PASS (warnings OK)

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Verify genealogy authorization tests still pass**

Run: `pnpm --filter api exec vitest run _lib/genealogy-visibility.spec.ts`
Expected: 30/30 PASS

---

## Implementation Order Summary

1. **Contracts** - Add schemas (foundation)
2. **Backend** - Analytics handler extensions (core logic)
3. **Services** - Frontend API clients and query keys
4. **Genealogy Tree** - Reusable tree component
5. **Genealogy Details** - Integrate tree + sales activity
6. **Admin Genealogy** - Add global team analytics
7. **Members Page** - Remove grouping, restore flat table
8. **Tests** - Backend + frontend for new features
9. **Verification** - Full test suite, lint, typecheck

This plan preserves all previous authorization work, reuses existing components and services, and adds only what's necessary for the three improvements.