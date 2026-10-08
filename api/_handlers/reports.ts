import { matchesSearch, readSearchRows } from '../_lib/list-search.js';
/**
 * Phase 15 Reports and Audit Center.
 *
 * One handler, eleven read-only routes (`sales customers payments memberships
 * commissions redemptions genealogy ost points plans`, plus `audit`). Every
 * route is a scoped server-side query: the permission gate runs first, the
 * Phase 14 scope model (`api/_lib/report-scope.ts`) narrows rows second, and
 * the browser only renders what comes back.
 *
 * Exports (`?format=csv|xlsx|pdf`) run the SAME scoped query as the screen
 * and return the file as base64-in-JSON (see contracts/reports.ts for why).
 * A result larger than REPORT_EXPORT_CAP is refused with EXPORT_TOO_LARGE -
 * exports are never silently truncated.
 *
 * Export/audit policy (spec §W): report reads and exports do NOT write
 * REPORT_EXPORTED audit rows. An export-heavy finance workflow would flood
 * the append-only audit trail with one row per download, burying the
 * governance events the trail exists for. Reads stay reads.
 */

import {
  REPORT_EXPORT_CAP,
  auditQuerySchema,
  paymentSchemeLabel,
  reportExportSchema,
  reportQuerySchema,
  reportResponseSchema,
  reportTypeSchema,
  type ReportType,
} from '@afhomes/contracts';

import { authorizeAfHomes, type AfHomesPrincipal } from '../_lib/afhomes-access.js';
import { auditSummary, maskEmail, maskPhone, sanitizeAuditValue } from '../_lib/audit-sanitize.js';
import { deny, fail, isoOrNull, type Db, method, subPath } from '../_lib/handler-kit.js';
import { PDF_MAX_ROWS, toCsv, toPdf, toXlsx, type XlsxColumn } from '../_lib/report-export.js';
import {
  inReportWindow,
  parseReportWindow,
  reportScopeKind,
  scopeLabel,
  scopedSaleIds,
  sumMoney,
  teamStaffIds,
  type ReportScopeKind,
} from '../_lib/report-scope.js';
import { serviceClient } from '../_lib/rest.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

type Row = Record<string, unknown>;

type Column = XlsxColumn & { key: string };

type ReportData = {
  rows: Row[];
  total: number;
  summary: Record<string, unknown>;
  columns: Column[];
  summaryLines: string[];
};

const centsOf = (value: unknown): bigint => {
  const match = String(value ?? '0').match(/^(-)?(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return 0n;
  const cents = BigInt(match[2]!) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return match[1] ? -cents : cents;
};

const moneyOf = (cents: bigint): string => {
  const abs = cents < 0n ? -cents : cents;
  return `${cents < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
};

const diffMoney = (a: unknown, b: unknown): string => moneyOf(centsOf(a) - centsOf(b));

const displayName = (row: Row): string =>
  [row.first_name, row.middle_name, row.last_name, row.suffix]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ') || 'Unknown';

const pickDate = (row: Row, ...cols: string[]): string | null => {
  for (const col of cols) {
    const value = isoOrNull(row[col]);
    if (value) return value;
  }
  return null;
};

/* ------------------------------------------------------------------ */
/* Authorization: which module key guards which report                 */
/* ------------------------------------------------------------------ */

const REPORT_MODULES: Record<ReportType, { keys: string[]; action?: 'view' }> = {
  sales: { keys: ['sales.card_sales'] },
  customers: { keys: ['sales.customers'] },
  payments: { keys: ['finance.payment_verification'] },
  memberships: { keys: ['finance.card_activation', 'operations.redemption', 'sales.customers'] },
  commissions: { keys: ['network.commissions', 'finance.commission_payouts'] },
  redemptions: { keys: ['operations.redemption'] },
  genealogy: { keys: ['network.genealogy'] },
  ost: { keys: ['network.ost_registrations', 'network.ost_members'] },
  points: { keys: ['finance.points'] },
  plans: { keys: ['sales.card_plans'] },
};

async function authorizeReport(
  req: VercelRequest,
  report: ReportType,
): Promise<
  AfHomesPrincipal | { error: { error: { code: string; message: string }; status: number } }
> {
  let last:
    | AfHomesPrincipal
    | { error: { error: { code: string; message: string }; status: number } }
    | null = null;
  for (const key of REPORT_MODULES[report].keys) {
    // Sequential attempts, never `a ?? b`: both results are truthy objects,
    // so `??` would keep only the first module and silently deny the rest.
    const result = await authorizeAfHomes(req, key as never);
    if (!('error' in result)) {
      if (result.roleSlug === 'employee' && report !== 'redemptions')
        return {
          error: {
            status: 403,
            error: {
              code: 'FORBIDDEN',
              message: 'Employees may only access their handled redemption report',
            },
          },
        };
      return result;
    }
    last = result;
  }
  return last!;
}

/* ------------------------------------------------------------------ */
/* Lookup helpers (batched - no N+1)                                   */
/* ------------------------------------------------------------------ */

async function mapById(
  db: Db,
  table: string,
  ids: string[],
  select = '*',
): Promise<Map<string, Row>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows: Row[] = [];
  for (let start = 0; start < unique.length; start += 500) {
    const { data, error } = await db
      .from(table)
      .select(select)
      .in('id', unique.slice(start, start + 500));
    if (error) throw error;
    rows.push(...((data ?? []) as Row[]));
  }
  return new Map(rows.map((row) => [String(row.id), row]));
}

const staffName = (staff: Map<string, Row>, id: unknown): string | null => {
  if (typeof id !== 'string' || !id) return null;
  const row = staff.get(id);
  return typeof row?.full_name === 'string' ? (row.full_name as string) : null;
};

/* ------------------------------------------------------------------ */
/* Report builders. Each returns the FULL scoped set; the caller pages. */
/* ------------------------------------------------------------------ */

type Ctx = {
  db: Db;
  principal: AfHomesPrincipal;
  kind: ReportScopeKind;
  window: { from: string | null; to: string | null };
  q: Record<string, string | undefined>;
  masked: boolean;
};

async function buildSales(ctx: Ctx): Promise<ReportData> {
  const { db, principal, kind, window, q } = ctx;
  const saleIds = await scopedSaleIds(db, principal, kind);
  let query = db.from('card_sales').select('*', { count: 'exact' }).eq('origin', 'normal');
  if (saleIds) query = query.in('id', saleIds.length ? saleIds : []);
  if (q.status) query = query.eq('status', q.status);
  if (q.planId) query = query.eq('plan_id', q.planId);
  if (q.seller) query = query.or(`seller_staff_id.eq.${q.seller},seller_ost_id.eq.${q.seller}`);
  if (window.from) query = query.gte('created_at', window.from);
  if (window.to) query = query.lte('created_at', window.to);
  // Exhaust database pages before resolving names/search. A managed API row
  // cap must not hide matches or truncate summaries before UI pagination.
  const allSales: Row[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + 499);
    if (error) throw error;
    const batch = (data ?? []) as Row[];
    allSales.push(...batch);
    if (batch.length < 500) break;
  }
  let sales = allSales.filter((row) => inReportWindow(row.created_at, window.from, window.to));
  const customerIds = sales.map((row) => String(row.customer_id));
  const planIds = sales.map((row) => String(row.plan_id));
  const sellerIds = sales.flatMap((row) =>
    [row.seller_staff_id, row.seller_ost_id].filter(Boolean).map(String),
  );
  const [customers, plans, staff, payments] = await Promise.all([
    mapById(
      db,
      'customers',
      customerIds,
      'id,first_name,middle_name,last_name,suffix,customer_number',
    ),
    mapById(db, 'card_plans', planIds, 'id,name,code'),
    mapById(db, 'staff_users', sellerIds, 'id,full_name'),
    saleIds !== null && saleIds.length === 0
      ? []
      : (async () => {
          const rows: Row[] = [];
          const ids = allSales.map((row) => String(row.id));
          for (let start = 0; start < ids.length; start += 500) {
            for (let offset = 0; ; offset += 500) {
              const { data: pdata, error: perror } = await db
                .from('payments')
                .select('id,sale_id,amount,status')
                .in('sale_id', ids.slice(start, start + 500))
                .order('id', { ascending: true })
                .range(offset, offset + 499);
              if (perror) throw perror;
              const batch = (pdata ?? []) as Row[];
              rows.push(...batch);
              if (batch.length < 500) break;
            }
          }
          return rows;
        })(),
  ]);
  const needle = (q.search ?? '').trim().toLocaleLowerCase();
  if (needle) {
    sales = sales.filter((row) => {
      const customer = customers.get(String(row.customer_id)) ?? {};
      return [
        row.sale_number,
        row.id,
        displayName(customer),
        customer.customer_number,
        staffName(staff, row.seller_staff_id),
        staffName(staff, row.seller_ost_id),
      ].some((value) => typeof value === 'string' && value.toLocaleLowerCase().includes(needle));
    });
  }
  const matchedIds = new Set(sales.map((row) => String(row.id)));
  const verifiedBySale = new Map<string, bigint>();
  for (const payment of payments as Row[]) {
    if (payment.status !== 'verified' || !matchedIds.has(String(payment.sale_id))) continue;
    const id = String(payment.sale_id);
    verifiedBySale.set(id, (verifiedBySale.get(id) ?? 0n) + centsOf(payment.amount));
  }
  const rows = sales.map((row) => {
    const verified = moneyOf(verifiedBySale.get(String(row.id)) ?? 0n);
    const months =
      row.installment_months_snapshot === null || row.installment_months_snapshot === undefined
        ? null
        : Number(row.installment_months_snapshot);
    return {
      saleNumber: row.sale_number,
      date: row.created_at,
      customer: displayName(customers.get(String(row.customer_id)) ?? {}),
      seller:
        staffName(staff, row.seller_staff_id) ??
        staffName(staff, row.seller_ost_id) ??
        (row.seller_ost_id ? 'OST seller' : 'Unknown seller'),
      sellerRole: row.seller_type ?? null,
      plan: String(plans.get(String(row.plan_id))?.name ?? 'Unknown plan'),
      paymentScheme: paymentSchemeLabel(String(row.payment_scheme ?? 'spot_cash')),
      frozenPrice: row.cash_price_snapshot ?? '0.00',
      reservationFee: row.reservation_fee_snapshot ?? '0.00',
      requiredDown: row.required_initial_snapshot ?? row.minimum_down_payment_snapshot ?? '0.00',
      installmentMonths: months,
      monthlyAmount: row.monthly_amount_snapshot ?? null,
      validityMonths:
        row.validity_months_snapshot === null || row.validity_months_snapshot === undefined
          ? null
          : Number(row.validity_months_snapshot),
      yearlyPointsSnapshot: Number(row.yearly_points_snapshot ?? 0),
      status: row.status,
      verifiedPaid: verified,
      remaining: diffMoney(row.cash_price_snapshot ?? '0.00', verified),
      activatedAt: isoOrNull(row.activated_at),
    };
  });
  const gross = sumMoney(sales.map((row) => row.cash_price_snapshot));
  const verifiedTotal = moneyOf([...verifiedBySale.values()].reduce((sum, v) => sum + v, 0n));
  return {
    rows,
    total: rows.length,
    summary: {
      sales: rows.length,
      grossFrozenValue: gross,
      verifiedPaid: verifiedTotal,
      remaining: diffMoney(gross, verifiedTotal),
    },
    columns: [
      { key: 'saleNumber', label: 'Sale number', type: 'text' },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'customer', label: 'Customer', type: 'text' },
      { key: 'seller', label: 'Seller', type: 'text' },
      { key: 'sellerRole', label: 'Seller type', type: 'text' },
      { key: 'plan', label: 'Card plan', type: 'text' },
      { key: 'paymentScheme', label: 'Payment scheme', type: 'text' },
      { key: 'frozenPrice', label: 'Frozen price', type: 'money' },
      { key: 'reservationFee', label: 'Reservation fee', type: 'money' },
      { key: 'requiredDown', label: 'Required initial', type: 'money' },
      { key: 'installmentMonths', label: 'Months', type: 'number' },
      { key: 'monthlyAmount', label: 'Monthly amount', type: 'money' },
      { key: 'validityMonths', label: 'Validity (months)', type: 'number' },
      { key: 'yearlyPointsSnapshot', label: 'Yearly points snapshot', type: 'number' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'verifiedPaid', label: 'Verified paid', type: 'money' },
      { key: 'remaining', label: 'Remaining', type: 'money' },
      { key: 'activatedAt', label: 'Activated', type: 'date' },
    ],
    summaryLines: [
      `Sales: ${rows.length}  |  Gross frozen value: ${gross}`,
      `Verified paid: ${verifiedTotal}  |  Remaining: ${diffMoney(gross, verifiedTotal)}`,
    ],
  };
}

async function buildCustomers(ctx: Ctx): Promise<ReportData> {
  const { db, principal, kind, window, q } = ctx;
  const saleIds = await scopedSaleIds(db, principal, kind);
  let scopedCustomerIds: Set<string> | null = null;
  if (saleIds) {
    const sq = db
      .from('card_sales')
      .select('id,customer_id')
      .eq('origin', 'normal')
      .in('id', saleIds.length ? saleIds : []);
    const { data: sdata, error: serror } = await sq;
    if (serror) throw serror;
    scopedCustomerIds = new Set(((sdata ?? []) as Row[]).map((row) => String(row.customer_id)));
    if (kind === 'team' || kind === 'self') {
      const team = kind === 'team' ? await teamStaffIds(db, principal) : [principal.userId];
      const { data: referred, error: rerror } = await db
        .from('customers')
        .select('id')
        .in('referred_by_staff_id', team.length ? team : []);
      if (rerror) throw rerror;
      for (const row of (referred ?? []) as Row[]) scopedCustomerIds.add(String(row.id));
    }
  }
  let query = db.from('customers').select('*', { count: 'exact' });
  if (scopedCustomerIds) {
    const ids = [...scopedCustomerIds];
    query = query.in('id', ids.length ? ids : []);
  }
  if (q.status) query = query.eq('status', q.status);
  if (q.search) {
    const term = `%${q.search.replace(/[%_]/g, '')}%`;
    query = query.or(
      `first_name.ilike.${term},middle_name.ilike.${term},last_name.ilike.${term},email.ilike.${term},customer_number.ilike.${term}`,
    );
  }
  if (window.from) query = query.gte('created_at', window.from);
  if (window.to) query = query.lte('created_at', window.to);
  const { data, error, count } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  const customers = ((data ?? []) as Row[]).filter((row) =>
    inReportWindow(row.created_at, window.from, window.to),
  );
  const referrerIds = customers
    .map((row) => String(row.referred_by_staff_id ?? ''))
    .filter(Boolean);
  // Seller attribution for the rows in scope only. Global callers see the
  // referrer of record; team/self callers additionally see the seller of the
  // attributed sales (their scope set is already narrowed, so this stays
  // proportional instead of pulling the whole sales table).
  const [staff, scopedSales] = await Promise.all([
    mapById(db, 'staff_users', referrerIds, 'id,full_name'),
    saleIds
      ? (async () => {
          const { data: sdata, error: serror } = await db
            .from('card_sales')
            .select('customer_id,seller_staff_id,seller_ost_id')
            .eq('origin', 'normal')
            .in('id', saleIds.length ? saleIds : []);
          if (serror) throw serror;
          return (sdata ?? []) as Row[];
        })()
      : Promise.resolve([] as Row[]),
  ]);
  const sellerOf = new Map<string, string>();
  for (const sale of scopedSales) {
    const name =
      staffName(staff, sale.seller_staff_id) ?? (sale.seller_ost_id ? 'OST seller' : null);
    if (name && !sellerOf.has(String(sale.customer_id)))
      sellerOf.set(String(sale.customer_id), name);
  }
  const memberships = await (async () => {
    const ids = customers.map((row) => String(row.id));
    if (!ids.length) return [];
    const { data: mdata, error: merror } = await db
      .from('memberships')
      .select('customer_id,status,product_id')
      .in('customer_id', ids);
    if (merror) throw merror;
    return (mdata ?? []) as Row[];
  })();
  const membershipOf = new Map<string, Row>();
  for (const membership of memberships as Row[]) {
    if (!membershipOf.has(String(membership.customer_id))) {
      membershipOf.set(String(membership.customer_id), membership);
    }
  }
  const planIds = [
    ...new Set((memberships as Row[]).map((row) => String(row.product_id ?? ''))),
  ].filter(Boolean);
  const plans = await mapById(db, 'card_plans', planIds, 'id,name');
  const rows = customers.map((row) => ({
    customerNumber: row.customer_number,
    name: displayName(row),
    email: ctx.masked ? maskEmail(row.email) : (row.email ?? null),
    phone: ctx.masked ? maskPhone(row.phone) : (row.phone ?? null),
    status: row.status,
    registeredAt: row.created_at,
    seller: staffName(staff, row.referred_by_staff_id) ?? sellerOf.get(String(row.id)) ?? null,
    membershipStatus: membershipOf.get(String(row.id))?.status ?? null,
    plan: plans.get(String(membershipOf.get(String(row.id))?.product_id ?? ''))?.name ?? null,
  }));
  const byStatus: Record<string, number> = {};
  for (const row of rows) byStatus[String(row.status)] = (byStatus[String(row.status)] ?? 0) + 1;
  return {
    rows,
    total: count ?? rows.length,
    summary: { customers: rows.length, byStatus },
    columns: [
      { key: 'customerNumber', label: 'Customer number', type: 'text' },
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'registeredAt', label: 'Registered', type: 'date' },
      { key: 'seller', label: 'Seller / referrer', type: 'text' },
      { key: 'membershipStatus', label: 'Membership', type: 'text' },
      { key: 'plan', label: 'Plan', type: 'text' },
    ],
    summaryLines: [`Customers: ${rows.length}`, `By status: ${JSON.stringify(byStatus)}`],
  };
}

/**
 * One row per payment, sale-linked or not.
 *
 * Finalization links the SAME payment rows to the sale, so a post-finalization
 * read can return a row from both branches. Keying on the payment id keeps the
 * report's money totals honest across that transition.
 */
function dedupeByPaymentId(rows: Row[]): Row[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const id = String(row.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function buildPayments(ctx: Ctx): Promise<ReportData> {
  const { db, principal, kind, window, q } = ctx;
  const saleIds = await scopedSaleIds(db, principal, kind);
  let normalQuery = db.from('card_sales').select('id').eq('origin', 'normal');
  if (q.planId) normalQuery = normalQuery.eq('plan_id', q.planId);
  if (q.seller)
    normalQuery = normalQuery.or(`seller_staff_id.eq.${q.seller},seller_ost_id.eq.${q.seller}`);
  const normalSales = await readSearchRows(normalQuery.order('id'));
  const normalIds = normalSales.map((sale) => String(sale.id));
  let query = db
    .from('payments')
    .select('*', { count: 'exact' })
    .in('sale_id', normalIds.length ? normalIds : []);
  if (saleIds) query = query.in('sale_id', saleIds.length ? saleIds : []);
  if (q.status) query = query.eq('status', q.status);
  if (window.from) query = query.gte('recorded_at', window.from);
  if (window.to) query = query.lte('recorded_at', window.to);
  const data =
    normalIds.length === 0 || saleIds?.length === 0
      ? []
      : await readSearchRows(
          query.order('recorded_at', { ascending: false }).order('id', { ascending: false }),
        );
  let payments = ((data ?? []) as Row[]).filter((row) =>
    inReportWindow(row.recorded_at, window.from, window.to),
  );
  // Pre-sale rows. A reservation-origin payment has no card sale yet, so the
  // sale-scoped read above cannot see it. They are reported ONLY to an unscoped
  // caller with no seller or plan filter: a scope-limited caller already sees no
  // out-of-scope sales, and a reservation carries its plan and seller through
  // the frozen terms, so attributing it without that join would be a guess.
  // Finalization links the SAME rows to the sale, and the merge dedupes by payment
  // id so nothing is ever counted twice.
  if (!saleIds && !q.planId && !q.seller) {
    let reservationQuery = db.from('payments').select('*').eq('origin', 'reservation');
    if (q.status) reservationQuery = reservationQuery.eq('status', q.status);
    if (window.from) reservationQuery = reservationQuery.gte('recorded_at', window.from);
    if (window.to) reservationQuery = reservationQuery.lte('recorded_at', window.to);
    payments = dedupeByPaymentId([
      ...payments,
      ...(((await readSearchRows(
        reservationQuery.order('recorded_at', { ascending: false }),
      )) ?? []) as Row[]),
    ]).filter((row) => inReportWindow(row.recorded_at, window.from, window.to));
  }
  const reservationIdsSeen = [
    ...new Set(payments.map((row) => String(row.reservation_id ?? ''))),
  ].filter(Boolean);
  const saleIdsSeen = [...new Set(payments.map((row) => String(row.sale_id ?? '')))].filter(Boolean);
  const customerIds = [...new Set(payments.map((row) => String(row.customer_id ?? '')))].filter(
    Boolean,
  );
  const verifierIds = [...new Set(payments.map((row) => String(row.verified_by ?? '')))].filter(
    Boolean,
  );
  const sales = await mapById(db, 'card_sales', saleIdsSeen, 'id,sale_number,customer_id');
  const reservations = await mapById(
    db,
    'reservation_agreements',
    reservationIdsSeen,
    'id,reservation_number,customer_id',
  );
  customerIds.push(...[...sales.values()].map((s) => String(s.customer_id)));
  customerIds.push(...[...reservations.values()].map((r) => String(r.customer_id)));
  const [customers, staff] = await Promise.all([
    mapById(
      db,
      'customers',
      customerIds,
      'id,first_name,middle_name,last_name,suffix,customer_number',
    ),
    mapById(db, 'staff_users', verifierIds, 'id,full_name'),
  ]);
  payments = payments.filter((row) => {
    const sale = sales.get(String(row.sale_id ?? ''));
    const reservation = reservations.get(String(row.reservation_id ?? ''));
    const customer = customers.get(
      String(row.customer_id ?? sale?.customer_id ?? reservation?.customer_id ?? ''),
    );
    return matchesSearch(q.search, [
      customer && displayName(customer),
      customer?.customer_number,
      sale?.sale_number,
      reservation?.reservation_number,
      row.reference,
      row.status,
    ]);
  });
  const rows = payments.map((row) => {
    const sale = sales.get(String(row.sale_id ?? ''));
    const reservation = reservations.get(String(row.reservation_id ?? ''));
    const customer = customers.get(
      String(row.customer_id ?? sale?.customer_id ?? reservation?.customer_id ?? ''),
    );
    return {
      paymentDate: row.recorded_at,
      // A pre-sale row has no sale number yet, so it reports the reservation it
      // belongs to instead of a null the reader cannot follow.
      saleNumber: sale?.sale_number ?? reservation?.reservation_number ?? null,
      customer: customer ? displayName(customer) : null,
      amount: row.amount ?? '0.00',
      type: row.payment_type ?? null,
      method: row.method ?? null,
      reference: row.reference ?? null,
      status: row.status,
      rejectionReason: row.rejection_reason ?? null,
      verifier: staffName(staff, row.verified_by),
      verifiedAt: isoOrNull(row.verified_at),
    };
  });
  const verified = sumMoney(payments.filter((r) => r.status === 'verified').map((r) => r.amount));
  const pending = sumMoney(payments.filter((r) => r.status === 'recorded').map((r) => r.amount));
  const rejected = sumMoney(payments.filter((r) => r.status === 'rejected').map((r) => r.amount));
  return {
    rows,
    total: rows.length,
    summary: {
      payments: rows.length,
      verifiedTotal: verified,
      pendingTotal: pending,
      rejectedTotal: rejected,
    },
    columns: [
      { key: 'paymentDate', label: 'Payment date', type: 'date' },
      { key: 'saleNumber', label: 'Sale number', type: 'text' },
      { key: 'customer', label: 'Customer', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'type', label: 'Type', type: 'text' },
      { key: 'method', label: 'Method', type: 'text' },
      { key: 'reference', label: 'Reference', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'rejectionReason', label: 'Rejection reason', type: 'text' },
      { key: 'verifier', label: 'Verifier', type: 'text' },
      { key: 'verifiedAt', label: 'Verified at', type: 'date' },
    ],
    summaryLines: [
      `Payments: ${rows.length}  |  Verified total: ${verified} (only verified counts as received)`,
      `Pending: ${pending}  |  Rejected: ${rejected}`,
    ],
  };
}

async function buildMemberships(ctx: Ctx): Promise<ReportData> {
  const { db, principal, kind, window, q } = ctx;
  const saleIds = await scopedSaleIds(db, principal, kind);
  let query = db.from('memberships').select('*', { count: 'exact' });
  if (saleIds) query = query.in('sale_id', saleIds.length ? saleIds : []);
  if (q.status) query = query.eq('status', q.status);
  if (q.planId) query = query.eq('product_id', q.planId);
  if (q.search) query = query.ilike('membership_number', `%${q.search.replace(/[%_]/g, '')}%`);
  if (window.from) query = query.gte('activated_at', window.from);
  if (window.to) query = query.lte('activated_at', window.to);
  const { data, error, count } = await query.order('activated_at', { ascending: false });
  if (error) throw error;
  // activated_at can be null on fixture rows; fall back to created_at so the
  // window still applies instead of silently dropping the row.
  const memberships = ((data ?? []) as Row[]).filter((row) =>
    inReportWindow(pickDate(row, 'activated_at', 'created_at'), window.from, window.to),
  );
  const customerIds = [...new Set(memberships.map((row) => String(row.customer_id)))];
  const planIds = [...new Set(memberships.map((row) => String(row.product_id ?? '')))].filter(
    Boolean,
  );
  const [customers, plans] = await Promise.all([
    mapById(db, 'customers', customerIds, 'id,first_name,middle_name,last_name,suffix'),
    mapById(db, 'card_plans', planIds, 'id,name'),
  ]);
  const rows = memberships.map((row) => ({
    membershipNumber: row.membership_number,
    customer: displayName(customers.get(String(row.customer_id)) ?? {}),
    tier: plans.get(String(row.product_id ?? ''))?.name ?? null,
    activatedAt: isoOrNull(row.activated_at),
    status: row.status,
    pointsAllocated: Number(row.yearly_points_allocated ?? 0),
    cardIssuedAt: isoOrNull(row.card_issued_at),
    lastPrintedAt: isoOrNull(row.last_printed_at),
    printCount: Number(row.print_count ?? 0),
  }));
  const byStatus: Record<string, number> = {};
  for (const row of rows) byStatus[String(row.status)] = (byStatus[String(row.status)] ?? 0) + 1;
  return {
    rows,
    total: count ?? rows.length,
    summary: { memberships: rows.length, byStatus },
    columns: [
      { key: 'membershipNumber', label: 'Membership number', type: 'text' },
      { key: 'customer', label: 'Customer', type: 'text' },
      { key: 'tier', label: 'Tier', type: 'text' },
      { key: 'activatedAt', label: 'Activated', type: 'date' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'pointsAllocated', label: 'Points allocated', type: 'number' },
      { key: 'cardIssuedAt', label: 'Card issued', type: 'date' },
      { key: 'lastPrintedAt', label: 'Last printed', type: 'date' },
      { key: 'printCount', label: 'Print count', type: 'number' },
    ],
    summaryLines: [`Memberships: ${rows.length}`, `By status: ${JSON.stringify(byStatus)}`],
  };
}

async function buildCommissions(ctx: Ctx): Promise<ReportData> {
  const { db, principal, kind, window, q } = ctx;
  const saleIds = await scopedSaleIds(db, principal, kind);
  let query = db.from('commissions').select('*', { count: 'exact' });
  if (saleIds) query = query.in('sale_id', saleIds.length ? saleIds : []);
  if (q.status) query = query.eq('status', q.status);
  if (q.seller) {
    query = query.or(`beneficiary_staff_id.eq.${q.seller},beneficiary_ost_id.eq.${q.seller}`);
  }
  if (window.from) query = query.gte('created_at', window.from);
  if (window.to) query = query.lte('created_at', window.to);
  const data = await readSearchRows(
    query.order('created_at', { ascending: false }).order('id', { ascending: false }),
  );
  const commissions = ((data ?? []) as Row[]).filter((row) =>
    inReportWindow(row.created_at, window.from, window.to),
  );
  const saleIdsSeen = [...new Set(commissions.map((row) => String(row.sale_id)))];
  const staffIds = [
    ...new Set(commissions.map((row) => String(row.beneficiary_staff_id ?? ''))),
  ].filter(Boolean);
  const ostIds = [
    ...new Set(commissions.map((row) => String(row.beneficiary_ost_id ?? ''))),
  ].filter(Boolean);
  const [sales, staff, ost] = await Promise.all([
    mapById(db, 'card_sales', saleIdsSeen, 'id,sale_number'),
    mapById(db, 'staff_users', staffIds, 'id,full_name'),
    mapById(db, 'ost_members', ostIds, 'id,full_name'),
  ]);
  const rows = commissions
    .map((row) => ({
      id: row.id,
      saleNumber: sales.get(String(row.sale_id))?.sale_number ?? null,
      beneficiary:
        staffName(staff, row.beneficiary_staff_id) ??
        (typeof row.beneficiary_ost_id === 'string'
          ? (ost.get(row.beneficiary_ost_id)?.full_name ?? 'OST member')
          : 'Unknown'),
      beneficiaryType: row.beneficiary_type ?? null,
      basePrice: row.basis_amount_snapshot ?? '0.00',
      rate: row.rate_snapshot ?? null,
      amount: row.amount ?? '0.00',
      status: row.status,
      createdAt: row.created_at,
      qualifiedAt: isoOrNull(row.qualified_at),
      earnedAt: isoOrNull(row.earned_at),
      paidAt: isoOrNull(row.paid_at),
    }))
    .filter((row) =>
      matchesSearch(q.search, [row.beneficiary, row.saleNumber, row.id, row.status]),
    );
  const byStatus: Record<string, number> = {};
  const amountByStatus: Record<string, bigint> = {};
  for (const row of rows) {
    const status = String(row.status);
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    amountByStatus[status] = (amountByStatus[status] ?? 0n) + centsOf(row.amount);
  }
  const amounts: Record<string, string> = {};
  for (const [status, cents] of Object.entries(amountByStatus)) amounts[status] = moneyOf(cents);
  return {
    rows,
    total: rows.length,
    summary: { commissions: rows.length, byStatus, amountByStatus: amounts },
    columns: [
      { key: 'id', label: 'Commission ID', type: 'text' },
      { key: 'saleNumber', label: 'Sale number', type: 'text' },
      { key: 'beneficiary', label: 'Seller / OST', type: 'text' },
      { key: 'beneficiaryType', label: 'Beneficiary type', type: 'text' },
      { key: 'basePrice', label: 'Base price snapshot', type: 'money' },
      { key: 'rate', label: 'Rate snapshot', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'createdAt', label: 'Created', type: 'date' },
      { key: 'qualifiedAt', label: 'Qualified', type: 'date' },
      { key: 'earnedAt', label: 'Earned', type: 'date' },
      { key: 'paidAt', label: 'Paid', type: 'date' },
    ],
    summaryLines: [
      `Commissions: ${rows.length} (lifecycle states only - no payout projection)`,
      `By status: ${JSON.stringify(byStatus)}`,
    ],
  };
}

async function buildRedemptions(ctx: Ctx): Promise<ReportData> {
  const { db, principal, kind, window, q } = ctx;
  // Employee ownership: a scoped caller sees ONLY rows they handled. The
  // server derives the employee from the session - a `seller` query value from
  // a scoped caller is ignored so one employee can never pull another's rows.
  const scopedToSelf = kind === 'redemption' || kind === 'self' || kind === 'team';
  // The only authoritative employee-handled transaction in this schema is a
  // points redemption. Any other transaction-type value matches nothing - it
  // must never widen into someone else's rows, and an empty scope is a 200
  // with zeros, never a 500.
  const typeFilter = (q.transactionType ?? '').trim().toLowerCase();
  if (typeFilter && typeFilter !== 'redemption') {
    return emptyRedemptionData();
  }
  let query = db.from('redemptions').select('*', { count: 'exact' });
  if (scopedToSelf) {
    // Sellers hold no redemption grant, so reaching here with a seller kind
    // means an explicit grant: still narrow to their own handled rows.
    query = query.eq('redeemed_by', principal.userId);
  }
  if (q.status) query = query.eq('status', q.status);
  if (q.itemId) query = query.eq('redemption_item_id', q.itemId);
  if (q.seller && !scopedToSelf) query = query.eq('redeemed_by', q.seller);
  if (window.from) query = query.gte('created_at', window.from);
  if (window.to) query = query.lte('created_at', window.to);
  const { data, error, count } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  let redemptions = ((data ?? []) as Row[]).filter((row) =>
    inReportWindow(row.created_at, window.from, window.to),
  );
  const customerIds = [...new Set(redemptions.map((row) => String(row.customer_id)))];
  const membershipIds = [...new Set(redemptions.map((row) => String(row.membership_id)))];
  const [customers, memberships] = await Promise.all([
    mapById(
      db,
      'customers',
      customerIds,
      'id,customer_number,first_name,middle_name,last_name,suffix',
    ),
    mapById(db, 'memberships', membershipIds, 'id,membership_number,product_id'),
  ]);
  // VIP tier is the plan name at report time (display only - the commercial
  // facts stay frozen in the redemption snapshots).
  const planIds = [
    ...new Set([...memberships.values()].map((m) => String(m.product_id ?? '')).filter(Boolean)),
  ];
  const plans = await mapById(db, 'card_plans', planIds, 'id,name');
  // Server-side search over the already-scoped set: customer name / customer
  // number, membership number, redemption reference, or service/item text.
  // Filtering here (on the server, before pagination) keeps a lookup from ever
  // becoming a transaction: a search that matches nothing returns [].
  const needle = (q.search ?? '').trim().toLowerCase();
  if (needle) {
    redemptions = redemptions.filter((row) => {
      const customer = customers.get(String(row.customer_id));
      const membership = memberships.get(String(row.membership_id));
      const haystacks = [
        row.redemption_number,
        row.item_name_snapshot,
        row.item_code_snapshot,
        membership?.membership_number,
        customer ? displayName(customer) : null,
        customer?.customer_number,
      ];
      return haystacks.some((field) =>
        String(field ?? '')
          .toLowerCase()
          .includes(needle),
      );
    });
  }
  const rows = redemptions.map((row) => {
    const customer = customers.get(String(row.customer_id));
    const membership = memberships.get(String(row.membership_id));
    const tier = plans.get(String(membership?.product_id ?? ''))?.name ?? null;
    return {
      // Canonical service-history fields (Step 4 column order).
      date: row.created_at,
      customer: displayName(customer ?? {}),
      customerNumber: customer?.customer_number ?? null,
      membershipNumber: membership?.membership_number ?? null,
      tier,
      serviceItem: row.item_name_snapshot ?? null,
      transactionType: 'redemption',
      pointsUsed: Number(row.total_points ?? 0),
      quantity: Number(row.quantity ?? 1),
      status: row.status,
      referenceNumber: row.redemption_number,
      balanceBefore: Number(row.balance_before_snapshot ?? 0),
      balanceAfter: Number(row.balance_after_snapshot ?? row.balance_after ?? 0),
      servedBy: row.redeemed_by_name ?? null,
      // Legacy keys kept so existing screens and exports keep working.
      redemptionNumber: row.redemption_number,
      timestamp: row.created_at,
      item: row.item_name_snapshot ?? null,
      pointsSpent: Number(row.total_points ?? 0),
      actor: row.redeemed_by_name ?? null,
    };
  });
  const completed = rows.filter((row) => row.status === 'completed');
  const points = rows.reduce((sum, row) => sum + Number(row.pointsSpent), 0);
  const pointsRedeemed = completed.reduce((sum, row) => sum + Number(row.pointsUsed), 0);
  const customerSet = new Set(redemptions.map((row) => String(row.customer_id)));
  const now = new Date();
  const dayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).valueOf();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).valueOf();
  const inDay = (value: unknown) => {
    const time = new Date(String(value ?? '')).valueOf();
    return Number.isFinite(time) && time >= dayStart;
  };
  const inMonth = (value: unknown) => {
    const time = new Date(String(value ?? '')).valueOf();
    return Number.isFinite(time) && time >= monthStart;
  };
  const summary = {
    redemptions: rows.length,
    pointsSpent: points,
    customersServed: customerSet.size,
    completedTransactions: completed.length,
    pointsRedeemed,
    todayTransactions: rows.filter((row) => inDay(row.date)).length,
    monthTransactions: rows.filter((row) => inMonth(row.date)).length,
  };
  // A server-side search narrows after the count query, so the total must
  // follow the narrowed set - otherwise the pager would promise rows that the
  // filters already removed.
  const total = needle ? rows.length : (count ?? rows.length);
  return {
    rows,
    total,
    summary,
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'customer', label: 'Customer / VIP member', type: 'text' },
      { key: 'membershipNumber', label: 'Membership number', type: 'text' },
      { key: 'tier', label: 'VIP tier', type: 'text' },
      { key: 'serviceItem', label: 'Service / item', type: 'text' },
      { key: 'transactionType', label: 'Transaction type', type: 'text' },
      { key: 'pointsUsed', label: 'Points used', type: 'number' },
      { key: 'quantity', label: 'Qty', type: 'number' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'referenceNumber', label: 'Reference number', type: 'text' },
      { key: 'balanceBefore', label: 'Balance before', type: 'number' },
      { key: 'balanceAfter', label: 'Balance after', type: 'number' },
      { key: 'servedBy', label: 'Served by', type: 'text' },
    ],
    summaryLines: [
      `Redemptions: ${rows.length}  |  Points spent: ${points} (points are loyalty units, not currency)`,
      `Customers served: ${summary.customersServed}  |  Completed: ${summary.completedTransactions}  |  This month: ${summary.monthTransactions}`,
    ],
  };
}

function emptyRedemptionData(): ReportData {
  return {
    rows: [],
    total: 0,
    summary: {
      redemptions: 0,
      pointsSpent: 0,
      customersServed: 0,
      completedTransactions: 0,
      pointsRedeemed: 0,
      todayTransactions: 0,
      monthTransactions: 0,
    },
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'customer', label: 'Customer / VIP member', type: 'text' },
      { key: 'membershipNumber', label: 'Membership number', type: 'text' },
      { key: 'tier', label: 'VIP tier', type: 'text' },
      { key: 'serviceItem', label: 'Service / item', type: 'text' },
      { key: 'transactionType', label: 'Transaction type', type: 'text' },
      { key: 'pointsUsed', label: 'Points used', type: 'number' },
      { key: 'quantity', label: 'Qty', type: 'number' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'referenceNumber', label: 'Reference number', type: 'text' },
      { key: 'balanceBefore', label: 'Balance before', type: 'number' },
      { key: 'balanceAfter', label: 'Balance after', type: 'number' },
      { key: 'servedBy', label: 'Served by', type: 'text' },
    ],
    summaryLines: ['Redemptions: 0  |  Points spent: 0'],
  };
}

async function buildGenealogy(ctx: Ctx): Promise<ReportData> {
  const { db, principal, kind, window, q } = ctx;
  const sellerRoles = ['vice_director', 'senior_sales_manager', 'sales_manager', 'ost'];
  const [staffRes, assignRes, rolesRes, relsRes, ostRes, salesRes, snapsRes] = await Promise.all([
    readSearchRows(db.from('staff_users').select('id,full_name,status').order('id')),
    readSearchRows(
      db
        .from('staff_role_assignments')
        .select('staff_id,role_id')
        .order('staff_id')
        .order('role_id'),
    ),
    readSearchRows(db.from('roles').select('id,slug').eq('is_active', true).order('id')),
    readSearchRows(
      db
        .from('referral_relationships')
        .select('subject_staff_id,upline_staff_id')
        .eq('is_active', true)
        .order('subject_staff_id')
        .order('upline_staff_id'),
    ),
    readSearchRows(db.from('ost_members').select('id,status').order('id')),
    readSearchRows(
      db
        .from('card_sales')
        .select('id,cash_price_snapshot,created_at')
        .eq('origin', 'normal')
        .order('id'),
    ),
    readSearchRows(
      db
        .from('card_sale_hierarchy_snapshots')
        .select('sale_id,ancestor_staff_id')
        .order('sale_id')
        .order('ancestor_staff_id'),
    ),
  ]).then((results) => results.map((data) => ({ data, error: null })));
  for (const res of [staffRes, assignRes, rolesRes, relsRes, ostRes, salesRes, snapsRes]) {
    if (res.error) throw res.error;
  }
  const roleById = new Map<string, string>(
    ((rolesRes.data ?? []) as Row[]).map((r) => [String(r.id), String(r.slug)]),
  );
  const roleByStaff = new Map<string, string>(
    ((assignRes.data ?? []) as Row[]).map((a) => [
      String(a.staff_id),
      roleById.get(String(a.role_id)) ?? 'unknown',
    ]),
  );
  const parent = new Map<string, string>(
    ((relsRes.data ?? []) as Row[]).map((r) => [
      String(r.subject_staff_id),
      String(r.upline_staff_id),
    ]),
  );
  const children = new Map<string, string[]>();
  for (const [child, p] of parent) children.set(p, [...(children.get(p) ?? []), child]);
  const descendants = (id: string): string[] => {
    const out: string[] = [];
    const seen = new Set([id]);
    const queue = [...(children.get(id) ?? [])];
    while (queue.length && out.length < 10_000) {
      const x = queue.shift()!;
      if (seen.has(x)) continue;
      seen.add(x);
      out.push(x);
      queue.push(...(children.get(x) ?? []));
    }
    return out;
  };
  const ancestors = (id: string): string[] => {
    const out: string[] = [];
    const seen = new Set([id]);
    let x = parent.get(id);
    while (x && out.length < 4 && !seen.has(x)) {
      seen.add(x);
      out.push(x);
      x = parent.get(x);
    }
    return out;
  };
  const seller = sellerRoles.includes(principal.roleSlug);
  const visible = new Set<string>(
    seller
      ? principal.roleSlug === 'ost'
        ? [principal.userId, ...ancestors(principal.userId)]
        : [principal.userId, ...ancestors(principal.userId), ...descendants(principal.userId)]
      : ((staffRes.data ?? []) as Row[]).map((s) => String(s.id)),
  );
  const staffById = new Map<string, Row>(
    ((staffRes.data ?? []) as Row[]).map((s) => [String(s.id), s]),
  );
  const ostById = new Map<string, string>(
    ((ostRes.data ?? []) as Row[]).map((o) => [String(o.id), String(o.status)]),
  );
  const valueBySale = new Map<string, { value: string; at: string }>(
    ((salesRes.data ?? []) as Row[]).map((s) => [
      String(s.id),
      { value: String(s.cash_price_snapshot ?? '0.00'), at: String(s.created_at ?? '') },
    ]),
  );
  const salesByAncestor = new Map<string, string[]>();
  for (const snap of (snapsRes.data ?? []) as Row[]) {
    const ancestor = String(snap.ancestor_staff_id);
    salesByAncestor.set(ancestor, [...(salesByAncestor.get(ancestor) ?? []), String(snap.sale_id)]);
  }
  // Sellers with the report grant but no team scope of their own (e.g. an
  // employee) see an empty team report rather than the whole network.
  let nodes = ((staffRes.data ?? []) as Row[])
    .filter(
      (s) => visible.has(String(s.id)) && sellerRoles.includes(roleByStaff.get(String(s.id)) ?? ''),
    )
    .map((s) => {
      const id = String(s.id);
      const attributed = (salesByAncestor.get(id) ?? []).filter((saleId) => {
        const sale = valueBySale.get(saleId);
        return sale && inReportWindow(sale.at, window.from, window.to);
      });
      return {
        seller: String(s.full_name ?? 'Unknown'),
        sellerId: id,
        role: roleByStaff.get(id) ?? 'unknown',
        status: String(s.status ?? 'unknown'),
        upline: parent.get(id) ? (staffById.get(parent.get(id)!)?.full_name ?? null) : null,
        directDownline: (children.get(id) ?? []).length,
        totalDescendants: descendants(id).length,
        historicalSales: attributed.length,
        historicalValue: sumMoney(attributed.map((saleId) => valueBySale.get(saleId)?.value)),
        ostStatus: ostById.get(id) ?? null,
      };
    });
  nodes = nodes.filter((node) =>
    matchesSearch(q.search, [node.seller, node.sellerId, node.role, node.upline]),
  );
  if (q.role) nodes = nodes.filter((node) => node.role === q.role);
  if (q.seller) nodes = nodes.filter((node) => node.sellerId === q.seller);
  if (q.status) nodes = nodes.filter((node) => node.status === q.status);
  if (kind === 'redemption') nodes = [];
  // The performance table is ordered by measured facts only, documented here
  // so no reader mistakes position for a subjective score: frozen historical
  // value descending (exact cents via the shared helper, never float), then
  // historical sale count descending, then seller name ascending. No
  // weighting, no labels.
  nodes.sort((a, b) => {
    const byValue = centsOf(b.historicalValue) - centsOf(a.historicalValue);
    if (byValue !== 0n) return byValue < 0n ? -1 : 1;
    if (b.historicalSales !== a.historicalSales) return b.historicalSales - a.historicalSales;
    return a.seller.localeCompare(b.seller);
  });
  const totalValue = sumMoney(nodes.map((node) => node.historicalValue));
  return {
    rows: nodes,
    total: nodes.length,
    summary: {
      sellers: nodes.length,
      historicalSales: nodes.reduce((sum, node) => sum + node.historicalSales, 0),
      historicalValue: totalValue,
    },
    columns: [
      { key: 'seller', label: 'Seller', type: 'text' },
      { key: 'role', label: 'Role', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'upline', label: 'Current upline', type: 'text' },
      { key: 'directDownline', label: 'Direct downline', type: 'number' },
      { key: 'totalDescendants', label: 'Total descendants', type: 'number' },
      { key: 'historicalSales', label: 'Historical sales', type: 'number' },
      { key: 'historicalValue', label: 'Historical value', type: 'money' },
      { key: 'ostStatus', label: 'OST status', type: 'text' },
    ],
    summaryLines: [
      `Sellers in scope: ${nodes.length} (current structure; sales use frozen sale-time attribution)`,
      `Historical sales: ${nodes.reduce((sum, node) => sum + node.historicalSales, 0)}  |  Value: ${totalValue}`,
    ],
  };
}

async function buildOst(ctx: Ctx): Promise<ReportData> {
  const { db, principal, kind, window, q } = ctx;
  const sub = (q.kind ?? 'applications').toLowerCase();
  if (sub !== 'applications' && sub !== 'members') {
    throw {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'kind must be applications or members',
    };
  }
  const narrowToSponsor = kind === 'team' || kind === 'self';
  if (sub === 'applications') {
    let query = db.from('ost_applications').select('*', { count: 'exact' });
    if (narrowToSponsor) query = query.eq('sponsor_staff_id', principal.userId);
    if (q.status) query = query.eq('status', q.status);
    if (q.seller) query = query.eq('sponsor_staff_id', q.seller);
    if (window.from) query = query.gte('submitted_at', window.from);
    if (window.to) query = query.lte('submitted_at', window.to);
    const data = await readSearchRows(
      query.order('submitted_at', { ascending: false }).order('id', { ascending: false }),
    );
    const apps = ((data ?? []) as Row[]).filter((row) =>
      inReportWindow(pickDate(row, 'submitted_at', 'created_at'), window.from, window.to),
    );
    const sponsorIds = [...new Set(apps.map((row) => String(row.sponsor_staff_id ?? '')))].filter(
      Boolean,
    );
    const reviewerIds = [...new Set(apps.map((row) => String(row.reviewed_by ?? '')))].filter(
      Boolean,
    );
    const [sponsors, reviewers] = await Promise.all([
      mapById(db, 'staff_users', sponsorIds, 'id,full_name'),
      mapById(db, 'staff_users', reviewerIds, 'id,full_name'),
    ]);
    const rows = apps
      .map((row) => ({
        applicant:
          [row.first_name, row.middle_name, row.last_name]
            .filter((p) => typeof p === 'string' && p)
            .join(' ') || 'Unknown',
        email: ctx.masked ? maskEmail(row.email) : (row.email ?? null),
        phone: ctx.masked ? maskPhone(row.phone) : (row.phone ?? null),
        sponsor: staffName(sponsors, row.sponsor_staff_id),
        status: row.status,
        submittedAt: isoOrNull(row.submitted_at),
        reviewedAt: isoOrNull(row.reviewed_at),
        reviewer: staffName(reviewers, row.reviewed_by),
        reviewNotes: row.review_notes ?? null,
      }))
      .filter((row) =>
        matchesSearch(q.search, [row.applicant, row.sponsor, row.email, row.phone, row.status]),
      );
    const byStatus: Record<string, number> = {};
    for (const row of rows) byStatus[String(row.status)] = (byStatus[String(row.status)] ?? 0) + 1;
    return {
      rows,
      total: rows.length,
      summary: { applications: rows.length, byStatus },
      columns: [
        { key: 'applicant', label: 'Applicant', type: 'text' },
        { key: 'email', label: 'Email', type: 'text' },
        { key: 'phone', label: 'Phone', type: 'text' },
        { key: 'sponsor', label: 'Sponsor', type: 'text' },
        { key: 'status', label: 'Status', type: 'text' },
        { key: 'submittedAt', label: 'Submitted', type: 'date' },
        { key: 'reviewedAt', label: 'Reviewed', type: 'date' },
        { key: 'reviewer', label: 'Reviewer', type: 'text' },
        { key: 'reviewNotes', label: 'Review notes', type: 'text' },
      ],
      summaryLines: [`Applications: ${rows.length}`, `By status: ${JSON.stringify(byStatus)}`],
    };
  }
  let query = db.from('ost_members').select('*', { count: 'exact' });
  if (narrowToSponsor) {
    // Own sponsored members plus the caller's own member row (an OST caller
    // is a member, not a sponsor, so sponsor-only filtering would hide them
    // from their own report).
    const { data: own, error: ownError } = await db
      .from('ost_members')
      .select('id')
      .eq('id', principal.userId)
      .limit(1);
    if (ownError) throw ownError;
    const selfRow = ((own ?? []) as Row[]).length ? [principal.userId] : [];
    if (q.status) query = query.eq('status', q.status);
    const data = await readSearchRows(
      query.order('approved_at', { ascending: false }).order('id', { ascending: false }),
    );
    const scoped = ((data ?? []) as Row[]).filter(
      (row) =>
        String(row.sponsor_staff_id) === principal.userId || selfRow.includes(String(row.id)),
    );
    const members = scoped.filter((row) =>
      inReportWindow(pickDate(row, 'approved_at', 'created_at'), window.from, window.to),
    );
    return ostMemberData(db, ctx, members);
  }
  if (q.status) query = query.eq('status', q.status);
  if (q.seller) query = query.eq('sponsor_staff_id', q.seller);
  if (window.from) query = query.gte('approved_at', window.from);
  if (window.to) query = query.lte('approved_at', window.to);
  const data = await readSearchRows(
    query.order('approved_at', { ascending: false }).order('id', { ascending: false }),
  );
  const members = ((data ?? []) as Row[]).filter((row) =>
    inReportWindow(pickDate(row, 'approved_at', 'created_at'), window.from, window.to),
  );
  return ostMemberData(db, ctx, members);
}

async function ostMemberData(db: Db, ctx: Ctx, members: Row[]): Promise<ReportData> {
  const sponsorIds = [...new Set(members.map((row) => String(row.sponsor_staff_id ?? '')))].filter(
    Boolean,
  );
  const sponsors = await mapById(db, 'staff_users', sponsorIds, 'id,full_name');
  const staffStatus = await mapById(
    db,
    'staff_users',
    members.map((row) => String(row.id)),
    'id,status',
  );
  const rows = members
    .map((row) => ({
      ostNumber: row.ost_number ?? null,
      name: String(row.full_name ?? 'Unknown'),
      email: ctx.masked ? maskEmail(row.email) : (row.email ?? null),
      phone: ctx.masked ? maskPhone(row.phone) : (row.phone ?? null),
      sponsor: staffName(sponsors, row.sponsor_staff_id),
      staffStatus: staffStatus.get(String(row.id))?.status ?? null,
      ostStatus: row.status ?? null,
      approvedAt: isoOrNull(row.approved_at),
    }))
    .filter((row) =>
      matchesSearch(ctx.q.search, [
        row.ostNumber,
        row.name,
        row.email,
        row.phone,
        row.sponsor,
        row.ostStatus,
        row.staffStatus,
      ]),
    );
  return {
    rows,
    total: rows.length,
    summary: { members: rows.length },
    columns: [
      { key: 'ostNumber', label: 'OST number', type: 'text' },
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'sponsor', label: 'Sponsor', type: 'text' },
      { key: 'staffStatus', label: 'Staff status', type: 'text' },
      { key: 'ostStatus', label: 'OST status', type: 'text' },
      { key: 'approvedAt', label: 'Approved', type: 'date' },
    ],
    summaryLines: [`OST members: ${rows.length}`],
  };
}

async function buildPoints(ctx: Ctx): Promise<ReportData> {
  const { db, principal, kind, window, q } = ctx;
  const saleIds = await scopedSaleIds(db, principal, kind);
  let membershipIds: string[] | null = null;
  if (saleIds) {
    const data = await readSearchRows(
      db
        .from('memberships')
        .select('id')
        .in('sale_id', saleIds.length ? saleIds : [])
        .order('id'),
    );
    membershipIds = ((data ?? []) as Row[]).map((row) => String(row.id));
  }
  let accountQuery = db.from('points_accounts').select('id,membership_id');
  if (membershipIds) {
    accountQuery = accountQuery.in('membership_id', membershipIds.length ? membershipIds : []);
  }
  const accountData = await readSearchRows(accountQuery.order('id'));
  const accountIds = ((accountData ?? []) as Row[]).map((row) => String(row.id));
  const accountToMembership = new Map<string, string>(
    ((accountData ?? []) as Row[]).map((row) => [String(row.id), String(row.membership_id)]),
  );
  let query = db.from('points_ledger').select('*', { count: 'exact' });
  if (membershipIds) query = query.in('account_id', accountIds.length ? accountIds : []);
  if (q.status) query = query.eq('entry_type', q.status);
  if (window.from) query = query.gte('created_at', window.from);
  if (window.to) query = query.lte('created_at', window.to);
  const data = await readSearchRows(
    query.order('created_at', { ascending: false }).order('id', { ascending: false }),
  );
  const entries = ((data ?? []) as Row[]).filter((row) =>
    inReportWindow(row.created_at, window.from, window.to),
  );
  const memberIds = [
    ...new Set(entries.map((row) => accountToMembership.get(String(row.account_id)) ?? '')),
  ].filter(Boolean);
  const memberRows = await mapById(
    db,
    'memberships',
    memberIds,
    'id,membership_number,customer_id',
  );
  const customerIds = [
    ...new Set([...memberRows.values()].map((m) => String(m.customer_id))),
  ].filter(Boolean);
  const customers = await mapById(
    db,
    'customers',
    customerIds,
    'id,first_name,middle_name,last_name,suffix',
  );
  const rows = entries
    .map((row) => {
      const membershipId = accountToMembership.get(String(row.account_id)) ?? null;
      const membership = membershipId ? (memberRows.get(membershipId) ?? null) : null;
      const customer = membership ? customers.get(String(membership.customer_id)) : undefined;
      return {
        date: row.created_at,
        membershipNumber: membership?.membership_number ?? null,
        customer: customer ? displayName(customer) : null,
        entryType: row.entry_type,
        amount: Number(row.amount ?? 0),
        balanceAfter: Number(row.balance_after ?? 0),
        reference: [row.reference_type, row.reference_id].filter(Boolean).join(':') || null,
        reason: row.reason ?? null,
      };
    })
    .filter((row) =>
      matchesSearch(q.search, [row.customer, row.membershipNumber, row.reference, row.entryType]),
    );
  const net = rows.reduce((sum, row) => sum + Number(row.amount), 0);
  const byType: Record<string, number> = {};
  for (const row of rows)
    byType[String(row.entryType)] = (byType[String(row.entryType)] ?? 0) + Number(row.amount);
  return {
    rows,
    total: rows.length,
    summary: { entries: rows.length, netPoints: net, byType },
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'membershipNumber', label: 'Membership', type: 'text' },
      { key: 'customer', label: 'Customer', type: 'text' },
      { key: 'entryType', label: 'Entry type', type: 'text' },
      { key: 'amount', label: 'Points', type: 'number' },
      { key: 'balanceAfter', label: 'Balance after', type: 'number' },
      { key: 'reference', label: 'Reference', type: 'text' },
      { key: 'reason', label: 'Reason', type: 'text' },
    ],
    summaryLines: [
      `Ledger entries: ${rows.length}  |  Net points: ${net} (no monetary value, no expiry inferred)`,
    ],
  };
}

async function buildPlans(ctx: Ctx): Promise<ReportData> {
  const { db, principal, kind, q } = ctx;
  // No PostgREST embed: the fake only resolves embeds against explicitly
  // declared links, and a category name is a trivial second lookup anyway.
  const { data, error } = await db.from('card_plans').select('*');
  if (error) throw error;
  let plans = (data ?? []) as Row[];
  plans = plans.filter((row) => matchesSearch(q.search, [row.name, row.code]));
  if (q.status === 'active') plans = plans.filter((row) => row.is_active === true);
  if (q.status === 'inactive') plans = plans.filter((row) => row.is_active !== true);
  const saleIds = await scopedSaleIds(db, principal, kind);
  let saleQuery = db
    .from('card_sales')
    .select('plan_id,cash_price_snapshot')
    .eq('origin', 'normal');
  if (saleIds) saleQuery = saleQuery.in('id', saleIds.length ? saleIds : []);
  const salesData = await readSearchRows(
    saleQuery
      .in(
        'plan_id',
        plans.map((row) => String(row.id)),
      )
      .order('id'),
  );
  const countByPlan = new Map<string, number>();
  const valueByPlan = new Map<string, bigint>();
  for (const sale of (salesData ?? []) as Row[]) {
    const id = String(sale.plan_id);
    countByPlan.set(id, (countByPlan.get(id) ?? 0) + 1);
    valueByPlan.set(id, (valueByPlan.get(id) ?? 0n) + centsOf(sale.cash_price_snapshot));
  }
  const categoryIds = [...new Set(plans.map((row) => String(row.category_id ?? '')))].filter(
    Boolean,
  );
  const categories = await mapById(db, 'card_categories', categoryIds, 'id,name');
  const rows = plans.map((row) => ({
    code: row.code,
    name: row.name,
    category: categories.get(String(row.category_id ?? ''))?.name ?? null,
    cashPrice: row.cash_price ?? '0.00',
    installmentPrice: row.installment_price ?? '0.00',
    reservationFee: row.reservation_fee ?? '0.00',
    validityYears:
      row.validity_years === null || row.validity_years === undefined
        ? null
        : Number(row.validity_years),
    yearlyPoints: Number(row.yearly_points ?? 0),
    annualPointsTranches: Number(row.annual_points_tranches ?? 1),
    discountPercent: Number(row.discount_percent ?? 0),
    baseValidityYears: Number(row.base_validity_years ?? row.validity_years ?? 1),
    validityExtensionYears: Number(row.validity_extension_years ?? 0),
    cardholderLimit: Number(row.cardholder_limit ?? 1),
    priorityReservation: row.priority_reservation === true,
    noMonthlyAnnualDues: row.no_monthly_annual_dues === true,
    totalLoyaltyValue: row.total_loyalty_value ?? '0.00',
    commissionRate: row.commission_rate ?? null,
    isActive: row.is_active === true,
    scopedSales: countByPlan.get(String(row.id)) ?? 0,
    scopedValue: moneyOf(valueByPlan.get(String(row.id)) ?? 0n),
  }));
  return {
    rows,
    total: rows.length,
    summary: {
      plans: rows.length,
      active: rows.filter((row) => row.isActive).length,
      scopedSales: [...countByPlan.values()].reduce((sum, n) => sum + n, 0),
    },
    columns: [
      { key: 'code', label: 'Code', type: 'text' },
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'cashPrice', label: 'Spot cash price', type: 'money' },
      { key: 'installmentPrice', label: 'Installment price', type: 'money' },
      { key: 'reservationFee', label: 'Reservation fee', type: 'money' },
      { key: 'validityYears', label: 'Validity (years)', type: 'number' },
      { key: 'yearlyPoints', label: 'Yearly points', type: 'number' },
      { key: 'annualPointsTranches', label: 'Annual tranches', type: 'number' },
      { key: 'discountPercent', label: 'Discount (%)', type: 'number' },
      { key: 'baseValidityYears', label: 'Base validity (years)', type: 'number' },
      { key: 'validityExtensionYears', label: 'Extension (years)', type: 'number' },
      { key: 'cardholderLimit', label: 'Cardholder limit', type: 'number' },
      { key: 'priorityReservation', label: 'Priority reservation', type: 'text' },
      { key: 'noMonthlyAnnualDues', label: 'No monthly/annual dues', type: 'text' },
      { key: 'totalLoyaltyValue', label: 'Total loyalty value', type: 'money' },
      { key: 'commissionRate', label: 'Legacy plan rate', type: 'text' },
      { key: 'isActive', label: 'Active', type: 'text' },
      { key: 'scopedSales', label: 'Sales in scope', type: 'number' },
      { key: 'scopedValue', label: 'Value in scope', type: 'money' },
    ],
    summaryLines: [`Card plans: ${rows.length}`],
  };
}

const BUILDERS: Record<ReportType, (ctx: Ctx) => Promise<ReportData>> = {
  sales: buildSales,
  customers: buildCustomers,
  payments: buildPayments,
  memberships: buildMemberships,
  commissions: buildCommissions,
  redemptions: buildRedemptions,
  genealogy: buildGenealogy,
  ost: buildOst,
  points: buildPoints,
  plans: buildPlans,
};

/* ------------------------------------------------------------------ */
/* Audit Center                                                        */
/* ------------------------------------------------------------------ */

async function serveAudit(req: VercelRequest, res: VercelResponse, db: Db): Promise<void> {
  const auth = await authorizeAfHomes(req, 'governance.audit');
  if ('error' in auth) return deny(res, auth);
  const parsed = auditQuerySchema.safeParse(req.query);
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid audit query', 400);
  const input = parsed.data;
  let window: { from: string | null; to: string | null };
  try {
    window = parseReportWindow(input.from, input.to);
  } catch {
    return fail(res, 'VALIDATION_ERROR', 'Invalid date filter', 400);
  }
  try {
    let query = db.from('audit_events').select('*', { count: 'exact' });
    if (input.actor) query = query.eq('actor_id', input.actor);
    if (input.action) query = query.eq('action', input.action);
    if (input.entityType) query = query.eq('entity_type', input.entityType);
    if (input.entityId) query = query.eq('entity_id', input.entityId);
    if (window.from) query = query.gte('created_at', window.from);
    if (window.to) query = query.lte('created_at', window.to);
    if (input.format === 'json') {
      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(input.offset, input.offset + input.limit - 1);
      if (error) throw error;
      const actorIds = [
        ...new Set(
          ((data ?? []) as Row[])
            .map((row) => isoOrNull(row.actor_id))
            .filter((id): id is string => id !== null),
        ),
      ];
      const actors = actorIds.length
        ? await db
            .from('staff_users')
            .select('id,full_name,staff_role_assignments(roles(name))')
            .in('id', actorIds)
        : { data: [], error: null };
      if (actors.error) throw actors.error;
      const actorNames = new Map<string, { name: string; role: string | null }>();
      for (const person of (actors.data ?? []) as Row[]) {
        const assignments = Array.isArray(person.staff_role_assignments)
          ? person.staff_role_assignments
          : [];
        const assignment: unknown = assignments[0];
        const role =
          assignment && typeof assignment === 'object' && 'roles' in assignment
            ? assignment.roles
            : null;
        actorNames.set(String(person.id), {
          name: String(person.full_name ?? 'Staff account'),
          role: role && typeof role === 'object' && 'name' in role ? String(role.name) : null,
        });
      }
      const events = ((data ?? []) as Row[]).map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        actorId: isoOrNull(row.actor_id),
        actorName: actorNames.get(String(row.actor_id))?.name ?? null,
        actorRole: actorNames.get(String(row.actor_id))?.role ?? null,
        action: String(row.action ?? ''),
        entityType: String(row.entity_type ?? ''),
        entityId:
          row.entity_id === null || row.entity_id === undefined ? null : String(row.entity_id),
        summary: auditSummary(
          String(row.action ?? ''),
          String(row.entity_type ?? ''),
          row.entity_id ? String(row.entity_id) : null,
        ),
        metadata: sanitizeAuditValue({
          ...((row.after_data as Row | null) ?? {}),
          ...(row.reason ? { reason: row.reason } : {}),
        }) as Record<string, unknown>,
      }));
      return res.status(200).json({
        report: 'audit',
        generatedAt: new Date().toISOString(),
        scope: { kind: 'global', viewerRole: auth.roleSlug, label: `Audit (${auth.roleSlug})` },
        window,
        filters: {
          actor: input.actor ?? null,
          action: input.action ?? null,
          entityType: input.entityType ?? null,
        },
        summary: { events: count ?? events.length },
        data: events,
        meta: { total: count ?? events.length, limit: input.limit, offset: input.offset },
      });
    }
    const { data, error, count } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    const total = count ?? ((data ?? []) as Row[]).length;
    if (total > REPORT_EXPORT_CAP) {
      return fail(
        res,
        'VALIDATION_ERROR',
        `Audit export exceeds the ${REPORT_EXPORT_CAP}-row cap - narrow the filters`,
        400,
      );
    }
    const events = ((data ?? []) as Row[]).map((row) => ({
      id: String(row.id ?? ''),
      timestamp: String(row.created_at ?? ''),
      actor: row.actor_id ? String(row.actor_id) : '',
      action: String(row.action ?? ''),
      entity: String(row.entity_type ?? ''),
      entityId: row.entity_id ? String(row.entity_id) : '',
      summary: auditSummary(
        String(row.action ?? ''),
        String(row.entity_type ?? ''),
        row.entity_id ? String(row.entity_id) : null,
      ),
      metadata: JSON.stringify(sanitizeAuditValue(row.after_data ?? row.before_data ?? {})).slice(
        0,
        1000,
      ),
    }));
    return sendExport(
      res,
      'audit',
      input.format,
      events,
      [
        { key: 'id', label: 'ID', type: 'text' },
        { key: 'timestamp', label: 'Timestamp', type: 'date' },
        { key: 'actor', label: 'Actor', type: 'text' },
        { key: 'action', label: 'Action', type: 'text' },
        { key: 'entity', label: 'Entity', type: 'text' },
        { key: 'entityId', label: 'Entity ID', type: 'text' },
        { key: 'summary', label: 'Summary', type: 'text' },
        { key: 'metadata', label: 'Metadata (redacted)', type: 'text' },
      ],
      [`Audit events: ${events.length}`],
      'Audit log',
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[api] reports/audit:', error instanceof Error ? error.message : error);
    return fail(res, 'INTERNAL', 'Internal server error', 500);
  }
}

/* ------------------------------------------------------------------ */
/* Export envelope                                                     */
/* ------------------------------------------------------------------ */

function sendExport(
  res: VercelResponse,
  report: string,
  format: 'csv' | 'xlsx' | 'pdf',
  rows: Row[],
  columns: Column[],
  summaryLines: string[],
  title: string,
): void {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `afhomes-${report}-${stamp}.${format}`;
  const matrix = rows.map((row) => columns.map((col) => row[col.key] ?? ''));
  if (format === 'csv') {
    const content = Buffer.from(
      toCsv(
        columns.map((col) => col.label),
        matrix,
      ),
      'utf8',
    ).toString('base64');
    return res.status(200).json({
      report,
      format,
      filename,
      mime: 'text/csv',
      encoding: 'base64',
      content,
      rowCount: rows.length,
      total: rows.length,
      truncated: false,
      generatedAt: new Date().toISOString(),
    });
  }
  if (format === 'xlsx') {
    const bytes = toXlsx(title, columns, matrix);
    return res.status(200).json({
      report,
      format,
      filename,
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      encoding: 'base64',
      content: Buffer.from(bytes).toString('base64'),
      rowCount: rows.length,
      total: rows.length,
      truncated: false,
      generatedAt: new Date().toISOString(),
    });
  }
  const pdf = toPdf({
    title: `AF Homes - ${title}`,
    generatedAt: new Date().toISOString(),
    scopeLabel: 'server-scoped',
    windowLabel: 'all dates in scope',
    summaryLines,
    headers: columns.map((col) => col.label),
    rows: matrix.map((row) => row.map((cell) => String(cell ?? ''))),
  });
  return res.status(200).json({
    report,
    format,
    filename,
    mime: 'application/pdf',
    encoding: 'base64',
    content: Buffer.from(pdf).toString('base64'),
    rowCount: Math.min(rows.length, PDF_MAX_ROWS),
    total: rows.length,
    truncated: false,
    generatedAt: new Date().toISOString(),
  });
}

/* ------------------------------------------------------------------ */
/* Entry                                                               */
/* ------------------------------------------------------------------ */

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (method(req) !== 'GET') return fail(res, 'NOT_FOUND', 'Report endpoint not found', 404);
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);
  const path = subPath(req);

  if (path === 'audit') return serveAudit(req, res, db);

  if (path === '') {
    const principal = await authorizeAfHomes(req, 'dashboard.view');
    if ('error' in principal) return deny(res, principal);
    return res.status(200).json({
      reports: (Object.keys(BUILDERS) as ReportType[])
        .filter((report) => principal.roleSlug !== 'employee' || report === 'redemptions')
        .map((report) => ({ report })),
      audit: true,
    });
  }

  const type = reportTypeSchema.safeParse(path);
  if (!type.success) return fail(res, 'NOT_FOUND', 'Report endpoint not found', 404);
  const report = type.data;

  const parsed = reportQuerySchema.safeParse(req.query);
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid report query', 400);
  const input = parsed.data;

  // The OST gate mirrors `ost.ts`: an OST caller without the review grants
  // may still read their OWN member row (the staff handler allows the same
  // self-read). Every other caller needs the report's module grant.
  let auth:
    AfHomesPrincipal | { error: { error: { code: string; message: string }; status: number } };
  if (report === 'ost') {
    const self = await authorizeAfHomes(req, 'dashboard.view');
    if (!('error' in self) && reportScopeKind(self) === 'self') auth = self;
    else auth = await authorizeReport(req, report);
  } else {
    auth = await authorizeReport(req, report);
  }
  if ('error' in auth) return deny(res, auth);

  let window: { from: string | null; to: string | null };
  if (auth.roleSlug === 'employee' && report !== 'redemptions')
    return fail(res, 'FORBIDDEN', 'Employees may only access their handled redemption report', 403);
  try {
    window = parseReportWindow(input.from, input.to);
  } catch {
    return fail(res, 'VALIDATION_ERROR', 'Invalid date filter', 400);
  }

  // Scope narrowing lives inside each builder (`scopedSaleIds`, sponsor
  // equality, `redeemed_by` equality). The gate above already denied every
  // caller without the report's module grant, so a scoped kind can only ever
  // shrink what the gate allowed - never widen it.
  const kind = reportScopeKind(auth);

  try {
    const q: Record<string, string | undefined> = {
      status: input.status,
      planId: input.planId,
      seller: input.seller,
      role: input.role,
      itemId: input.itemId,
      kind: input.kind,
      search: input.search,
      transactionType: input.transactionType,
    };
    const ctx: Ctx = {
      db,
      principal: auth,
      kind,
      window,
      q,
      masked: kind === 'team' || kind === 'self',
    };
    const built = await BUILDERS[report](ctx);

    if (input.format !== 'json') {
      if (built.total > REPORT_EXPORT_CAP) {
        return fail(
          res,
          'VALIDATION_ERROR',
          `Report exceeds the ${REPORT_EXPORT_CAP}-row export cap - narrow the filters`,
          400,
        );
      }
      // Re-run without pagination when the screen page is a slice: builders
      // already return the full scoped set, so exports reuse it directly.
      return sendExport(
        res,
        report,
        input.format,
        built.rows,
        built.columns,
        built.summaryLines,
        `${report} report`,
      );
    }

    const page = built.rows.slice(input.offset, input.offset + input.limit);
    const body = {
      report,
      generatedAt: new Date().toISOString(),
      scope: { kind, viewerRole: auth.roleSlug, label: scopeLabel(kind, auth) },
      window,
      filters: {
        status: input.status ?? null,
        planId: input.planId ?? null,
        seller: input.seller ?? null,
        role: input.role ?? null,
        itemId: input.itemId ?? null,
        kind: input.kind ?? null,
        search: input.search ?? null,
        transactionType: input.transactionType ?? null,
      },
      summary: built.summary,
      data: page,
      meta: { total: built.total, limit: input.limit, offset: input.offset },
    };
    const checked = reportResponseSchema.safeParse(body);
    if (!checked.success) return fail(res, 'INTERNAL', 'Report could not be rendered', 500);
    return res.status(200).json(checked.data);
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      const err = error as { status: number; code: string; message: string };
      return fail(res, err.code as never, err.message, err.status);
    }
    // eslint-disable-next-line no-console
    console.error('[api] reports:', error instanceof Error ? error.message : error);
    return fail(res, 'INTERNAL', 'Internal server error', 500);
  }
}

export { reportExportSchema };
