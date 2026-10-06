import {
  afHomesModuleKeySchema,
  changeAfHomesStaffPasswordSchema,
  createAfHomesRoleSchema,
  createAfHomesStaffSchema,
  updateAfHomesStaffProfileSchema,
  type AfHomesPermission,
} from '@afhomes/contracts';
import { z } from 'zod';

import {
  authorizeAfHomes,
  permissionsAreSubset,
  resolveAfHomesPrincipal,
  resolveStaffAccountSetup,
} from '../../_lib/afhomes-access.js';
import { toErrorEnvelope } from '../../_lib/envelope.js';
import type { VercelRequest, VercelResponse } from '../../_lib/http.js';
import { anonClient, serviceClient } from '../../_lib/rest.js';

// All database access in this handler uses the server-only service client after authorization.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

function fail(
  res: VercelResponse,
  code: Parameters<typeof toErrorEnvelope>[0],
  message: string,
  status: number,
) {
  const envelope = toErrorEnvelope(code, message, status);
  res.status(envelope.status).json({ error: envelope.error });
}

function list(res: VercelResponse, data: unknown[]) {
  res.status(200).json({ data, meta: { total: data.length } });
}

async function audit(
  db: Db,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  beforeData?: unknown,
  afterData?: unknown,
) {
  const { error } = await db.from('audit_events').insert({
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    before_data: beforeData ?? null,
    after_data: afterData ?? null,
  });
  if (error) throw new Error(`Audit write failed: ${error.message}`);
}

async function roleCatalog(db: Db) {
  const [{ data: roles, error }, { data: modules }, { data: grants }, { data: assignments }] =
    await Promise.all([
      db.from('roles').select('*').order('name'),
      db.from('modules').select('id,key').eq('is_active', true),
      db.from('role_permissions').select('*'),
      db.from('staff_role_assignments').select('role_id'),
    ]);
  if (error) throw error;
  const moduleById = new Map(
    (modules ?? []).map((m: { id: string; key: string }) => [m.id, m.key]),
  );
  const counts = new Map<string, number>();
  for (const row of assignments ?? []) counts.set(row.role_id, (counts.get(row.role_id) ?? 0) + 1);
  return (roles ?? []).map((role: Record<string, unknown>) => ({
    id: role.id,
    slug: role.slug,
    name: role.name,
    description: role.description ?? null,
    isSystem: role.is_system,
    isActive: role.is_active,
    assignedCount: counts.get(String(role.id)) ?? 0,
    permissions: (grants ?? [])
      .filter((g: Record<string, unknown>) => g.role_id === role.id)
      .map((g: Record<string, unknown>) => ({
        moduleKey: moduleById.get(String(g.module_id)),
        canView: g.can_view,
        canCreate: g.can_create,
        canUpdate: g.can_update,
        canDelete: g.can_delete,
      })),
    createdAt: role.created_at,
    updatedAt: role.updated_at,
  }));
}

async function replaceRolePermissions(db: Db, roleId: string, permissions: AfHomesPermission[]) {
  const { data: modules, error } = await db
    .from('modules')
    .select('id,key')
    .in(
      'key',
      permissions.map((p) => p.moduleKey),
    );
  if (error) throw error;
  const idByKey = new Map((modules ?? []).map((m: { id: string; key: string }) => [m.key, m.id]));
  await db.from('role_permissions').delete().eq('role_id', roleId);
  if (permissions.length === 0) return;
  const rows = permissions.map((p) => ({
    role_id: roleId,
    module_id: idByKey.get(p.moduleKey),
    can_view: p.canView,
    can_create: p.canCreate,
    can_update: p.canUpdate,
    can_delete: p.canDelete,
  }));
  const { error: insertError } = await db.from('role_permissions').insert(rows);
  if (insertError) throw insertError;
}

async function staffCatalog(db: Db) {
  const [
    { data: staff, error },
    { data: assignments },
    { data: roles },
    { data: departments },
    { data: restrictions },
    { data: modules },
  ] = await Promise.all([
    db.from('staff_users').select('*').order('created_at', { ascending: false }),
    db.from('staff_role_assignments').select('*'),
    db.from('roles').select('id,name,slug'),
    db.from('departments').select('id,name'),
    db.from('staff_permission_restrictions').select('*'),
    db.from('modules').select('id,key'),
  ]);
  if (error) throw error;
  const roleById = new Map(
    (roles ?? []).map((r: { id: string; name: string; slug: string }) => [r.id, r]),
  );
  const deptById = new Map(
    (departments ?? []).map((d: { id: string; name: string }) => [d.id, d.name]),
  );
  const moduleById = new Map(
    (modules ?? []).map((m: { id: string; key: string }) => [m.id, m.key]),
  );
  const assignmentByStaff = new Map(
    (assignments ?? []).map((a: { staff_id: string; role_id: string }) => [a.staff_id, a.role_id]),
  );
  return (staff ?? []).flatMap((row: Record<string, unknown>) => {
    const roleId = assignmentByStaff.get(String(row.id));
    const role = roleById.get(roleId) as { name: string } | undefined;
    if (!roleId || !role) return [];
    return [
      {
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        status: row.status,
        departmentId: row.department_id ?? null,
        departmentName: deptById.get(String(row.department_id)) ?? null,
        roleId,
        roleName: role.name,
        employeeNumber: (row.employee_number as string | null | undefined) ?? null,
        salesNumber: (row.sales_number as string | null | undefined) ?? null,
        restrictions: (restrictions ?? [])
          .filter((r: Record<string, unknown>) => r.staff_id === row.id)
          .map((r: Record<string, unknown>) => ({
            moduleKey: moduleById.get(String(r.module_id)),
            denyView: r.deny_view,
            denyCreate: r.deny_create,
            denyUpdate: r.deny_update,
            denyDelete: r.deny_delete,
          })),
        mustChangePassword: row.must_change_password === true,
        invitedAt: row.invited_at ?? null,
        activatedAt: row.activated_at ?? null,
        createdAt: row.created_at,
      },
    ];
  });
}

async function hasReference(db: Db, table: string, column: string, id: string) {
  // Existence probe on the CHECKED column itself. Several blocker tables
  // (card_sale_hierarchy_snapshots, cms_documents) have NO `id` column, so
  // `select('id')` fails closed-live with a 400-turned-500 on EVERY delete
  // instead of answering whether the reference exists.
  const { data, error } = await db.from(table).select(column).eq(column, id).limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

export const STAFF_DELETE_BLOCKER_CHECKS: ReadonlyArray<
  readonly [label: string, table: string, column: string]
> = [
  ['sales', 'card_sales', 'seller_staff_id'],
  ['sales', 'card_sales', 'created_by'],
  ['commissions', 'commissions', 'beneficiary_staff_id'],
  ['commissions', 'commissions', 'qualified_by'],
  ['commissions', 'commissions', 'paid_by'],
  ['genealogy', 'referral_relationships', 'subject_staff_id'],
  ['genealogy', 'referral_relationships', 'upline_staff_id'],
  ['genealogy', 'referral_relationships', 'assigned_by'],
  ['genealogy', 'card_sale_hierarchy_snapshots', 'ancestor_staff_id'],
  ['customer referrals', 'customers', 'referred_by_staff_id'],
  ['customer records', 'customers', 'created_by'],
  ['OST records', 'ost_members', 'id'],
  ['OST records', 'referral_codes', 'sponsor_staff_id'],
  ['OST records', 'referral_codes', 'created_by'],
  ['OST records', 'ost_applications', 'sponsor_staff_id'],
  ['OST records', 'ost_applications', 'reviewed_by'],
  ['OST records', 'ost_members', 'sponsor_staff_id'],
  ['OST records', 'ost_members', 'approved_by'],
  ['redemptions', 'redemptions', 'redeemed_by'],
  ['redemptions', 'redemptions', 'voided_by'],
  ['documents', 'identity_documents', 'uploaded_by'],
  ['documents', 'identity_documents', 'reviewed_by'],
  ['payments', 'payments', 'recorded_by'],
  ['payments', 'payments', 'verified_by'],
  ['memberships', 'memberships', 'activated_by'],
  ['memberships', 'memberships', 'card_issued_by'],
  ['qualification reviews', 'final_qualifications', 'reviewed_by'],
  ['points history', 'points_ledger', 'actor_id'],
  ['customer onboarding', 'customer_onboarding_tokens', 'created_by'],
  ['CMS history', 'cms_documents', 'created_by'],
  ['CMS history', 'cms_documents', 'updated_by'],
  ['CMS history', 'cms_documents', 'published_by'],
  ['CMS history', 'cms_document_versions', 'created_by'],
  ['CMS history', 'cms_pages', 'created_by'],
  ['CMS history', 'cms_pages', 'updated_by'],
  ['CMS history', 'cms_pages', 'published_by'],
  ['CMS history', 'cms_page_versions', 'created_by'],
  ['CMS history', 'cms_media_assets', 'created_by'],
  ['audit history', 'audit_events', 'actor_id'],
  ['staff invitations', 'staff_invitations', 'invited_by'],
];

async function staffDeleteBlockers(db: Db, id: string): Promise<string[]> {
  const results = await Promise.all(
    STAFF_DELETE_BLOCKER_CHECKS.map(async ([label, table, column]) => ({
      label,
      blocked: await hasReference(db, table, column, id),
    })),
  );
  return [...new Set(results.filter((result) => result.blocked).map((result) => result.label))];
}

/* ================================================================== */
/* Test-account purge (super-admin-only, env-gated, fail-closed)        */
/* ================================================================== */
/**
 * Explicit test-account eligibility. ONLY RFC-reserved, undeliverable
 * domains qualify (`example.com/net/org`, any `.invalid` / `.test` /
 * `.localhost` host): such an address can never be a functional real
 * account, so a real staffer cannot be purged by accident. There is no
 * `is_test` column anywhere in the schema - email domain is the marker,
 * and every other safeguard (env flag, Super Admin, typed PURGE, server
 * re-check) still applies. Anything else fails closed with a blocker.
 */
const TEST_EXACT_HOSTS = new Set(['localhost']);
const TEST_BARE_DOMAINS = new Set(['example.com', 'example.net', 'example.org']);

export function isTestAccountEmail(email: unknown): boolean {
  if (typeof email !== 'string') return false;
  const parts = email.trim().toLowerCase().split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const host = parts[1]!;
  if (TEST_EXACT_HOSTS.has(host)) return true;
  // The whole example.com/net/org zone is reserved, including subdomains.
  if (
    TEST_BARE_DOMAINS.has(host) ||
    [...TEST_BARE_DOMAINS].some((domain) => host.endsWith(`.${domain}`))
  ) {
    return true;
  }
  return host.endsWith('.invalid') || host.endsWith('.test') || host.endsWith('.localhost');
}

/**
 * Server environment gate. Anything but an explicit `'true'` fails closed,
 * so production (where the variable is unset) can never serve the endpoint.
 */
export function isTestPurgeEnabled(): boolean {
  return process.env.AFHOMES_ENABLE_TEST_PURGE === 'true';
}

type PurgeBlocker = { blocked: string };
type PurgeCounts = {
  staff: number;
  restrictions: number;
  assignments: number;
  invitations: number;
  sales: number;
  customers: number;
  payments: number;
  memberships: number;
  history: number;
};

async function countWhere(db: Db, table: string, column: string, id: string): Promise<number> {
  // Same rule as hasReference: select the checked column, never a presumed
  // `id` (staff_permission_restrictions and staff_role_assignments key on
  // staff_id and have no id column at all).
  const { data, error } = await db.from(table).select(column).eq(column, id);
  if (error) throw error;
  return (data ?? []).length;
}

async function customerHasActivity(db: Db, customerId: string): Promise<boolean> {
  const probes: Array<[string, string]> = [
    ['card_sales', 'customer_id'],
    ['payments', 'customer_id'],
    ['memberships', 'customer_id'],
    ['redemptions', 'customer_id'],
    ['identity_documents', 'customer_id'],
  ];
  const results = await Promise.all(
    probes.map(async ([table, column]) => {
      const { data, error } = await db.from(table).select('id').eq(column, customerId).limit(1);
      if (error) throw error;
      return (data ?? []).length > 0;
    }),
  );
  return results.some(Boolean);
}

/**
 * Plan a test-account purge: read everything first, then either return the
 * first blocker (fail closed, nothing deleted) or a complete execution plan.
 * Shared/real records are NEVER deleted here - a NOT NULL staff reference on
 * a record that must survive becomes a blocker naming the exact dependency.
 */
async function planTestPurge(
  db: Db,
  targetId: string,
): Promise<{
  blockers: PurgeBlocker[];
  plan: Omit<PurgeCounts, 'staff'> & { disposableCustomers: string[] };
}> {
  const blockers: PurgeBlocker[] = [];
  const block = (reason: string) => blockers.push({ blocked: reason });
  const plan = {
    restrictions: 0,
    assignments: 0,
    invitations: 0,
    sales: 0,
    customers: 0,
    payments: 0,
    memberships: 0,
    history: 0,
    disposableCustomers: [] as string[],
  };

  // Owned sale graphs always block: every live sale carries immutable
  // hierarchy snapshots (the database forbids their deletion), so the sale
  // - and therefore the staff - cannot be purged without destroying them.
  const { data: ownedSales, error: salesError } = await db
    .from('card_sales')
    .select('id,sale_number')
    .eq('seller_staff_id', targetId)
    .limit(1);
  if (salesError) throw salesError;
  if ((ownedSales ?? []).length > 0) {
    block(
      `test sale ${(ownedSales as { sale_number: string }[])[0]!.sale_number} cannot be purged ` +
        'while immutable sale hierarchy snapshots exist',
    );
  }

  // Financial/member records where the target is an actor: a NOT NULL
  // reference on a record that must survive blocks; nullable ones are nulled
  // at execution (the row itself is always preserved).
  const mustSurvive: Array<[string, string, string]> = [
    ['payments', 'recorded_by', 'payment'],
    ['memberships', 'activated_by', 'membership'],
    ['redemptions', 'redeemed_by', 'redemption'],
    ['commissions', 'beneficiary_staff_id', 'commission'],
  ];
  for (const [table, column, kind] of mustSurvive) {
    if (await hasReference(db, table, column, targetId)) {
      block(`a ${kind} record references this account and must be preserved`);
    }
  }

  // Genealogy: the target's own placement row is their history (purged);
  // rows where others point at the target would break their lineage.
  if (await hasReference(db, 'referral_relationships', 'upline_staff_id', targetId)) {
    block('other staff genealogy points at this account as upline');
  }
  if (await hasReference(db, 'card_sale_hierarchy_snapshots', 'ancestor_staff_id', targetId)) {
    block('immutable sale hierarchy snapshots reference this account');
  }

  // OST persons are real accounts: sponsorship or a dual member identity
  // never purges, and sponsors are never reassigned automatically.
  for (const [table, column] of [
    ['ost_applications', 'sponsor_staff_id'],
    ['ost_members', 'sponsor_staff_id'],
    ['ost_members', 'approved_by'],
  ] as const) {
    if (await hasReference(db, table, column, targetId)) {
      block(`an OST record references this account (${table}.${column})`);
    }
  }
  if (await hasReference(db, 'ost_members', 'id', targetId)) {
    block('this account is also an OST member');
  }

  // Referral codes are the target's own objects - unless an application
  // already used one, which drags a real applicant in.
  const { data: codes, error: codesError } = await db
    .from('referral_codes')
    .select('id')
    .or(`sponsor_staff_id.eq.${targetId},created_by.eq.${targetId}`);
  if (codesError) throw codesError;
  for (const code of (codes ?? []) as { id: string }[]) {
    if (await hasReference(db, 'ost_applications', 'referral_code_id', String(code.id))) {
      block('a referral code of this account is in use by an application');
    } else {
      plan.history += 1;
    }
  }

  // Customers attributed to the target: test + disposable => purge; test +
  // active => blocker (its graph cannot purge, see sales above); real =>
  // preserved (the database nulls the attribution itself).
  const { data: attributed, error: attributedError } = await db
    .from('customers')
    .select('id,customer_number,email,auth_user_id')
    .or(`created_by.eq.${targetId},referred_by_staff_id.eq.${targetId}`);
  if (attributedError) throw attributedError;
  for (const customer of (attributed ?? []) as {
    id: string;
    customer_number: string;
    email: string;
    auth_user_id: string | null;
  }[]) {
    // A linked portal login is a real identity even on a test address: the
    // dual-auth rule below preserves it, so it is never disposable here.
    if (customer.auth_user_id) continue;
    if (!isTestAccountEmail(customer.email)) continue;
    if (await customerHasActivity(db, String(customer.id))) {
      block(`test customer ${customer.customer_number} has business activity`);
    } else {
      plan.disposableCustomers.push(String(customer.id));
      plan.customers += 1;
    }
  }

  // CMS: versions are pure history (purged); live documents/pages and media
  // assets are preserved - and their NOT NULL creator columns block instead.
  for (const [table, column] of [
    ['cms_documents', 'created_by'],
    ['cms_documents', 'updated_by'],
    ['cms_documents', 'published_by'],
    ['cms_pages', 'created_by'],
    ['cms_pages', 'updated_by'],
    ['cms_pages', 'published_by'],
    ['cms_media_assets', 'created_by'],
  ] as const) {
    if (await hasReference(db, table, column, targetId)) {
      block(`published CMS content references this account (${table}.${column})`);
    }
  }
  plan.history += await countWhere(db, 'cms_document_versions', 'created_by', targetId);
  plan.history += await countWhere(db, 'cms_page_versions', 'created_by', targetId);

  // Invitations: the target's own invite record purges; invites the target
  // sent purge only when the invitee is also a test account.
  plan.invitations += await countWhere(db, 'staff_invitations', 'auth_user_id', targetId);
  const { data: sent, error: sentError } = await db
    .from('staff_invitations')
    .select('id,email')
    .eq('invited_by', targetId);
  if (sentError) throw sentError;
  for (const invite of (sent ?? []) as { id: string; email: string }[]) {
    if (!isTestAccountEmail(invite.email)) {
      block(`an invitation sent to non-test address ${invite.email} must stay`);
    } else {
      plan.invitations += 1;
    }
  }

  // Own history rows: audit trail, own genealogy placement, onboarding
  // tokens the target issued (pending links other staff can reissue).
  plan.history += await countWhere(db, 'audit_events', 'actor_id', targetId);
  plan.history += await countWhere(db, 'referral_relationships', 'subject_staff_id', targetId);
  plan.history += await countWhere(db, 'customer_onboarding_tokens', 'created_by', targetId);
  plan.restrictions += await countWhere(db, 'staff_permission_restrictions', 'staff_id', targetId);
  plan.assignments += await countWhere(db, 'staff_role_assignments', 'staff_id', targetId);

  return { blockers, plan };
}

async function staffRole(db: Db, id: string) {
  const { data: assignment, error } = await db
    .from('staff_role_assignments')
    .select('role_id')
    .eq('staff_id', id)
    .maybeSingle();
  if (error) throw error;
  if (!assignment) return null;
  const { data: role, error: roleError } = await db
    .from('roles')
    .select('id,slug,name')
    .eq('id', assignment.role_id)
    .maybeSingle();
  if (roleError) throw roleError;
  return role;
}

function cents(values: unknown[]) {
  let total = 0n;
  for (const value of values) {
    const match = String(value ?? '0').match(/^(\d+)(?:\.(\d{1,2}))?$/);
    if (match) total += BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  }
  return `${total / 100n}.${String(total % 100n).padStart(2, '0')}`;
}

async function dashboard(db: Db, range: string) {
  const [
    { data: sales },
    { data: payments },
    { data: memberships },
    { data: qualifications },
    { data: commissions },
    { data: ost },
    { data: ostApplications },
    { data: staff },
  ] = await Promise.all([
    db.from('card_sales').select('status,created_at'),
    db.from('payments').select('status,amount,verified_at'),
    db.from('memberships').select('status,points_balance,activated_at'),
    db.from('final_qualifications').select('status'),
    db.from('commissions').select('status,amount'),
    db.from('ost_members').select('status'),
    db.from('ost_applications').select('status'),
    db.from('staff_users').select('status'),
  ]);
  const verifiedStatuses = new Set([
    'payment_verified',
    'final_qualification_pending',
    'qualified',
    'activated',
  ]);
  const verifiedSales = (sales ?? []).filter((s: { status: string }) =>
    verifiedStatuses.has(s.status),
  ).length;
  const verifiedPayments = (payments ?? []).filter(
    (p: { status: string }) => p.status === 'verified',
  );
  const daysByRange: Record<string, number> = { today: 1, week: 7, month: 31, year: 366 };
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - (daysByRange[range] ?? daysByRange.month!) + 1);
  cutoff.setUTCHours(0, 0, 0, 0);
  const trend = new Map<
    string,
    {
      period: string;
      verifiedSales: number;
      collections: string;
      activatedCards: number;
      pointsRedeemed: number;
      collectionValues: unknown[];
    }
  >();
  const pointFor = (value: unknown) => {
    if (!value) return undefined;
    const date = new Date(String(value));
    if (Number.isNaN(date.valueOf()) || date < cutoff) return undefined;
    const period = date.toISOString().slice(0, 10);
    let point = trend.get(period);
    if (!point) {
      point = {
        period,
        verifiedSales: 0,
        collections: '0.00',
        activatedCards: 0,
        pointsRedeemed: 0,
        collectionValues: [],
      };
      trend.set(period, point);
    }
    return point;
  };
  for (const sale of sales ?? []) {
    if (verifiedStatuses.has(sale.status)) {
      const point = pointFor(sale.created_at);
      if (point) point.verifiedSales += 1;
    }
  }
  for (const payment of verifiedPayments) {
    const point = pointFor(payment.verified_at);
    if (point) point.collectionValues.push(payment.amount);
  }
  for (const membership of memberships ?? []) {
    if (membership.status === 'active') {
      const point = pointFor(membership.activated_at);
      if (point) point.activatedCards += 1;
    }
  }
  const trendPoints = [...trend.values()]
    .sort((a, b) => a.period.localeCompare(b.period))
    .map(({ collectionValues, ...point }) => ({ ...point, collections: cents(collectionValues) }));
  return {
    totals: {
      verifiedSales,
      verifiedCollections: cents(verifiedPayments.map((p: { amount: string }) => p.amount)),
      activeMemberships: (memberships ?? []).filter(
        (m: { status: string }) => m.status === 'active',
      ).length,
      pendingAccounts: (sales ?? []).filter((s: { status: string }) => s.status === 'pending')
        .length,
      downPaymentAccounts: (sales ?? []).filter(
        (s: { status: string }) => s.status === 'down_payment',
      ).length,
      overdueAccounts: (sales ?? []).filter((s: { status: string }) => s.status === 'overdue')
        .length,
      pointsIssued: (memberships ?? []).reduce(
        (sum: number, m: { points_balance: number }) => sum + Number(m.points_balance ?? 0),
        0,
      ),
      pointsRedeemed: 0,
      pendingQualifications: (qualifications ?? []).filter(
        (q: { status: string }) => q.status === 'pending',
      ).length,
      earnedUnpaidCommissions: cents(
        (commissions ?? [])
          .filter((c: { status: string }) => c.status === 'earned')
          .map((c: { amount: string }) => c.amount),
      ),
      activeSellers: (ost ?? []).filter((o: { status: string }) => o.status === 'active').length,
      inactiveSellers: (ost ?? []).filter((o: { status: string }) => o.status !== 'active').length,
      activeEmployees: (staff ?? []).filter((s: { status: string }) => s.status === 'active')
        .length,
      inactiveEmployees: (staff ?? []).filter((s: { status: string }) => s.status !== 'active')
        .length,
    },
    queues: {
      paymentVerification: (payments ?? []).filter(
        (p: { status: string }) => p.status === 'recorded',
      ).length,
      cardActivation: (sales ?? []).filter((s: { status: string }) => s.status === 'qualified')
        .length,
      finalQualification: (sales ?? []).filter(
        (s: { status: string }) => s.status === 'final_qualification_pending',
      ).length,
      ostRegistrations: (ostApplications ?? []).filter((application: { status: string }) =>
        ['submitted', 'under_review'].includes(application.status),
      ).length,
      commissionPayouts: (commissions ?? []).filter(
        (c: { status: string }) => c.status === 'earned',
      ).length,
    },
    trend: trendPoints,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);
  const path = String(req.query.afPath ?? '');
  const method = req.method ?? 'GET';
  try {
    if (path === 'account-activation' && method === 'GET') {
      const candidate = await resolveStaffAccountSetup(req);
      if ('error' in candidate)
        return res.status(candidate.error.status).json({ error: candidate.error.error });
      return res.status(200).json({
        id: candidate.userId,
        email: candidate.email,
        fullName: candidate.fullName,
      });
    }
    if (path === 'session' && method === 'GET') {
      const principal = await resolveAfHomesPrincipal(req);
      if ('error' in principal)
        return res.status(principal.error.status).json({ error: principal.error.error });
      return res.status(200).json({
        id: principal.userId,
        email: principal.email,
        fullName: principal.fullName,
        status: principal.status,
        roleId: principal.roleId,
        roleSlug: principal.roleSlug,
        roleName: principal.roleName,
        mustChangePassword: principal.mustChangePassword,
        permissions: principal.permissions,
        testPurgeEnabled: isTestPurgeEnabled(),
        mfaRequired: principal.mfaRequired ?? false,
      });
    }
    // My Account display-name update (AF Homes pattern: PATCH /admin/session).
    // Self-service: resolves the principal directly so it stays reachable
    // while `mustChangePassword` gates every module-guarded endpoint.
    if (path === 'session' && method === 'PATCH') {
      const principal = await resolveAfHomesPrincipal(req);
      if ('error' in principal)
        return res.status(principal.error.status).json({ error: principal.error.error });
      const parsed = updateAfHomesStaffProfileSchema.safeParse(req.body);
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Enter a display name', 400);
      const now = new Date().toISOString();
      const { error: profileError } = await db
        .from('staff_users')
        .update({ full_name: parsed.data.name, updated_at: now })
        .eq('id', principal.userId);
      if (profileError) throw profileError;
      // Best-effort Auth metadata sync: the staff row is authoritative, so a
      // GoTrue failure must not fail the rename.
      await db.auth.admin.updateUserById(principal.userId, {
        user_metadata: { full_name: parsed.data.name },
      });
      await audit(
        db,
        principal.userId,
        'STAFF_PROFILE_UPDATED',
        'staff_user',
        principal.userId,
        null,
        {
          fullName: parsed.data.name,
        },
      );
      return res.status(200).json({
        id: principal.userId,
        email: principal.email,
        fullName: parsed.data.name,
        status: principal.status,
        roleId: principal.roleId,
        roleSlug: principal.roleSlug,
        roleName: principal.roleName,
        mustChangePassword: principal.mustChangePassword,
        permissions: principal.permissions,
      });
    }
    // My Account / forced first-login password change (AF Homes pattern:
    // POST /admin/session/password). Verifies the current password with a
    // fresh `signInWithPassword` (Supabase does not require it by default),
    // rotates via the Admin API, then clears the temporary-password flag.
    // Reachable while gated: it resolves the principal directly.
    if (path === 'session/password' && method === 'POST') {
      const principal = await resolveAfHomesPrincipal(req);
      if ('error' in principal)
        return res.status(principal.error.status).json({ error: principal.error.error });
      const parsed = changeAfHomesStaffPasswordSchema.safeParse(req.body);
      if (!parsed.success)
        return fail(res, 'VALIDATION_ERROR', 'Enter the current and a new password', 400);
      const { data: staff, error: staffError } = await db
        .from('staff_users')
        .select('id,email')
        .eq('id', principal.userId)
        .maybeSingle();
      if (staffError || !staff) return fail(res, 'NOT_FOUND', 'Staff profile not found', 404);
      const anon = anonClient();
      if (!anon) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);
      const { error: reauthError } = await anon.auth.signInWithPassword({
        email: staff.email,
        password: parsed.data.currentPassword,
      });
      if (reauthError) return fail(res, 'UNAUTHORIZED', 'Current password is incorrect', 401);
      const { error: updateError } = await db.auth.admin.updateUserById(principal.userId, {
        password: parsed.data.newPassword,
      });
      if (updateError) return fail(res, 'INTERNAL', 'Unable to update the password', 500);
      const now = new Date().toISOString();
      const { error: flagError } = await db
        .from('staff_users')
        .update({ must_change_password: false, password_changed_at: now, updated_at: now })
        .eq('id', principal.userId);
      if (flagError) throw flagError;
      await audit(
        db,
        principal.userId,
        'STAFF_PASSWORD_CHANGED',
        'staff_user',
        principal.userId,
        null,
        {
          email: staff.email,
        },
      );
      return res.status(200).json({ changed: true });
    }
    if (path === 'roles' && method === 'GET') {
      const auth = await authorizeAfHomes(req, 'organization.roles');
      if ('error' in auth) return res.status(auth.error.status).json({ error: auth.error.error });
      return list(res, await roleCatalog(db));
    }
    if (path === 'roles' && method === 'POST') {
      const auth = await authorizeAfHomes(req, 'organization.roles', 'create');
      if ('error' in auth) return res.status(auth.error.status).json({ error: auth.error.error });
      const parsed = createAfHomesRoleSchema.safeParse(req.body);
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid role input', 400);
      if (!permissionsAreSubset(parsed.data.permissions, auth.permissions))
        return fail(res, 'FORBIDDEN', 'Cannot grant permissions you do not possess', 403);
      const slug = parsed.data.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
      const { data: role, error } = await db
        .from('roles')
        .insert({
          slug,
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          is_system: false,
          is_active: parsed.data.isActive,
        })
        .select('*')
        .single();
      if (error) return fail(res, 'CONFLICT', 'Role name or slug already exists', 409);
      try {
        await replaceRolePermissions(db, role.id, parsed.data.permissions);
        await audit(db, auth.userId, 'ROLE_CREATED', 'role', role.id, null, parsed.data);
      } catch (error) {
        await db.from('roles').delete().eq('id', role.id);
        throw error;
      }
      return res
        .status(201)
        .json((await roleCatalog(db)).find((r: { id: string }) => r.id === role.id));
    }
    const roleMatch = path.match(/^roles\/([0-9a-f-]+)$/);
    if (roleMatch && method === 'GET') {
      const auth = await authorizeAfHomes(req, 'organization.roles');
      if ('error' in auth) return res.status(auth.error.status).json({ error: auth.error.error });
      const role = (await roleCatalog(db)).find((r: { id: string }) => r.id === roleMatch[1]);
      if (!role) return fail(res, 'NOT_FOUND', 'Role not found', 404);
      return res.status(200).json(role);
    }
    if (roleMatch && method === 'PATCH') {
      const auth = await authorizeAfHomes(req, 'organization.roles', 'update');
      if ('error' in auth) return res.status(auth.error.status).json({ error: auth.error.error });
      const id = roleMatch[1]!;
      const { data: before } = await db.from('roles').select('*').eq('id', id).maybeSingle();
      if (!before) return fail(res, 'NOT_FOUND', 'Role not found', 404);
      if (before.is_system) {
        const title = z
          .object({ name: z.string().trim().min(1).max(100) })
          .strict()
          .safeParse(req.body);
        if (
          auth.roleSlug !== 'super_admin' ||
          ['admin', 'super_admin', 'customer'].includes(String(before.slug)) ||
          !title.success
        )
          return fail(
            res,
            'FORBIDDEN',
            'System access and protected role titles cannot be changed',
            403,
          );
        const { error } = await db
          .from('roles')
          .update({ name: title.data.name, updated_at: new Date().toISOString() })
          .eq('id', id);
        if (error) throw error;
        await audit(
          db,
          auth.userId,
          'ROLE_DISPLAY_TITLE_UPDATED',
          'role',
          id,
          { name: before.name },
          { name: title.data.name },
        );
        return res
          .status(200)
          .json((await roleCatalog(db)).find((r: { id: string }) => r.id === id));
      }
      if (id === auth.roleId)
        return fail(res, 'FORBIDDEN', 'You cannot edit your own role permissions', 403);
      const parsed = createAfHomesRoleSchema.partial().safeParse(req.body);
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid role update', 400);
      if (
        parsed.data.permissions &&
        !permissionsAreSubset(parsed.data.permissions, auth.permissions)
      )
        return fail(res, 'FORBIDDEN', 'Cannot grant permissions you do not possess', 403);
      // Authorization is ENFORCED IN SQL, not only here. `update_operational_role`
      // (migration 20261029000001) re-derives the actor from p_actor, re-locks the
      // role, and re-checks the protected-role, self-role and subset rules. This
      // handler is an early, friendly refusal - it is NOT the boundary. The direct
      // table update it replaced had no server-side subset rule at all and could
      // leave a role half-configured if the permission rewrite failed.
      const { error: rpcError } = await db.rpc('update_operational_role', {
        p_actor: auth.userId,
        p_role: id,
        p_input: parsed.data,
      });
      if (rpcError) {
        const message = String((rpcError as { message?: string }).message ?? '');
        if (/FORBIDDEN/.test(message))
          return fail(res, 'FORBIDDEN', 'This role cannot be edited', 403);
        if (/VALIDATION_ERROR/.test(message))
          return fail(res, 'VALIDATION_ERROR', 'Invalid role update', 400);
        if (/NOT_FOUND/.test(message)) return fail(res, 'NOT_FOUND', 'Role not found', 404);
        throw rpcError;
      }
      await audit(db, auth.userId, 'ROLE_UPDATED', 'role', id, before, parsed.data);
      return res.status(200).json((await roleCatalog(db)).find((r: { id: string }) => r.id === id));
    }
    const roleAudit = path.match(/^roles\/([0-9a-f-]+)\/audit$/);
    if (roleAudit && method === 'GET') {
      const auth = await authorizeAfHomes(req, 'governance.audit');
      if ('error' in auth) return res.status(auth.error.status).json({ error: auth.error.error });
      const { data, error } = await db
        .from('audit_events')
        .select('*')
        .eq('entity_type', 'role')
        .eq('entity_id', roleAudit[1])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return list(res, data ?? []);
    }
    if (path === 'departments' && method === 'GET') {
      const auth = await authorizeAfHomes(req, 'organization.departments');
      if ('error' in auth) return res.status(auth.error.status).json({ error: auth.error.error });
      const [{ data, error }, { data: staff }] = await Promise.all([
        db.from('departments').select('*').order('name'),
        db.from('staff_users').select('department_id'),
      ]);
      if (error) throw error;
      return list(
        res,
        (data ?? []).map((d: Record<string, unknown>) => ({
          id: d.id,
          code: d.code,
          name: d.name,
          isActive: d.is_active,
          staffCount: (staff ?? []).filter(
            (s: { department_id: string }) => s.department_id === d.id,
          ).length,
          createdAt: d.created_at,
          updatedAt: d.updated_at,
        })),
      );
    }
    if (path === 'departments' && method === 'POST') {
      const auth = await authorizeAfHomes(req, 'organization.departments', 'create');
      if ('error' in auth) return res.status(auth.error.status).json({ error: auth.error.error });
      const parsed = z
        .object({
          code: z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/),
          name: z.string().trim().min(2).max(80),
        })
        .safeParse(req.body);
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid department input', 400);
      const { data, error } = await db
        .from('departments')
        .insert({ ...parsed.data, is_active: true })
        .select('*')
        .single();
      if (error) return fail(res, 'CONFLICT', 'Department code or name already exists', 409);
      await audit(db, auth.userId, 'DEPARTMENT_CREATED', 'department', data.id, null, parsed.data);
      return res.status(201).json({
        id: data.id,
        code: data.code,
        name: data.name,
        isActive: data.is_active,
        staffCount: 0,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      });
    }
    if (path === 'staff' && method === 'GET') {
      const auth = await authorizeAfHomes(req, 'organization.staff');
      if ('error' in auth) return res.status(auth.error.status).json({ error: auth.error.error });
      return list(res, await staffCatalog(db));
    }
    if (path === 'staff' && method === 'POST') {
      const auth = await authorizeAfHomes(req, 'organization.staff', 'create');
      if ('error' in auth) return res.status(auth.error.status).json({ error: auth.error.error });
      const parsed = createAfHomesStaffSchema.safeParse(req.body);
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid staff details', 400);
      const target = (await roleCatalog(db)).find(
        (r: { id: string }) => r.id === parsed.data.roleId,
      );
      if (!target?.isActive) return fail(res, 'VALIDATION_ERROR', 'Role is not active', 400);
      if (target.slug === 'customer')
        return fail(
          res,
          'VALIDATION_ERROR',
          'Customer accounts cannot be assigned staff roles',
          400,
        );
      if (target.slug === 'super_admin' && auth.roleSlug !== 'super_admin')
        return fail(res, 'FORBIDDEN', 'Only Super Admin can assign Super Admin', 403);
      if (!permissionsAreSubset(target.permissions, auth.permissions))
        return fail(
          res,
          'FORBIDDEN',
          'Cannot assign a role with permissions you do not possess',
          403,
        );
      // AF Homes pattern: the Auth identity is created server-side with an
      // administrator-set temporary password (`auth.admin.createUser`), never
      // through the invitation callback. The account starts `active` but
      // gated on `must_change_password` until the forced first-login change.
      // No `staff_invitations` row is written for this path: the invitation
      // tables remain only for pre-existing invited accounts that have not
      // yet completed the legacy activation.
      const email = parsed.data.email.toLowerCase();
      const { data: duplicate } = await db
        .from('staff_users')
        .select('id')
        .eq('email', email)
        .limit(1);
      if ((duplicate ?? []).length > 0)
        return fail(res, 'CONFLICT', 'A staff member with this email already exists', 409);
      const { data: created, error: createError } = await db.auth.admin.createUser({
        email,
        password: parsed.data.temporaryPassword,
        email_confirm: true,
        user_metadata: { full_name: parsed.data.fullName },
      });
      if (createError || !created?.user)
        return fail(res, 'CONFLICT', 'Unable to create an account for this email address', 409);
      try {
        // Every write is checked: a silent insert failure would leave an
        // orphaned auth user plus a role assignment pointing at a staff row
        // that does not exist.
        const now = new Date().toISOString();
        const { error: staffError } = await db.from('staff_users').insert({
          id: created.user.id,
          email,
          full_name: parsed.data.fullName,
          department_id: parsed.data.departmentId,
          status: 'active',
          must_change_password: true,
          activated_at: now,
        });
        if (staffError) throw new Error(`staff_users insert failed: ${staffError.message}`);
        const { error: assignmentError } = await db.from('staff_role_assignments').insert({
          staff_id: created.user.id,
          role_id: parsed.data.roleId,
          assigned_by: auth.userId,
        });
        if (assignmentError)
          throw new Error(`staff_role_assignments insert failed: ${assignmentError.message}`);
        // The temporary password is NEVER persisted or logged: the audit
        // payload carries identity only, and Supabase Auth holds the secret.
        await audit(db, auth.userId, 'STAFF_CREATED', 'staff_user', created.user.id, null, {
          email,
          fullName: parsed.data.fullName,
          departmentId: parsed.data.departmentId,
          roleId: parsed.data.roleId,
        });
      } catch (error) {
        await db.auth.admin.deleteUser(created.user.id);
        throw error;
      }
      return res
        .status(201)
        .json((await staffCatalog(db)).find((s: { id: string }) => s.id === created.user.id));
    }
    const staffMatch = path.match(/^staff\/([0-9a-f-]+)$/);
    if (staffMatch && method === 'GET') {
      const auth = await authorizeAfHomes(req, 'organization.staff');
      if ('error' in auth) return res.status(auth.error.status).json({ error: auth.error.error });
      const entry = (await staffCatalog(db)).find(
        (staff: { id: string }) => staff.id === staffMatch[1],
      );
      if (!entry) return fail(res, 'NOT_FOUND', 'Staff member not found', 404);
      return res.status(200).json(entry);
    }
    const staffAudit = path.match(/^staff\/([0-9a-f-]+)\/audit$/);
    if (staffAudit && method === 'GET') {
      const auth = await authorizeAfHomes(req, 'organization.staff');
      if ('error' in auth) return res.status(auth.error.status).json({ error: auth.error.error });
      const { data, error } = await db
        .from('audit_events')
        .select('*')
        .eq('entity_type', 'staff_user')
        .eq('entity_id', staffAudit[1])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return list(res, data ?? []);
    }
    if (staffMatch && method === 'PATCH') {
      const auth = await authorizeAfHomes(req, 'organization.staff', 'update');
      if ('error' in auth) return res.status(auth.error.status).json({ error: auth.error.error });
      const id = staffMatch[1]!;
      if (id === auth.userId)
        return fail(res, 'FORBIDDEN', 'You cannot edit your own account', 403);
      const parsed = z
        .object({
          departmentId: z.string().uuid().nullable().optional(),
          roleId: z.string().uuid().optional(),
          status: z.enum(['active', 'inactive', 'suspended']).optional(),
          restrictions: z
            .array(
              z.object({
                moduleKey: afHomesModuleKeySchema,
                denyView: z.boolean(),
                denyCreate: z.boolean(),
                denyUpdate: z.boolean(),
                denyDelete: z.boolean(),
              }),
            )
            .optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid staff update', 400);
      const before = (await staffCatalog(db)).find((staff: { id: string }) => staff.id === id);
      if (!before) return fail(res, 'NOT_FOUND', 'Staff member not found', 404);
      // A non-Super-Admin may not touch a Super Admin account at all: not its
      // role, not its standing (suspend = owner lockout), and not its
      // restrictions (deny-only, but stripping every module is still a lockout).
      const targetRole = (await roleCatalog(db)).find(
        (role: { id: string }) => role.id === before.roleId,
      );
      if (targetRole?.slug === 'super_admin' && auth.roleSlug !== 'super_admin')
        return fail(res, 'FORBIDDEN', 'Only Super Admin can modify a Super Admin', 403);
      if (parsed.data.roleId) {
        const target = (await roleCatalog(db)).find(
          (role: { id: string }) => role.id === parsed.data.roleId,
        );
        if (!target?.isActive) return fail(res, 'VALIDATION_ERROR', 'Role is not active', 400);
        if (target.slug === 'customer')
          return fail(
            res,
            'VALIDATION_ERROR',
            'Customer accounts cannot be assigned staff roles',
            400,
          );
        if (target.slug === 'super_admin' && auth.roleSlug !== 'super_admin')
          return fail(res, 'FORBIDDEN', 'Only Super Admin can assign Super Admin', 403);
        if (!permissionsAreSubset(target.permissions, auth.permissions))
          return fail(res, 'FORBIDDEN', 'Cannot assign permissions you do not possess', 403);
        await db
          .from('staff_role_assignments')
          .update({ role_id: parsed.data.roleId, assigned_by: auth.userId })
          .eq('staff_id', id);
      }
      const profilePatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (parsed.data.departmentId !== undefined)
        profilePatch.department_id = parsed.data.departmentId;
      if (parsed.data.status !== undefined) profilePatch.status = parsed.data.status;
      await db.from('staff_users').update(profilePatch).eq('id', id);
      if (parsed.data.restrictions) {
        const { data: modules } = await db.from('modules').select('id,key');
        const idByKey = new Map(
          (modules ?? []).map((module: { id: string; key: string }) => [module.key, module.id]),
        );
        await db.from('staff_permission_restrictions').delete().eq('staff_id', id);
        const denied = parsed.data.restrictions.filter(
          (restriction) =>
            restriction.denyView ||
            restriction.denyCreate ||
            restriction.denyUpdate ||
            restriction.denyDelete,
        );
        if (denied.length) {
          const { error } = await db.from('staff_permission_restrictions').insert(
            denied.map((restriction) => ({
              staff_id: id,
              module_id: idByKey.get(restriction.moduleKey),
              deny_view: restriction.denyView,
              deny_create: restriction.denyCreate,
              deny_update: restriction.denyUpdate,
              deny_delete: restriction.denyDelete,
            })),
          );
          if (error) throw error;
        }
      }
      await audit(db, auth.userId, 'STAFF_ACCESS_UPDATED', 'staff_user', id, before, parsed.data);
      return res
        .status(200)
        .json((await staffCatalog(db)).find((staff: { id: string }) => staff.id === id));
    }
    const staffDeactivate = path.match(/^staff\/([0-9a-f-]+)\/deactivate$/);
    if (staffDeactivate && method === 'POST') {
      const auth = await authorizeAfHomes(req, 'organization.staff', 'update');
      if ('error' in auth) return res.status(auth.error.status).json({ error: auth.error.error });
      const id = staffDeactivate[1]!;
      if (id === auth.userId)
        return fail(res, 'FORBIDDEN', 'You cannot deactivate your own account', 403);
      const before = (await staffCatalog(db)).find((staff: { id: string }) => staff.id === id);
      if (!before) return fail(res, 'NOT_FOUND', 'Staff member not found', 404);
      const targetRole = await staffRole(db, id);
      if (targetRole?.slug === 'super_admin') {
        if (auth.roleSlug !== 'super_admin')
          return fail(res, 'FORBIDDEN', 'Only Super Admin can deactivate a Super Admin', 403);
        const superRole = (await roleCatalog(db)).find(
          (role: { slug: string }) => role.slug === 'super_admin',
        );
        const activeSuperAdmins = (await staffCatalog(db)).filter(
          (staff: { roleId: string; status: string }) =>
            staff.roleId === superRole?.id && staff.status === 'active',
        ).length;
        if (activeSuperAdmins <= 1)
          return fail(res, 'CONFLICT', 'The last active Super Admin cannot be deactivated', 409);
      }
      const { error } = await db
        .from('staff_users')
        .update({ status: 'inactive', updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      await audit(db, auth.userId, 'STAFF_DEACTIVATED', 'staff_user', id, before, {
        status: 'inactive',
      });
      return res.status(200).json({ deactivated: true });
    }
    if (staffMatch && method === 'DELETE') {
      const auth = await authorizeAfHomes(req, 'organization.staff', 'delete');
      if ('error' in auth) return res.status(auth.error.status).json({ error: auth.error.error });
      if (auth.roleSlug !== 'super_admin')
        return fail(res, 'FORBIDDEN', 'Only Super Admin can permanently delete staff', 403);
      const id = staffMatch[1]!;
      if (id === auth.userId)
        return fail(res, 'FORBIDDEN', 'You cannot permanently delete your own account', 403);
      const before = (await staffCatalog(db)).find((staff: { id: string }) => staff.id === id);
      if (!before) return fail(res, 'NOT_FOUND', 'Staff member not found', 404);
      if ((await staffRole(db, id))?.slug === 'super_admin')
        return fail(res, 'FORBIDDEN', 'Super Admin accounts cannot be permanently deleted', 403);
      const blockers = await staffDeleteBlockers(db, id);
      if (blockers.length)
        return res.status(409).json({
          error: {
            code: 'PROTECTED_HISTORY',
            message:
              'This staff account has historical business records and cannot be permanently deleted. Deactivate the account instead.',
            details: { canDelete: false, blockers },
          },
        });
      await db.from('staff_invitations').delete().eq('auth_user_id', id);
      await db.from('staff_permission_restrictions').delete().eq('staff_id', id);
      await db.from('staff_role_assignments').delete().eq('staff_id', id);
      const { error: profileError } = await db.from('staff_users').delete().eq('id', id);
      if (profileError) throw profileError;
      // Crash window, documented deliberately: the public rows above are
      // already gone when the Auth user is deleted. There is no safe
      // cross-system transaction between Postgres and GoTrue, so this order
      // is kept (orphaned public rows would resurrect a deleted login; an
      // orphaned Auth user without a profile cannot authenticate to anything)
      // and the ordering is pinned by regression test, not redesigned here.
      const { error: authError } = await db.auth.admin.deleteUser(id);
      if (authError) throw authError;
      await audit(db, auth.userId, 'STAFF_DELETED', 'staff_user', id, before, {
        deleted: true,
      });
      return res.status(200).json({ deleted: true });
    }
    const purgeMatch = path.match(/^staff\/([0-9a-f-]+)\/purge-test-data$/);
    if (purgeMatch && method === 'POST') {
      // Fail closed when the environment does not explicitly allow test
      // purges: the surface does not exist in production.
      if (!isTestPurgeEnabled()) return fail(res, 'NOT_FOUND', 'Not found', 404);
      const auth = await authorizeAfHomes(req, 'organization.staff', 'delete');
      if ('error' in auth) return res.status(auth.error.status).json({ error: auth.error.error });
      if (auth.roleSlug !== 'super_admin')
        return fail(res, 'FORBIDDEN', 'Only Super Admin can purge test accounts', 403);
      const id = purgeMatch[1]!;
      if (id === auth.userId)
        return fail(res, 'FORBIDDEN', 'You cannot purge your own account', 403);
      const target = (await staffCatalog(db)).find((staff: { id: string }) => staff.id === id);
      if (!target) return fail(res, 'NOT_FOUND', 'Staff member not found', 404);
      if ((await staffRole(db, id))?.slug === 'super_admin')
        return fail(res, 'FORBIDDEN', 'Super Admin accounts cannot be purged', 403);
      if (!isTestAccountEmail((target as { email: string }).email))
        return fail(res, 'CONFLICT', 'Only test accounts can be purged.', 409);
      // Abort before any destruction when the audit itself cannot be written.
      await audit(db, auth.userId, 'TEST_ACCOUNT_PURGE_STARTED', 'staff_user', id, target, null);
      const { blockers, plan } = await planTestPurge(db, id);
      if (blockers.length > 0) {
        return fail(
          res,
          'CONFLICT',
          `Test account cannot be purged: ${blockers[0]!.blocked}.`,
          409,
        );
      }
      // Nullable attributions on preserved rows. Every row itself survives;
      // only the deleted test account's authorship is cleared.
      for (const [table, column] of [
        ['payments', 'verified_by'],
        ['commissions', 'qualified_by'],
        ['commissions', 'paid_by'],
        ['final_qualifications', 'reviewed_by'],
        ['identity_documents', 'reviewed_by'],
        ['redemptions', 'voided_by'],
        ['ost_applications', 'reviewed_by'],
      ] as const) {
        const { error } = await db
          .from(table)
          .update({ [column]: null })
          .eq(column, id);
        if (error) throw error;
      }
      const remove = async (table: string, column: string, value: string) => {
        const { error } = await db.from(table).delete().eq(column, value);
        if (error) throw error;
      };
      // Test-only history and owned objects, children before parents. The
      // plan already verified each of these is safe to remove.
      await remove('cms_document_versions', 'created_by', id);
      await remove('cms_page_versions', 'created_by', id);
      const { data: ownedCodes, error: ownedCodesError } = await db
        .from('referral_codes')
        .select('id')
        .or(`sponsor_staff_id.eq.${id},created_by.eq.${id}`);
      if (ownedCodesError) throw ownedCodesError;
      for (const code of (ownedCodes ?? []) as { id: string }[]) {
        if (await hasReference(db, 'ost_applications', 'referral_code_id', String(code.id))) {
          throw new Error(
            `Test account cannot be purged: a referral code gained an application mid-purge.`,
          );
        }
        await remove('referral_codes', 'id', String(code.id));
      }
      await remove('referral_relationships', 'subject_staff_id', id);
      await remove('audit_events', 'actor_id', id);
      await remove('staff_invitations', 'auth_user_id', id);
      const { data: sentInvites, error: sentInvitesError } = await db
        .from('staff_invitations')
        .select('id,email')
        .eq('invited_by', id);
      if (sentInvitesError) throw sentInvitesError;
      for (const invite of (sentInvites ?? []) as { id: string; email: string }[]) {
        if (!isTestAccountEmail(invite.email)) {
          throw new Error(
            `Test account cannot be purged: invitation to non-test address ${invite.email} appeared mid-purge.`,
          );
        }
        await remove('staff_invitations', 'id', String(invite.id));
      }
      for (const customerId of plan.disposableCustomers) {
        if (await customerHasActivity(db, customerId)) {
          throw new Error(
            'Test account cannot be purged: a disposable customer gained activity mid-purge.',
          );
        }
        await remove('customers', 'id', customerId);
      }
      await remove('staff_permission_restrictions', 'staff_id', id);
      await remove('staff_role_assignments', 'staff_id', id);
      const { error: profileError } = await db.from('staff_users').delete().eq('id', id);
      if (profileError) throw profileError;
      // Dual identity: an Auth user that also signs into the customer portal
      // is preserved along with the customer login; staff-only users are
      // removed. Auth deletion is outside any DB transaction - a failure here
      // is a controlled 500 after the public purge, logged meaningfully.
      const dual = await hasReference(db, 'customers', 'auth_user_id', id);
      let authUserDeleted = false;
      if (!dual) {
        const { error: authError } = await db.auth.admin.deleteUser(id);
        if (authError) throw authError;
        authUserDeleted = true;
      }
      // Post-commit record. Best-effort like the staff onboarding-token
      // endpoint: a failed write must not turn a completed purge into a 500.
      try {
        await audit(db, auth.userId, 'TEST_ACCOUNT_PURGED', 'staff_user', id, target, {
          authUserDeleted,
        });
      } catch {
        console.error('[afhomes-api]', 'test purge final audit write failed');
      }
      return res.status(200).json({
        purged: true,
        counts: {
          staff: 1,
          restrictions: plan.restrictions,
          assignments: plan.assignments,
          invitations: plan.invitations,
          sales: plan.sales,
          customers: plan.customers,
          payments: plan.payments,
          memberships: plan.memberships,
          history: plan.history,
        },
        authUserDeleted,
      });
    }
    if (path === 'dashboard' && method === 'GET') {
      const auth = await authorizeAfHomes(req, 'dashboard.view');
      if ('error' in auth) return res.status(auth.error.status).json({ error: auth.error.error });
      return res.status(200).json(await dashboard(db, String(req.query.range ?? 'month')));
    }
    return fail(res, 'NOT_FOUND', 'AF Homes endpoint not found', 404);
  } catch (error) {
    console.error('[afhomes-api]', describeServerError(error));
    return fail(res, 'INTERNAL', 'Internal server error', 500);
  }
}

/**
 * Server-only diagnostics. Supabase/PostgREST failures are usually plain
 * objects ({ message, code, details, hint }), not Errors, so logging
 * `error.message` alone printed "Unknown server error" for every real
 * database failure. Only database-shape fields are extracted - never
 * headers, keys, tokens, bodies or anything request-shaped - and the client
 * still receives the generic envelope below.
 */
export function describeServerError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    const parts = ['message', 'code', 'details', 'hint']
      .map((key) =>
        typeof record[key] === 'string' && record[key] !== ''
          ? `${key}=${record[key] as string}`
          : null,
      )
      .filter((part): part is string => part !== null);
    if (parts.length > 0) return parts.join(' ');
  }
  return 'Unknown server error';
}
