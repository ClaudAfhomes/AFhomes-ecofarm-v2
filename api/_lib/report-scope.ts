/**
 * Phase 15 report scoping - the same effective-authorization model Phase 14
 * analytics uses, factored so every report reuses it instead of re-deriving it.
 *
 * Kinds (identical to analytics `roleScope`):
 *   global     super_admin, admin ............ every row
 *   finance    finance ....................... every row (only on reports whose
 *                                              module the role holds)
 *   team       vice_director, senior_sales_manager, sales_manager ..
 *              historical rows attributed through the IMMUTABLE
 *              `card_sale_hierarchy_snapshots` captured at sale time - never
 *              re-derived from the current genealogy
 *   self       ost ........................... rows the caller sold/sponsored
 *   redemption anyone else with a report grant (employee) ..
 *              only their own redemption rows
 *
 * The permission gate (which module key a report needs) runs first, inside the
 * handler. These helpers only narrow rows for callers that already passed it.
 */

import type { AfHomesPrincipal } from './afhomes-access.js';
import type { Db } from './handler-kit.js';

export type ReportScopeKind = 'global' | 'finance' | 'team' | 'self' | 'redemption';

type Row = Record<string, unknown>;

export function reportScopeKind(principal: AfHomesPrincipal): ReportScopeKind {
  if (principal.roleSlug === 'super_admin' || principal.roleSlug === 'admin') return 'global';
  if (principal.roleSlug === 'finance') return 'finance';
  if (['vice_director', 'senior_sales_manager', 'sales_manager'].includes(principal.roleSlug))
    return 'team';
  if (principal.roleSlug === 'ost') return 'self';
  return 'redemption';
}

export function scopeLabel(kind: ReportScopeKind, principal: AfHomesPrincipal): string {
  if (kind === 'global') return `Global (${principal.roleSlug})`;
  if (kind === 'finance') return 'Finance (all records)';
  if (kind === 'team') return `Team scope (${principal.roleSlug})`;
  if (kind === 'self') return 'Own records only';
  return 'Own redemption activity only';
}

/**
 * Historical sale ids attributed to a team seller through the frozen
 * hierarchy snapshots. `null` means "every sale" (global/finance). An empty
 * array means "attributed to nothing" - which is a real answer, not an error:
 * a seller with no attributed sales sees an empty report, never someone
 * else's rows.
 */
export async function scopedSaleIds(
  db: Db,
  principal: AfHomesPrincipal,
  kind: ReportScopeKind,
): Promise<string[] | null> {
  if (kind === 'global' || kind === 'finance') return null;
  if (kind === 'self') {
    const { data, error } = await db
      .from('card_sales')
      .select('id')
      .or(`seller_staff_id.eq.${principal.userId},seller_ost_id.eq.${principal.userId}`);
    if (error) throw error;
    return ((data ?? []) as Row[]).map((row) => String(row.id));
  }
  if (kind === 'team') {
    const { data, error } = await db
      .from('card_sale_hierarchy_snapshots')
      .select('sale_id')
      .eq('ancestor_staff_id', principal.userId);
    if (error) throw error;
    return [...new Set(((data ?? []) as Row[]).map((row) => String(row.sale_id)))];
  }
  return [];
}

/** Staff ids in the caller's current downline (self + active descendants). */
export async function teamStaffIds(db: Db, principal: AfHomesPrincipal): Promise<string[]> {
  const { data, error } = await db
    .from('referral_relationships')
    .select('subject_staff_id,upline_staff_id')
    .eq('is_active', true);
  if (error) throw error;
  const children = new Map<string, string[]>();
  for (const edge of ((data ?? []) as Row[]).filter((row) => row.upline_staff_id)) {
    const parent = String(edge.upline_staff_id);
    children.set(parent, [...(children.get(parent) ?? []), String(edge.subject_staff_id)]);
  }
  const out = new Set<string>([principal.userId]);
  const queue = [...(children.get(principal.userId) ?? [])];
  while (queue.length && out.size < 10_000) {
    const id = queue.shift()!;
    if (out.has(id)) continue;
    out.add(id);
    queue.push(...(children.get(id) ?? []));
  }
  return [...out];
}

/** Exact-decimal money total over exact-decimal strings (BigInt cents, no floats). */
export function sumMoney(values: unknown[]): string {
  let total = 0n;
  for (const value of values) {
    const match = String(value ?? '0').match(/^(\d+)(?:\.(\d{1,2}))?$/);
    if (match) total += BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  }
  return `${total / 100n}.${String(total % 100n).padStart(2, '0')}`;
}

/** True when an ISO timestamp falls inside [from, to]. Null bounds are open. */
export function inReportWindow(value: unknown, from: string | null, to: string | null): boolean {
  if (!from && !to) return true;
  const time = new Date(String(value ?? '')).valueOf();
  if (!Number.isFinite(time)) return false;
  if (from && time < new Date(from).valueOf()) return false;
  // `to` is an inclusive end: a date-only upper bound covers its whole day.
  if (to && time > new Date(to).valueOf()) return false;
  return true;
}

/**
 * Normalize `?from=&to=` into an inclusive ISO window. Date-only bounds are
 * expanded to the full UTC day. Returns nulls when the side is absent.
 * Throws on an unparseable bound so the handler can answer 400.
 */
export function parseReportWindow(
  fromRaw: string | undefined,
  toRaw: string | undefined,
): { from: string | null; to: string | null } {
  const expand = (raw: string, end: boolean) => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return end ? `${trimmed}T23:59:59.999Z` : `${trimmed}T00:00:00.000Z`;
    }
    const time = new Date(trimmed).valueOf();
    if (!Number.isFinite(time)) throw new Error(`Invalid date: ${raw}`);
    return new Date(time).toISOString();
  };
  return { from: fromRaw ? expand(fromRaw, false) : null, to: toRaw ? expand(toRaw, true) : null };
}
