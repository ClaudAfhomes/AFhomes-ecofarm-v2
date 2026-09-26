import type {
  AdminQueues,
  CommissionReportRow,
  ContentKind,
  OperationalSummaryReport,
  SalesCommissionsReport,
  SalesReportRow,
  SalesTrendReport,
  Withdrawal,
} from '@jad/contracts';
import { CMS_PROPERTIES_SEED, STAFF_MODULE_LABEL, roleNameFor } from '@jad/contracts';
import { multiplyMoney, addMoney } from '@jad/shared';
import type { MockRequestContext, MockRoute } from '@jad/mock';
import { contentStore, createStoreContent, deleteStoreContent } from './contentMockStore';
import { configStore, updateStoreConfig } from './configMockStore';
import { broadcastStore, createStoreBroadcast } from './broadcastMockStore';
import {
  createStorePolicy,
  deleteStorePolicy,
  policyStore,
  updateStorePolicy,
} from './policyMockStore';
import { inquiryStore, updateStoreInquiry } from './inquiryMockStore';
import { createStoreProgram, programStore, updateStoreProgram } from './programMockStore';

import {
  MOCK_SALES,
  MOCK_PAYOUT_ACCOUNTS,
  MOCK_WITHDRAWALS,
  MOCK_PROPERTIES,
  MOCK_ADJUSTMENTS,
  MOCK_AUDIT,
  MOCK_MEMBERS,
} from './data';
import {
  appendStaffAudit,
  createRole as createStoreRole,
  createStaffMember as createStoreStaffMember,
  deleteRole as deleteStoreRole,
  deleteStaffMember as deleteStoreStaffMember,
  getRoleById,
  staffStore,
  STAFF_AUDIT_ACTIONS,
  updateRole as updateStoreRole,
  updateStaffMember,
} from './staffMockStore';
import { guardRolePermissions } from '../features/roles/guards';
import { registrationStore, type AdminMember } from './registrationMockStore';
import { messagesMockStore, staffUnreadFor } from './messagesMockStore';
import {
  assignMockVoucher,
  createMockVoucher,
  deleteMockVoucherTemplate,
  mockVoucherById,
  mockVoucherTemplateById,
  redeemMockVoucher,
  scanMockVoucher,
  updateMockVoucherTemplate,
  voucherStore,
} from './voucherMockStore';

function idFromPath(url: string, pattern: RegExp): string | undefined {
  return pattern.exec(new URL(url, 'http://mock.local').pathname)?.[1];
}

/** Stash of archived AdminMember rows so mock restore is lossless. */
const archivedMemberStash = new Map<string, AdminMember>();

/** Clear mock-only archive/restore state (specs call this alongside store resets). */
export function resetMockMemberLifecycle(): void {
  archivedMemberStash.clear();
}

type WithdrawalStatusSnapshot = {
  status: Withdrawal['status'];
  completedAt?: string;
  rejectedAt?: string;
  rejectionReason?: string;
};

const withdrawalStatusStash = new Map<string, WithdrawalStatusSnapshot>();

/** Restore any mock-withdrawal mutations made by complete/reject handlers. */
export function resetMockWithdrawals(): void {
  for (const [id, snapshot] of withdrawalStatusStash) {
    const row = MOCK_WITHDRAWALS.find((w) => w.id === id);
    if (row) Object.assign(row, snapshot);
  }
  withdrawalStatusStash.clear();
}

function notFound(entity: string) {
  return {
    body: {
      error: {
        code: 'NOT_FOUND',
        message: `${entity} not found`,
        timestamp: new Date().toISOString(),
      },
    },
    status: 404 as const,
  };
}

/** Report range from the request URL (`?from=YYYY-MM-DD&to=YYYY-MM-DD`). */
function reportRangeFromUrl(url: string): { from: string | null; to: string | null } {
  const query = new URL(url, 'http://mock.local').searchParams;
  const from = query.get('from');
  const to = query.get('to');
  return { from: from ?? null, to: to ?? null };
}

function inMockRange(submittedAt: string, range: { from: string | null; to: string | null }) {
  if (range.from && submittedAt < `${range.from}T00:00:00.000Z`) return false;
  if (range.to && submittedAt >= `${range.to}T23:59:59.999Z`) return false;
  return true;
}

const EARNING_SALE_STATUSES = ['PAYMENT_VERIFIED', 'QUALIFYING_SALE', 'LOCKED'] as const;

/** Mock commissions derived from the sales store (8% direct-rate snapshot). */
function mockCommissionsFor(sales: typeof MOCK_SALES): CommissionReportRow[] {
  return sales
    .filter((sale) => (EARNING_SALE_STATUSES as readonly string[]).includes(sale.status))
    .map((sale) => ({
      id: `com-rpt-${sale.id}`,
      saleId: sale.id,
      memberName: sale.sellerName,
      commissionType: 'DIRECT_COMMISSION' as const,
      amount: multiplyMoney(sale.propertyValue, '0.0800'),
      status: (sale.status === 'PAYMENT_VERIFIED' ? 'PENDING' : 'AVAILABLE') as
        'PENDING' | 'AVAILABLE',
      createdAt: sale.submittedAt,
      ...(sale.status === 'QUALIFYING_SALE' || sale.status === 'LOCKED'
        ? { clearedAt: sale.submittedAt }
        : {}),
    }));
}

function fail(message: string) {
  const status = /not found|does not exist/i.test(message)
    ? 404
    : /already exists|reassign|last role|super admin/i.test(message)
      ? 409
      : 400;
  return {
    body: {
      error: {
        code: status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : 'VALIDATION_ERROR',
        message,
        timestamp: new Date().toISOString(),
      },
    },
    status: status as 400 | 404 | 409,
  };
}

/**
 * Admin mock API (API-shaped, F0). Each handler returns contract-valid JSON
 * exactly as the real endpoint would. Detail routes use `match:'prefix'` with
 * regex id extraction from the URL - the mock server passes `MockRequestContext`
 * (not a `params` object) to response/handler functions.
 */
export const adminMockHandlers: MockRoute[] = [
  {
    path: '/admin/queues',
    response: (): AdminQueues => ({
      registrations: registrationStore.registrations.filter((row) => row.status === 'PENDING')
        .length,
      // Mirror the real endpoint: headline sales figure counts only
      // recognized (qualifying) sales; submitted pipeline is its own queue.
      sales: MOCK_SALES.filter((s) => s.status === 'QUALIFYING_SALE').length,
      salesSubmitted: MOCK_SALES.filter((s) => s.status === 'SUBMITTED').length,
      salesReadyToQualify: MOCK_SALES.filter((s) => s.status === 'PAYMENT_VERIFIED').length,
      members: MOCK_MEMBERS.length,
      // Mirror the real endpoint: withdrawals tile counts only pending-action
      // rows (REQUESTED/RESERVED) - completed/rejected history excluded.
      withdrawals: MOCK_WITHDRAWALS.filter(
        (w) => w.status === 'REQUESTED' || w.status === 'RESERVED',
      ).length,
    }),
  },
  {
    path: '/admin/reports/sales-commissions',
    response: (ctx: MockRequestContext) => {
      const range = reportRangeFromUrl(ctx.url);
      const sales: SalesReportRow[] = MOCK_SALES.filter((sale) =>
        inMockRange(sale.submittedAt, range),
      ).map((sale) => ({
        id: sale.id,
        propertyName: sale.propertyName,
        sellerName: sale.sellerName,
        status: sale.status,
        propertyValue: sale.propertyValue,
        ...(typeof sale.referrerName === 'string' && sale.referrerName.length > 0
          ? { referrerName: sale.referrerName }
          : {}),
        submittedAt: sale.submittedAt,
      }));
      const commissions = mockCommissionsFor(MOCK_SALES)
        .filter((row) => sales.some((sale) => sale.id === row.saleId))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const salesByStatus: SalesCommissionsReport['summary']['salesByStatus'] = {
        SUBMITTED: { count: 0, total: '0.00' },
        ADMIN_APPROVED: { count: 0, total: '0.00' },
        PAYMENT_VERIFIED: { count: 0, total: '0.00' },
        QUALIFYING_SALE: { count: 0, total: '0.00' },
        REJECTED: { count: 0, total: '0.00' },
        LOCKED: { count: 0, total: '0.00' },
      };
      let salesValueTotal = '0.00';
      for (const sale of sales) {
        const slot = salesByStatus[sale.status];
        slot.count += 1;
        slot.total = addMoney(slot.total, sale.propertyValue);
        salesValueTotal = addMoney(salesValueTotal, sale.propertyValue);
      }
      const commissionsByStatus: SalesCommissionsReport['summary']['commissionsByStatus'] = {
        PENDING: { count: 0, total: '0.00' },
        AVAILABLE: { count: 0, total: '0.00' },
        CANCELLED: { count: 0, total: '0.00' },
        REVERSED: { count: 0, total: '0.00' },
      };
      for (const row of commissions) {
        const slot = commissionsByStatus[row.status];
        slot.count += 1;
        slot.total = addMoney(slot.total, row.amount);
      }
      const report: SalesCommissionsReport = {
        range,
        generatedAt: new Date().toISOString(),
        sales,
        commissions,
        summary: {
          salesCount: sales.length,
          salesValueTotal,
          salesByStatus,
          commissionsByStatus,
        },
      };
      return report;
    },
  },
  {
    path: '/admin/reports/summary',
    response: (): OperationalSummaryReport => {
      const members = registrationStore.members;
      const withdrawalRows: { amount: string; status: string }[] = MOCK_WITHDRAWALS.map((w) => ({
        amount: w.amount,
        status: w.status,
      }));
      const commissionRows: { amount: string; status: string }[] = mockCommissionsFor(
        MOCK_SALES,
      ).map((c) => ({ amount: c.amount, status: c.status }));
      const pendingWithdrawals = withdrawalRows.filter(
        (row) => row.status === 'REQUESTED' || row.status === 'RESERVED',
      );
      const saleStatuses = MOCK_SALES.map((s) => s.status);
      const count = (rows: { status: string }[], status: string) =>
        rows.filter((row) => row.status === status).length;
      const sum = (rows: { amount: string; status: string }[], status?: string): string => {
        let total = '0.00';
        for (const row of rows) {
          if (status !== undefined && row.status !== status) continue;
          total = addMoney(total, row.amount);
        }
        return total;
      };
      return {
        generatedAt: new Date().toISOString(),
        members: {
          active: members.filter((m) => m.accountStatus === 'ACTIVE').length,
          inactive: members.filter((m) => m.accountStatus === 'INACTIVE').length,
          archived: 0,
        },
        registrations: {
          total: registrationStore.registrations.length,
          pending: registrationStore.registrations.filter((row) => row.status === 'PENDING').length,
          rejected: registrationStore.registrations.filter((row) => row.status === 'REJECTED')
            .length,
        },
        sales: {
          total: saleStatuses.length,
          byStatus: {
            SUBMITTED: saleStatuses.filter((s) => s === 'SUBMITTED').length,
            ADMIN_APPROVED: saleStatuses.filter((s) => s === 'ADMIN_APPROVED').length,
            PAYMENT_VERIFIED: saleStatuses.filter((s) => s === 'PAYMENT_VERIFIED').length,
            QUALIFYING_SALE: saleStatuses.filter((s) => s === 'QUALIFYING_SALE').length,
            REJECTED: saleStatuses.filter((s) => s === 'REJECTED').length,
            LOCKED: saleStatuses.filter((s) => s === 'LOCKED').length,
          },
        },
        withdrawals: {
          pendingCount: pendingWithdrawals.length,
          pendingTotal: sum(pendingWithdrawals),
          completedCount: count(withdrawalRows, 'COMPLETED'),
          completedTotal: sum(withdrawalRows, 'COMPLETED'),
          rejectedCount: count(withdrawalRows, 'REJECTED'),
        },
        commissions: {
          pendingCount: count(commissionRows, 'PENDING'),
          pendingTotal: sum(commissionRows, 'PENDING'),
          availableCount: count(commissionRows, 'AVAILABLE'),
          availableTotal: sum(commissionRows, 'AVAILABLE'),
        },
        inquiries: {
          new: inquiryStore.items.filter((item) => item.status === 'NEW').length,
        },
      };
    },
  },
  {
    path: '/admin/reports/sales-trend',
    response: (ctx: MockRequestContext) => {
      const query = new URL(ctx.url, 'http://mock.local').searchParams;
      const granularity =
        query.get('granularity') === 'year' ? ('year' as const) : ('month' as const);
      const zero = { count: 0, total: '0.00' };
      const aggregated = (keys: string[], keyOf: (d: Date) => string) => {
        const buckets = new Map(keys.map((key) => [key, { ...zero }]));
        for (const sale of MOCK_SALES) {
          const date = new Date(sale.submittedAt);
          if (Number.isNaN(date.getTime())) continue;
          const bucket = buckets.get(keyOf(date));
          if (!bucket) continue;
          bucket.count += 1;
          bucket.total = addMoney(bucket.total, sale.propertyValue);
        }
        return keys.map((key) => ({ key, ...(buckets.get(key) ?? zero) }));
      };
      let periods: { key: string; count: number; total: string }[];
      if (granularity === 'month') {
        const keys: string[] = [];
        for (let i = 11; i >= 0; i -= 1) {
          const d = new Date();
          d.setUTCDate(1);
          d.setUTCMonth(d.getUTCMonth() - i);
          keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
        }
        periods = aggregated(
          keys,
          (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
        );
      } else {
        const years = new Set(
          MOCK_SALES.map((sale) => new Date(sale.submittedAt).getUTCFullYear()),
        );
        const current = new Date().getUTCFullYear();
        const start = Math.min(...years, current);
        const yearKeys: string[] = [];
        for (let year = start; year <= current; year += 1) yearKeys.push(String(year));
        periods = aggregated(yearKeys, (d) => String(d.getUTCFullYear()));
      }
      const trend: SalesTrendReport = {
        granularity,
        generatedAt: new Date().toISOString(),
        periods,
      };
      return trend;
    },
  },
  {
    path: '/admin/registrations',
    response: () => {
      const data = registrationStore.registrations;
      return {
        data,
        meta: {
          page: 1,
          pageSize: 10,
          total: data.length,
          invalid: 0,
        },
      };
    },
  },
  {
    path: '/admin/registrations/',
    match: 'prefix',
    handler: (ctx: MockRequestContext) => {
      const id = idFromPath(ctx.url, /\/admin\/registrations\/([^/?#]+)/);
      if (!id) return notFound('Registration');
      const reg = registrationStore.registrations.find((r) => r.id === id);
      if (!reg) return notFound('Registration');
      return reg;
    },
  },
  {
    path: '/admin/members',
    response: () => {
      const data = registrationStore.members;
      return {
        data,
        meta: {
          page: 1,
          pageSize: 10,
          total: data.length,
        },
      };
    },
  },
  {
    path: '/admin/members/archived',
    response: () => {
      const data = registrationStore.archived;
      return {
        data,
        meta: {
          page: 1,
          pageSize: 10,
          total: data.length,
        },
      };
    },
  },
  {
    path: '/admin/members/',
    match: 'prefix',
    handler: (ctx: MockRequestContext) => {
      const pathname = new URL(ctx.url, 'http://mock.local').pathname;
      // POST .../:id/archive - move to the archived roster (mirrors the API).
      const archiveMatch = /\/admin\/members\/([^/?#]+)\/archive$/.exec(pathname);
      if (archiveMatch) {
        const id = archiveMatch[1]!;
        const index = registrationStore.members.findIndex((m) => m.id === id);
        if (index === -1) return notFound('Member');
        const member = registrationStore.members[index]!;
        if (registrationStore.archived.some((a) => a.memberId === id)) {
          return fail('Member is already archived.');
        }
        archivedMemberStash.set(id, member);
        registrationStore.members.splice(index, 1);
        registrationStore.archived.push({
          id: `arch-${member.id}`,
          memberId: member.id,
          originalData: {
            id: member.id,
            firstName: member.firstName,
            lastName: member.lastName,
            dateOfBirth: member.dateOfBirth,
            age: member.age,
            gender: member.gender,
            address: member.address,
            countryCode: member.countryCode,
            countryName: member.countryName,
            phone: member.phone,
            email: member.email,
            referralCode: member.referralCode,
            status: member.status,
            isQualified: member.isQualified,
            program: member.program,
          },
          archivedAt: new Date().toISOString(),
          archivedBy: 'mock-admin',
          previousStatus: member.status,
          previousAccountStatus: member.accountStatus,
        });
        return { archivedId: id };
      }
      // POST .../:id/restore - return to the active roster.
      const restoreMatch = /\/admin\/members\/([^/?#]+)\/restore$/.exec(pathname);
      if (restoreMatch) {
        const raw = restoreMatch[1]!;
        const memberId = raw.startsWith('arch-') ? raw.slice('arch-'.length) : raw;
        const index = registrationStore.archived.findIndex((a) => a.memberId === memberId);
        if (index === -1) return notFound('Archived member');
        const record = registrationStore.archived[index]!;
        registrationStore.archived.splice(index, 1);
        const stashed = archivedMemberStash.get(memberId);
        if (stashed && !registrationStore.members.some((m) => m.id === memberId)) {
          registrationStore.members.push(stashed);
        }
        archivedMemberStash.delete(memberId);
        return { id: record.memberId, restored: true };
      }
      const id = idFromPath(ctx.url, /\/admin\/members\/([^/?#]+)/);
      if (!id) return notFound('Member');
      // DELETE .../:id - purge from the mock roster (mirrors the API shape).
      if (ctx.method === 'DELETE') {
        const index = registrationStore.members.findIndex((m) => m.id === id);
        if (index === -1) return notFound('Member');
        registrationStore.members.splice(index, 1);
        return { purgedId: id, authRemoved: true };
      }
      const member = registrationStore.members.find((m) => m.id === id);
      if (!member) return notFound('Member');
      return member;
    },
  },
  {
    path: '/admin/sales',
    response: () => ({
      data: MOCK_SALES,
      meta: {
        page: 1,
        pageSize: 10,
        total: MOCK_SALES.length,
      },
    }),
  },
  {
    path: '/admin/sales/',
    match: 'prefix',
    handler: (ctx: MockRequestContext) => {
      const id = idFromPath(ctx.url, /\/admin\/sales\/([^/?#]+)/);
      if (!id) return notFound('Sale');
      const sale = MOCK_SALES.find((s) => s.id === id);
      if (!sale) return notFound('Sale');
      // Mirror the sale_delete guard: qualifying (credited) sales cannot be
      // deleted; other sales are removed with their mock commissions.
      if (ctx.method === 'DELETE') {
        if (sale.status === 'QUALIFYING_SALE') {
          return {
            status: 409,
            body: {
              error: {
                code: 'CONFLICT',
                message: 'This sale has credited commissions and cannot be deleted.',
              },
            },
          };
        }
        const index = MOCK_SALES.findIndex((s) => s.id === id);
        if (index !== -1) MOCK_SALES.splice(index, 1);
        return { id, deleted: true };
      }
      // Configured rates for the estimate preview (mirrors GET /admin/sales/:id).
      const rateOf = (key: string) => configStore.entries.find((e) => e.key === key)?.value;
      const direct = rateOf('COMMISSION_DIRECT_RATE');
      const referral = rateOf('COMMISSION_REFERRAL_RATE');
      if (ctx.method === 'GET' && direct && referral) {
        return { ...sale, commissionRates: { direct, referral } };
      }
      return sale;
    },
  },
  {
    path: '/admin/properties',
    response: {
      data: MOCK_PROPERTIES,
      meta: {
        page: 1,
        pageSize: 10,
        total: MOCK_PROPERTIES.length,
      },
    },
  },
  {
    path: '/admin/properties/',
    match: 'prefix',
    handler: (ctx: MockRequestContext) => {
      const id = idFromPath(ctx.url, /\/admin\/properties\/([^/?#]+)/);
      if (!id) return notFound('Property');
      const prop = MOCK_PROPERTIES.find((p) => p.id === id);
      if (!prop) return notFound('Property');
      return prop;
    },
  },
  {
    // Merged category view mirroring GET /admin/property-categories
    // (test double only - production reads the real endpoint).
    path: '/admin/property-categories',
    response: () => {
      const data = CMS_PROPERTIES_SEED.categories.map((cat) => ({
        ...cat,
        listingCount: MOCK_PROPERTIES.filter((p) => p.categoryId === cat.slug).length,
      }));
      return {
        data,
        meta: { page: 1, pageSize: data.length, total: data.length },
      };
    },
  },
  {
    path: '/admin/payouts',
    response: {
      data: MOCK_PAYOUT_ACCOUNTS,
      meta: {
        page: 1,
        pageSize: 10,
        total: MOCK_PAYOUT_ACCOUNTS.length,
      },
    },
  },
  {
    path: '/admin/withdrawals',
    response: {
      data: MOCK_WITHDRAWALS,
      meta: {
        page: 1,
        pageSize: 10,
        total: MOCK_WITHDRAWALS.length,
      },
    },
  },
  {
    // POST /admin/withdrawals/:id/complete|reject - mirrors the real API's
    // guarded transitions so the queue UI tests exercise the await + refetch
    // path instead of local optimistic state.
    path: '/admin/withdrawals/',
    match: 'prefix',
    handler: (ctx: MockRequestContext) => {
      if (ctx.method !== 'POST') return notFound('Withdrawal');
      const id = idFromPath(ctx.url, /\/admin\/withdrawals\/([^/?#]+)\/(?:complete|reject)$/);
      if (!id) return notFound('Withdrawal');
      const row = MOCK_WITHDRAWALS.find((w) => w.id === id);
      if (!row) return notFound('Withdrawal');
      if (/\/complete$/.test(ctx.url)) {
        if (row.status !== 'REQUESTED' && row.status !== 'RESERVED') {
          return fail(`Only reserved withdrawals can be completed (current: ${row.status}).`);
        }
        withdrawalStatusStash.set(id, {
          status: row.status,
          completedAt: row.completedAt,
          rejectedAt: row.rejectedAt,
          rejectionReason: row.rejectionReason,
        });
        (row as { status: Withdrawal['status']; completedAt?: string }).status = 'COMPLETED';
        row.completedAt = new Date().toISOString();
        return { body: row, status: 200 };
      }
      const reason = ((ctx.body ?? {}) as { rejectionReason?: unknown }).rejectionReason;
      if (typeof reason !== 'string' || reason.trim().length === 0) {
        return fail('Rejection reason is required.');
      }
      if (row.status !== 'REQUESTED' && row.status !== 'RESERVED') {
        return fail(`Only reserved withdrawals can be rejected (current: ${row.status}).`);
      }
      withdrawalStatusStash.set(id, {
        status: row.status,
        completedAt: row.completedAt,
        rejectedAt: row.rejectedAt,
        rejectionReason: row.rejectionReason,
      });
      const patch = row as {
        status: Withdrawal['status'];
        rejectedAt?: string;
        rejectionReason?: string;
      };
      patch.status = 'REJECTED';
      patch.rejectedAt = new Date().toISOString();
      patch.rejectionReason = reason.trim();
      return { body: row, status: 200 };
    },
  },
  {
    // Voucher definitions - "Create Voucher" list + create (title + value).
    path: '/admin/voucher-templates',
    handler: (ctx: MockRequestContext) => {
      if (ctx.method === 'POST') {
        try {
          const input = (ctx.body ?? {}) as Record<string, unknown>;
          const definition = createMockVoucher({
            title: String(input.title ?? ''),
            originalValue: String(input.originalValue ?? ''),
          });
          return { body: definition, status: 201 };
        } catch (e) {
          return fail((e as Error).message);
        }
      }
      const items = voucherStore.definitions;
      return {
        data: items,
        meta: { page: 1, pageSize: items.length, total: items.length },
      };
    },
  },
  {
    path: '/admin/voucher-templates/',
    match: 'prefix',
    handler: (ctx: MockRequestContext) => {
      const id = idFromPath(ctx.url, /\/admin\/voucher-templates\/([^/?#]+)/);
      if (!id) return notFound('Voucher');
      if (ctx.method === 'PATCH') {
        try {
          const input = (ctx.body ?? {}) as Record<string, unknown>;
          const definition = updateMockVoucherTemplate(id, {
            ...(typeof input.title === 'string' ? { title: input.title } : {}),
            ...(input.expiresAt === null
              ? { expiresAt: null }
              : typeof input.expiresAt === 'string'
                ? { expiresAt: input.expiresAt }
                : {}),
            ...(input.validityDays === null
              ? { validityDays: null }
              : typeof input.validityDays === 'number'
                ? { validityDays: input.validityDays }
                : {}),
          });
          return { body: definition, status: 200 };
        } catch (e) {
          return fail((e as Error).message);
        }
      }
      if (ctx.method === 'DELETE') {
        try {
          deleteMockVoucherTemplate(id);
          return { body: { id, deleted: true }, status: 200 };
        } catch {
          return notFound('Voucher');
        }
      }
      const definition = mockVoucherTemplateById(id);
      if (!definition) return notFound('Voucher');
      return { body: definition, status: 200 };
    },
  },
  {
    path: '/admin/vouchers/assign',
    method: 'POST',
    handler: (ctx: MockRequestContext) => {
      try {
        const input = (ctx.body ?? {}) as Record<string, unknown>;
        const voucher = assignMockVoucher({
          templateId: String(input.templateId ?? ''),
          memberId: String(input.memberId ?? ''),
          expiresAt: typeof input.expiresAt === 'string' ? input.expiresAt : undefined,
          validityDays: typeof input.validityDays === 'number' ? input.validityDays : undefined,
        });
        return { body: voucher, status: 201 };
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  },
  {
    // All issued member vouchers with member linkage (assignments list).
    path: '/admin/vouchers',
    handler: (ctx: MockRequestContext) => {
      const templateId = new URL(ctx.url, 'http://mock.local').searchParams.get('templateId');
      const items = templateId
        ? voucherStore.vouchers.filter((a) => a.templateId === templateId)
        : voucherStore.vouchers;
      return {
        data: items,
        meta: { page: 1, pageSize: items.length, total: items.length },
      };
    },
  },
  {
    path: '/admin/vouchers/scan',
    method: 'POST',
    handler: (ctx: MockRequestContext) => {
      const input = (ctx.body ?? {}) as { code?: unknown };
      if (typeof input.code !== 'string' || !input.code.trim())
        return fail('A voucher code is required.');
      try {
        return { body: scanMockVoucher(input.code.trim()), status: 200 };
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  },
  {
    path: '/admin/vouchers/',
    match: 'prefix',
    handler: (ctx: MockRequestContext) => {
      const id = idFromPath(ctx.url, /\/admin\/vouchers\/([^/]+)(?:\/redeem)?$/);
      if (!id) return notFound('Voucher');
      if (ctx.method === 'POST' && ctx.url.includes('/redeem')) {
        try {
          return { body: redeemMockVoucher(id), status: 200 };
        } catch (e) {
          return fail((e as Error).message);
        }
      }
      const voucher = mockVoucherById(id);
      if (!voucher) return notFound('Voucher');
      if (ctx.method === 'DELETE') {
        const index = voucherStore.vouchers.findIndex((v) => v.id === id);
        if (index >= 0) voucherStore.vouchers.splice(index, 1);
        return { body: { id, deleted: true }, status: 200 };
      }
      if (ctx.method === 'GET') return { body: voucher, status: 200 };
      return notFound('Voucher');
    },
  },
  {
    path: '/admin/content',
    method: 'POST',
    handler: (ctx: MockRequestContext) => {
      const input = (ctx.body ?? {}) as Record<string, unknown>;
      try {
        const item = createStoreContent({
          title: String(input.title ?? ''),
          description: typeof input.description === 'string' ? input.description : undefined,
          kind: (input.kind ?? 'DOCUMENT') as ContentKind,
          downloadUrl: String(input.downloadUrl ?? ''),
        });
        return { body: item, status: 201 };
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  },
  {
    path: '/admin/content',
    response: () => {
      const data = contentStore.items;
      return {
        data,
        meta: {
          page: 1,
          pageSize: 10,
          total: data.length,
        },
      };
    },
  },
  {
    path: '/admin/content/',
    method: 'DELETE',
    match: 'prefix',
    handler: (ctx: MockRequestContext) => {
      const id = idFromPath(ctx.url, /\/admin\/content\/([^/?#]+)/);
      if (!id || !deleteStoreContent(id)) return notFound('Marketing tool');
      return { body: { id, deleted: true, fileRemoved: false }, status: 200 };
    },
  },
  {
    path: '/admin/content/',
    method: 'PATCH',
    match: 'prefix',
    handler: (ctx: MockRequestContext) => {
      const id = idFromPath(ctx.url, /\/admin\/content\/([^/?#]+)/);
      const patch = (ctx.body ?? {}) as Record<string, unknown>;
      const item = contentStore.items.find((i) => i.id === id);
      if (!item) return notFound('Marketing tool');
      if (typeof patch.title === 'string' && patch.title.trim()) item.title = patch.title.trim();
      if (typeof patch.description === 'string')
        item.description = patch.description.trim() || undefined;
      if (typeof patch.kind === 'string' && patch.kind) {
        item.kind = patch.kind as ContentKind;
      }
      if (patch.downloadUrl === null) {
        delete item.downloadUrl;
        delete item.share;
      } else if (typeof patch.downloadUrl === 'string' && patch.downloadUrl) {
        item.downloadUrl = patch.downloadUrl;
        item.share = {
          messengerUrl: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(patch.downloadUrl)}`,
          viberUrl: `https://www.viber.com/forward?text=${encodeURIComponent(item.title)}`,
          copyUrl: patch.downloadUrl,
        };
      }
      return { body: item, status: 200 };
    },
  },
  {
    path: '/broadcasts',
    method: 'POST',
    handler: (ctx: MockRequestContext) => {
      const input = (ctx.body ?? {}) as Record<string, unknown>;
      try {
        const item = createStoreBroadcast({
          title: String(input.title ?? ''),
          body: typeof input.body === 'string' ? input.body : undefined,
        });
        return { body: item, status: 201 };
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  },
  {
    path: '/admin/broadcasts',
    response: () => {
      const data = broadcastStore.items;
      return {
        data,
        meta: {
          page: 1,
          pageSize: data.length,
          total: data.length,
        },
      };
    },
  },
  {
    path: '/policies',
    method: 'POST',
    handler: (ctx: MockRequestContext) => {
      const input = (ctx.body ?? {}) as Record<string, unknown>;
      try {
        const item = createStorePolicy({
          title: String(input.title ?? ''),
          slug: String(input.slug ?? ''),
          type: String(input.type ?? ''),
          content: typeof input.content === 'string' ? input.content : undefined,
          documentUrl: String(input.documentUrl ?? ''),
        });
        return { body: item, status: 201 };
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  },
  {
    path: '/policies',
    response: () => {
      const data = policyStore.items;
      return {
        data,
        meta: {
          page: 1,
          pageSize: data.length,
          total: data.length,
        },
      };
    },
  },
  {
    path: '/policies/',
    method: 'PUT',
    match: 'prefix',
    handler: (ctx: MockRequestContext) => {
      const id = idFromPath(ctx.url, /\/policies\/([^/?#]+)/);
      const patch = (ctx.body ?? {}) as Record<string, unknown>;
      const item = id
        ? updateStorePolicy(id, {
            ...(typeof patch.title === 'string' && { title: patch.title }),
            ...(typeof patch.slug === 'string' && { slug: patch.slug }),
            ...(typeof patch.type === 'string' && { type: patch.type }),
            ...(typeof patch.content === 'string' && { content: patch.content }),
            ...(typeof patch.documentUrl === 'string' && { documentUrl: patch.documentUrl }),
          })
        : undefined;
      if (!item) return notFound('Policy');
      return { body: item, status: 200 };
    },
  },
  {
    path: '/policies/',
    method: 'DELETE',
    match: 'prefix',
    handler: (ctx: MockRequestContext) => {
      const id = idFromPath(ctx.url, /\/policies\/([^/?#]+)/);
      if (!id || !deleteStorePolicy(id)) return notFound('Policy');
      return { body: { id, deleted: true }, status: 200 };
    },
  },
  {
    path: '/admin/inquiries',
    response: () => {
      const data = inquiryStore.items;
      return {
        data,
        meta: {
          page: 1,
          pageSize: data.length,
          total: data.length,
        },
      };
    },
  },
  {
    path: '/admin/inquiries/',
    method: 'PATCH',
    match: 'prefix',
    handler: (ctx: MockRequestContext) => {
      const id = idFromPath(ctx.url, /\/inquiries\/([^/?#]+)/);
      const status = (ctx.body as Record<string, unknown> | null)?.status;
      const item =
        id && (status === 'NEW' || status === 'READ' || status === 'ARCHIVED')
          ? updateStoreInquiry(id, status)
          : undefined;
      if (!item) return notFound('Inquiry');
      return { body: item, status: 200 };
    },
  },
  {
    path: '/admin/adjustments',
    response: {
      data: MOCK_ADJUSTMENTS,
      meta: {
        page: 1,
        pageSize: 10,
        total: MOCK_ADJUSTMENTS.length,
      },
    },
  },
  {
    path: '/admin/config',
    response: () => {
      const data = configStore.entries;
      return {
        data,
        meta: {
          page: 1,
          pageSize: 50,
          total: data.length,
        },
      };
    },
  },
  {
    path: '/admin/config/',
    match: 'prefix',
    method: 'PATCH',
    handler: (ctx: MockRequestContext) => {
      const key = idFromPath(ctx.url, /\/admin\/config\/([^/?#]+)/);
      if (!key) return notFound('Config entry');
      const patch = (ctx.body ?? {}) as Record<string, unknown>;
      if (typeof patch.value !== 'string' || patch.value.length === 0) {
        return fail('A non-empty string value is required');
      }
      const updated = updateStoreConfig(decodeURIComponent(key), patch.value);
      if (!updated) return notFound('Config entry');
      return { body: updated, status: 200 };
    },
  },
  {
    path: '/admin/programs',
    method: 'POST',
    handler: (ctx: MockRequestContext) => {
      const input = (ctx.body ?? {}) as Record<string, unknown>;
      try {
        const item = createStoreProgram({
          code: String(input.code ?? ''),
          name: String(input.name ?? ''),
          description: typeof input.description === 'string' ? input.description : undefined,
          isActive: typeof input.isActive === 'boolean' ? input.isActive : true,
        });
        return { body: item, status: 201 };
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  },
  {
    path: '/admin/programs',
    response: () => {
      const data = programStore.items;
      return {
        data,
        meta: { page: 1, pageSize: data.length, total: data.length },
      };
    },
  },
  {
    path: '/admin/programs/',
    method: 'PATCH',
    match: 'prefix',
    handler: (ctx: MockRequestContext) => {
      const id = idFromPath(ctx.url, /\/admin\/programs\/([^/?#]+)/);
      const patch = (ctx.body ?? {}) as Record<string, unknown>;
      let item;
      try {
        item = id
          ? updateStoreProgram(id, {
              ...(typeof patch.code === 'string' && { code: patch.code }),
              ...(typeof patch.name === 'string' && { name: patch.name }),
              ...(typeof patch.description === 'string' && { description: patch.description }),
              ...(typeof patch.isActive === 'boolean' && { isActive: patch.isActive }),
            })
          : undefined;
      } catch (e) {
        return fail((e as Error).message);
      }
      if (!item) return notFound('Program');
      return { body: item, status: 200 };
    },
  },
  {
    path: '/programs',
    response: () => {
      // Public list: active programs only (mirrors the API handler).
      const data = programStore.items.filter((program) => program.isActive);
      return {
        data,
        meta: {
          page: 1,
          pageSize: 10,
          total: data.length,
        },
      };
    },
  },
  {
    path: '/admin/audit',
    response: {
      data: MOCK_AUDIT,
      meta: {
        page: 1,
        pageSize: 10,
        total: MOCK_AUDIT.length,
      },
    },
  },
  {
    path: '/admin/staff',
    method: 'GET',
    response: () => {
      const data = staffStore.members;
      return {
        data,
        meta: {
          page: 1,
          pageSize: 10,
          total: data.length,
        },
      };
    },
  },
  {
    path: '/admin/staff/',
    match: 'prefix',
    method: 'GET',
    handler: (ctx: MockRequestContext) => {
      const id = idFromPath(ctx.url, /\/admin\/staff\/([^/?#]+)/);
      if (!id) return notFound('Staff member');
      const member = staffStore.members.find((s) => s.id === id);
      if (!member) return notFound('Staff member');
      return member;
    },
  },
  {
    path: '/admin/roles',
    method: 'GET',
    response: () => {
      const data = staffStore.roles;
      return {
        data,
        meta: {
          page: 1,
          pageSize: 20,
          total: data.length,
        },
      };
    },
  },
  {
    path: '/admin/roles/',
    match: 'prefix',
    method: 'GET',
    handler: (ctx: MockRequestContext) => {
      const id = idFromPath(ctx.url, /\/admin\/roles\/([^/?#]+)/);
      if (!id) return notFound('Role');
      const role = staffStore.roles.find((r) => r.id === id);
      if (!role) return notFound('Role');
      return role;
    },
  },
  {
    path: '/admin/roles',
    method: 'POST',
    handler: (ctx: MockRequestContext) => {
      const input = (ctx.body ?? {}) as Record<string, unknown>;
      try {
        const role = createStoreRole({
          name: String(input.name ?? ''),
          permissions: (Array.isArray(input.permissions) ? input.permissions : []) as never,
          createdBy: String(input.actor ?? 'Unknown'),
        });
        appendStaffAudit({
          action: STAFF_AUDIT_ACTIONS.ROLE_CREATED,
          actor: String(input.actor ?? 'Unknown'),
          actorRole: String(input.actorRole ?? 'ADMIN'),
          targetType: 'Role',
          targetId: role.id,
          targetName: role.name,
          detail: `Created role with modules: ${role.permissions.map((m) => STAFF_MODULE_LABEL[m as keyof typeof STAFF_MODULE_LABEL] ?? m).join(', ')}`,
        });
        return { body: role, status: 201 };
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  },
  {
    path: '/admin/roles/',
    match: 'prefix',
    method: 'PATCH',
    handler: (ctx: MockRequestContext) => {
      const id = idFromPath(ctx.url, /\/admin\/roles\/([^/?#]+)/);
      const input = (ctx.body ?? {}) as Record<string, unknown>;
      try {
        if (!id) throw new Error('Role does not exist');
        const current = getRoleById(id);
        if (!current) throw new Error('Role does not exist');
        if (input.permissions !== undefined) {
          const governance = guardRolePermissions(staffStore.roles, id, input.permissions as never);
          if (!governance.ok) throw new Error(governance.reason);
        }
        const previousName = current.name;
        const previousPermissions = [...current.permissions];
        const updated = updateStoreRole(id, {
          ...(input.name !== undefined ? { name: String(input.name) } : {}),
          ...(input.permissions !== undefined ? { permissions: input.permissions as never } : {}),
        })!;
        const changes: string[] = [];
        if (input.name !== undefined && previousName !== updated.name) {
          changes.push(`renamed from ${previousName} to ${updated.name}`);
        }
        if (input.permissions !== undefined) {
          const label = (m: string) =>
            STAFF_MODULE_LABEL[m as keyof typeof STAFF_MODULE_LABEL] ?? m;
          const added = updated.permissions.filter((m) => !previousPermissions.includes(m));
          const removed = previousPermissions.filter((m) => !updated.permissions.includes(m));
          const parts: string[] = [];
          if (added.length > 0) parts.push(`granted ${added.map(label).join(', ')}`);
          if (removed.length > 0) parts.push(`revoked ${removed.map(label).join(', ')}`);
          if (parts.join('; ')) changes.push(parts.join('; '));
        }
        appendStaffAudit({
          action: STAFF_AUDIT_ACTIONS.ROLE_PERMISSIONS_UPDATED,
          actor: String(input.actor ?? 'Unknown'),
          actorRole: String(input.actorRole ?? 'ADMIN'),
          targetType: 'Role',
          targetId: updated.id,
          targetName: updated.name,
          detail: changes.length > 0 ? changes.join('; ') : 'No changes',
        });
        return updated;
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  },
  {
    path: '/admin/roles/',
    match: 'prefix',
    method: 'DELETE',
    handler: (ctx: MockRequestContext) => {
      const id = idFromPath(ctx.url, /\/admin\/roles\/([^/?#]+)/);
      const input = (ctx.body ?? {}) as Record<string, unknown>;
      try {
        if (!id) throw new Error('Role does not exist');
        if (String(input.actorRole ?? '').toUpperCase() !== 'SUPER_ADMIN') {
          throw new Error('Only super admins can delete roles.');
        }
        const current = getRoleById(id);
        if (!current) throw new Error('Role does not exist');
        deleteStoreRole(id);
        appendStaffAudit({
          action: STAFF_AUDIT_ACTIONS.ROLE_DELETED,
          actor: String(input.actor ?? 'Unknown'),
          actorRole: String(input.actorRole ?? 'ADMIN'),
          targetType: 'Role',
          targetId: current.id,
          targetName: current.name,
          detail: `Deleted role ${current.name}`,
        });
        return { id: current.id, deleted: true };
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  },
  {
    path: '/admin/staff',
    method: 'POST',
    handler: (ctx: MockRequestContext) => {
      const input = (ctx.body ?? {}) as Record<string, unknown>;
      try {
        const member = createStoreStaffMember({
          name: String(input.name ?? ''),
          email: String(input.email ?? ''),
          roleId: String(input.roleId ?? ''),
          createdBy: String(input.actor ?? 'Unknown'),
        });
        appendStaffAudit({
          action: STAFF_AUDIT_ACTIONS.CREATED,
          actor: String(input.actor ?? 'Unknown'),
          actorRole: String(input.actorRole ?? 'ADMIN'),
          targetType: 'Staff',
          targetId: member.id,
          targetName: member.name,
          detail: `Created staff account with role ${roleNameFor(staffStore.roles, member.roleId)}`,
        });
        return { body: member, status: 201 };
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  },
  {
    // PATCH /admin/session - update the signed-in staff display name. The
    // mock has no session identity, so it applies to the first roster member
    // (tests render that principal); production resolves the caller server-side.
    path: '/admin/session',
    method: 'PATCH',
    handler: (ctx: MockRequestContext) => {
      const input = (ctx.body ?? {}) as Record<string, unknown>;
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name) return fail('Enter a display name.');
      const member = staffStore.members[0];
      if (!member) return notFound('Staff profile');
      member.name = name;
      return {
        body: {
          id: member.id,
          email: member.email,
          name: member.name,
          status: member.status,
          slugs: ['super_admin'],
          mustChangePassword: false,
        },
        status: 200,
      };
    },
  },
  {
    // POST /admin/session/password - change own staff password. Use
    // currentPassword 'wrong-current' to simulate a rejection in tests.
    path: '/admin/session/password',
    method: 'POST',
    handler: (ctx: MockRequestContext) => {
      const input = (ctx.body ?? {}) as Record<string, unknown>;
      const current = typeof input.currentPassword === 'string' ? input.currentPassword : '';
      const next = typeof input.newPassword === 'string' ? input.newPassword : '';
      if (!current || next.length < 8) return fail('Enter the current and a new password (min 8).');
      if (current === 'wrong-current') {
        return {
          body: {
            error: {
              code: 'UNAUTHORIZED',
              message: 'Current password is incorrect.',
              timestamp: new Date().toISOString(),
            },
          },
          status: 401,
        };
      }
      return { body: { changed: true }, status: 200 };
    },
  },
  {
    path: '/admin/staff/',
    match: 'prefix',
    method: 'PATCH',
    handler: (ctx: MockRequestContext) => {
      const id = idFromPath(ctx.url, /\/admin\/staff\/([^/?#]+)/);
      const input = (ctx.body ?? {}) as Record<string, unknown>;
      try {
        if (!id) throw new Error('Staff member not found');
        const current = staffStore.members.find((m) => m.id === id);
        if (!current) throw new Error('Staff member not found');
        if (input.roleId !== undefined) {
          if (!getRoleById(String(input.roleId))) throw new Error('Selected role does not exist');
        }
        const previousRoleId = current.roleId;
        const updated = updateStaffMember(id, {
          ...(input.roleId !== undefined ? { roleId: String(input.roleId) } : {}),
          ...(input.status !== undefined ? { status: input.status as 'ACTIVE' | 'DISABLED' } : {}),
        })!;
        if (input.roleId !== undefined) {
          appendStaffAudit({
            action: STAFF_AUDIT_ACTIONS.ROLE_ASSIGNED,
            actor: String(input.actor ?? 'Unknown'),
            actorRole: String(input.actorRole ?? 'ADMIN'),
            targetType: 'Staff',
            targetId: updated.id,
            targetName: updated.name,
            detail: `Changed role from ${roleNameFor(staffStore.roles, previousRoleId)} to ${roleNameFor(staffStore.roles, updated.roleId)}`,
          });
        }
        if (input.status !== undefined) {
          appendStaffAudit({
            action:
              input.status === 'ACTIVE'
                ? STAFF_AUDIT_ACTIONS.ENABLED
                : STAFF_AUDIT_ACTIONS.DISABLED,
            actor: String(input.actor ?? 'Unknown'),
            actorRole: String(input.actorRole ?? 'ADMIN'),
            targetType: 'Staff',
            targetId: updated.id,
            targetName: updated.name,
            detail: input.status === 'ACTIVE' ? 'Re-enabled staff access' : 'Disabled staff access',
          });
        }
        return updated;
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  },
  {
    path: '/admin/staff/',
    match: 'prefix',
    method: 'DELETE',
    handler: (ctx: MockRequestContext) => {
      const id = idFromPath(ctx.url, /\/admin\/staff\/([^/?#]+)/);
      const input = (ctx.body ?? {}) as Record<string, unknown>;
      try {
        if (!id) throw new Error('Staff member not found');
        const removed = deleteStoreStaffMember(id);
        if (!removed) throw new Error('Staff member not found');
        appendStaffAudit({
          action: STAFF_AUDIT_ACTIONS.DELETED,
          actor: String(input.actor ?? 'Unknown'),
          actorRole: String(input.actorRole ?? 'ADMIN'),
          targetType: 'Staff',
          targetId: removed.id,
          targetName: removed.name,
          detail: `Deleted staff account ${removed.name} (${removed.email})`,
        });
        return { id: removed.id, deleted: true };
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  },
  {
    path: '/admin/audit-log',
    response: () => {
      const data = [...MOCK_AUDIT, ...staffStore.auditEntries].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      return {
        data,
        meta: {
          page: 1,
          pageSize: data.length,
          total: data.length,
        },
      };
    },
  },
  {
    path: '/admin/messages/summary',
    response: () => {
      const unreadCount = messagesMockStore.conversations.reduce(
        (sum, c) => sum + staffUnreadFor(c.memberId),
        0,
      );
      return {
        unreadCount,
        unreadConversations: messagesMockStore.conversations.filter(
          (c) => staffUnreadFor(c.memberId) > 0,
        ).length,
      };
    },
  },
  {
    path: '/admin/conversations',
    response: () => {
      const data = messagesMockStore.conversations
        .map((conversation) => {
          const thread = messagesMockStore.messages
            .filter((m) => m.memberId === conversation.memberId)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          const latest = thread[0];
          return {
            memberId: conversation.memberId,
            memberName: conversation.memberName,
            memberEmail: conversation.memberEmail,
            lastMessageAt: latest?.createdAt,
            lastMessagePreview: latest ? latest.body.slice(0, 140) : undefined,
            unreadCount: staffUnreadFor(conversation.memberId),
          };
        })
        .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));
      return {
        data,
        meta: {
          page: 1,
          pageSize: data.length,
          total: data.length,
        },
      };
    },
  },
  {
    path: '/admin/conversations/',
    match: 'prefix',
    handler: (ctx: MockRequestContext) => {
      const id = idFromPath(ctx.url, /\/admin\/conversations\/([^/]+)/);
      if (!id) return notFound('Conversation');
      const conversation = messagesMockStore.conversations.find((c) => c.memberId === id);
      const memberExists =
        conversation !== undefined || registrationStore.members.some((m) => m.id === id);
      if (!memberExists) return notFound('Member');
      if (ctx.method === 'GET') {
        // Thread, newest first (cursor/limit handled client-side over the page).
        const thread = messagesMockStore.messages
          .filter((m) => m.memberId === id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
        return {
          data: thread.map((m) => ({
            id: m.id,
            senderType: m.senderType,
            senderName: m.senderName,
            body: m.body,
            createdAt: m.createdAt,
          })),
          meta: { pagination: {} },
        };
      }
      if (ctx.method === 'POST' && ctx.url.includes('/messages')) {
        const body = (ctx.body ?? {}) as { body?: unknown };
        if (typeof body.body !== 'string' || body.body.trim().length === 0) {
          return fail('Enter a message.');
        }
        const trimmed = body.body.trim();
        if (trimmed.length > 4000) return fail('Message is too long.');
        const message = {
          id: `msg-${String(messagesMockStore.messages.length + 1).padStart(3, '0')}`,
          memberId: id,
          senderType: 'STAFF' as const,
          senderName: 'Ada Admin',
          body: trimmed,
          createdAt: new Date().toISOString(),
        };
        if (!conversation) {
          const member = registrationStore.members.find((m) => m.id === id);
          messagesMockStore.conversations.push({
            memberId: id,
            memberName: member ? `${member.firstName} ${member.lastName}` : 'Member',
            memberEmail: member?.email ?? '',
          });
        }
        messagesMockStore.messages.push(message);
        return {
          body: {
            id: message.id,
            senderType: message.senderType,
            senderName: message.senderName,
            body: message.body,
            createdAt: message.createdAt,
          },
          status: 201,
        };
      }
      if (ctx.method === 'POST' && ctx.url.includes('/read')) {
        const existing = messagesMockStore.conversations.find((c) => c.memberId === id);
        if (existing) {
          existing.staffLastReadAt = new Date().toISOString();
        } else {
          const member = registrationStore.members.find((m) => m.id === id);
          messagesMockStore.conversations.push({
            memberId: id,
            memberName: member ? `${member.firstName} ${member.lastName}` : 'Member',
            memberEmail: member?.email ?? '',
            staffLastReadAt: new Date().toISOString(),
          });
        }
        return { readAt: new Date().toISOString() };
      }
      return notFound('Conversation');
    },
  },
];
