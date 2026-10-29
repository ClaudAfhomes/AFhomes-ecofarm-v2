// Existing catalog response and visibility rules, preserved from source handlers.
import type { VercelRequest } from './http.js';
import { isoOrNull } from './handler-kit.js';

// MongoDB has no PostgreSQL column defaults; retain them for new plans and prospective snapshots.
export const PLAN_BENEFIT_DEFAULTS = {
  discount_percent: 0, base_validity_years: 1, validity_extension_years: 0,
  cardholder_limit: 1, annual_points_tranches: 1, total_loyalty_value: '0.00',
  priority_reservation: false, no_monthly_annual_dues: false,
};

export const toProduct = (
  row: Record<string, unknown>,
  categories: Map<string, { name: string | null; isActive: boolean }>,
) => {
  const category = categories.get(String(row.category_id ?? ''));
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: category?.name ?? null,
    categoryIsActive: category?.isActive ?? false,
    code: row.code,
    name: row.name,
    description: (row.description as string | null | undefined) ?? null,
    cashPrice: row.cash_price,
    installmentPrice: (row.installment_price as string | null | undefined) ?? '0.00',
    reservationFee: (row.reservation_fee as string | null | undefined) ?? '10000.00',
    spotCashDays:
      row.spot_cash_days === null || row.spot_cash_days === undefined
        ? 7
        : Number(row.spot_cash_days),
    standardInstallmentMonths:
      row.standard_installment_months === null || row.standard_installment_months === undefined
        ? 4
        : Number(row.standard_installment_months),
    validityYears:
      row.validity_years === null || row.validity_years === undefined
        ? 1
        : Number(row.validity_years),
    moveAEnabled: (row.move_a_enabled as boolean | null | undefined) ?? true,
    moveB1Enabled: (row.move_b1_enabled as boolean | null | undefined) ?? true,
    moveB2Enabled: (row.move_b2_enabled as boolean | null | undefined) ?? true,
    minimumDownPayment: row.minimum_down_payment,
    yearlyPoints: row.yearly_points,
    discountPercent: Number(row.discount_percent ?? 0),
    baseValidityYears: Number(row.base_validity_years ?? row.validity_years ?? 1),
    validityExtensionYears: Number(row.validity_extension_years ?? 0),
    cardholderLimit: Number(row.cardholder_limit ?? 1),
    annualPointsTranches: Number(row.annual_points_tranches ?? 1),
    totalLoyaltyValue: (row.total_loyalty_value as string | null | undefined) ?? '0.00',
    priorityReservation: row.priority_reservation === true,
    noMonthlyAnnualDues: row.no_monthly_annual_dues === true,
    commissionRate: row.commission_rate,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    createdAt: isoOrNull(row.created_at) ?? '',
    updatedAt: isoOrNull(row.updated_at) ?? '',
  };
};

type PlanVisibility = 'active' | 'inactive' | 'all';

/**
 * Permission-aware visibility. Catalogue management is a Super Admin (and
 * update-granted Admin) concern; every other role only ever sees the active
 * catalogue it may sell from. The legacy `?includeInactive=true` flag keeps
 * working for the Super Admin.
 */
export function planVisibility(req: VercelRequest, roleSlug: string): PlanVisibility {
  if (roleSlug !== 'super_admin') return 'active';
  const query = (req.query ?? {}) as Record<string, unknown>;
  const active = String(query.active ?? '').toLowerCase();
  if (active === 'false' || active === 'inactive') return 'inactive';
  if (active === 'all' || String(query.includeInactive ?? '') === 'true') return 'all';
  return 'active';
}

export function applyPlanFilters(
  rows: Record<string, unknown>[],
  categories: Map<string, { name: string | null; isActive: boolean }>,
  visibility: PlanVisibility,
  search: string,
  roleSlug: string,
): Record<string, unknown>[] {
  // A plan is selectable for a NEW application only when the plan itself is
  // active AND its category is active. Non-privileged roles never see an
  // ineligible plan; the Super Admin sees the full catalogue for management
  // unless they explicitly ask for the sellable view.
  const eligible = (row: Record<string, unknown>) =>
    row.is_active === true && (categories.get(String(row.category_id))?.isActive ?? false);
  const byVisibility =
    visibility === 'all'
      ? rows
      : rows.filter((row) => (visibility === 'active' ? eligible(row) : row.is_active !== true));
  const visible =
    roleSlug === 'super_admin' ? byVisibility : byVisibility.filter((row) => eligible(row));
  const needle = search.trim().toLowerCase();
  if (!needle) return visible;
  return visible.filter((row) =>
    `${String(row.code ?? '')} ${String(row.name ?? '')}`.toLowerCase().includes(needle),
  );
}

export const toCategory = (row: Record<string, unknown>, planCount?: number) => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  description: (row.description as string | null | undefined) ?? null,
  isActive: row.is_active,
  sortOrder: row.sort_order,
  ...(planCount === undefined ? {} : { planCount }),
});

type CategoryVisibility = 'active' | 'inactive' | 'all';

/** Same permission-aware rule as the plan catalogue: management sees more. */
export function categoryVisibility(req: VercelRequest, roleSlug: string): CategoryVisibility {
  if (roleSlug !== 'super_admin') return 'active';
  const query = (req.query ?? {}) as Record<string, unknown>;
  const active = String(query.active ?? '').toLowerCase();
  if (active === 'false' || active === 'inactive') return 'inactive';
  if (active === 'all' || String(query.includeInactive ?? '') === 'true') return 'all';
  return 'active';
}

export function applyCategoryFilters(
  rows: Record<string, unknown>[],
  visibility: CategoryVisibility,
  search: string,
): Record<string, unknown>[] {
  const visible =
    visibility === 'all'
      ? rows
      : rows.filter((row) =>
          visibility === 'active' ? row.is_active === true : row.is_active !== true,
        );
  const needle = search.trim().toLowerCase();
  if (!needle) return visible;
  return visible.filter((row) =>
    `${String(row.slug ?? '')} ${String(row.name ?? '')}`.toLowerCase().includes(needle),
  );
}
