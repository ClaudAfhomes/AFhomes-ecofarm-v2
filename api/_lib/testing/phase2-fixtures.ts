/**
 * AF Homes Phase 2 fixtures: card products, customers, sales, payments,
 * memberships, commissions, and the relationship network they hang from.
 *
 * Extends the Phase 1 organization fixtures rather than replacing them, so a
 * Phase 2 test can reason about permissions and downlines with the same data.
 */
import { baseTables, baseTokens, TOKEN, UUID, moduleId } from './fixtures.js';
import type { FakeRow, FakeTables } from './supabase-fake.js';

export { TOKEN, UUID, moduleId, baseTokens };

/** id -> card plan. Values are the approved Bronze/Silver/Gold economics. */
export const PRODUCT = {
  bronze: '11111111-1111-4111-8111-111111111111',
  silver: '22222222-2222-4222-8222-222222222222',
  gold: '33333333-3333-4333-8333-333333333333',
  retired: '44444444-4444-4444-8444-444444444444',
} as const;

export const CUSTOMER = {
  prospect: 'aaaaaaaa-0000-4000-8000-000000000001',
  prospectTwo: 'aaaaaaaa-0000-4000-8000-000000000002',
  active: 'aaaaaaaa-0000-4000-8000-000000000003',
  cancelled: 'aaaaaaaa-0000-4000-8000-000000000004',
} as const;

export const SALE = {
  submitted: 'bbbbbbbb-0000-4000-8000-000000000001',
  downPaid: 'bbbbbbbb-0000-4000-8000-000000000002',
  fullyPaid: 'bbbbbbbb-0000-4000-8000-000000000003',
  active: 'bbbbbbbb-0000-4000-8000-000000000004',
  unpaid: 'bbbbbbbb-0000-4000-8000-000000000005',
} as const;

export const PAYMENT = {
  first: 'cccccccc-0000-4000-8000-000000000001',
  second: 'cccccccc-0000-4000-8000-000000000002',
  rejected: 'cccccccc-0000-4000-8000-000000000003',
} as const;

export const MEMBERSHIP = {
  active: 'dddddddd-0000-4000-8000-000000000001',
} as const;

export const REFERRAL = {
  vdToSsm: 'eeeeeeee-0000-4000-8000-000000000001',
  ssmToSm: 'eeeeeeee-0000-4000-8000-000000000002',
  smToOst: 'eeeeeeee-0000-4000-8000-000000000003',
} as const;

const iso = (daysAgo: number, hour = 9) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

export const cardCategoriesTable = (): FakeRow[] => [
  {
    id: '99999999-9999-4999-8999-999999999999',
    slug: 'membership',
    name: 'Membership Cards',
    description: null,
    is_active: true,
    sort_order: 10,
  },
];

export const cardPlansTable = (): FakeRow[] => [
  {
    id: PRODUCT.bronze,
    category_id: '99999999-9999-4999-8999-999999999999',
    code: 'BRONZE',
    name: 'Bronze',
    cash_price: '30000.00',
    minimum_down_payment: '10000.00',
    yearly_points: 25000,
    commission_rate: '0.04',
    description: null,
    is_active: true,
    sort_order: 30,
    created_at: iso(90),
    updated_at: iso(90),
  },
  {
    id: PRODUCT.silver,
    category_id: '99999999-9999-4999-8999-999999999999',
    code: 'SILVER',
    name: 'Silver',
    cash_price: '40000.00',
    minimum_down_payment: '15000.00',
    yearly_points: 40000,
    commission_rate: '0.04',
    description: null,
    is_active: true,
    sort_order: 20,
    created_at: iso(90),
    updated_at: iso(90),
  },
  {
    id: PRODUCT.gold,
    category_id: '99999999-9999-4999-8999-999999999999',
    code: 'GOLD',
    name: 'Gold',
    cash_price: '60000.00',
    minimum_down_payment: '20000.00',
    yearly_points: 60000,
    commission_rate: '0.04',
    description: null,
    is_active: true,
    sort_order: 10,
    created_at: iso(90),
    updated_at: iso(90),
  },
  {
    id: PRODUCT.retired,
    category_id: '99999999-9999-4999-8999-999999999999',
    code: 'LEGACY',
    name: 'Legacy Card',
    cash_price: '15000.00',
    minimum_down_payment: '5000.00',
    yearly_points: 10000,
    commission_rate: '0.04',
    description: null,
    is_active: false,
    sort_order: 40,
    created_at: iso(200),
    updated_at: iso(200),
  },
];

export const customersTable = (): FakeRow[] => [
  {
    id: CUSTOMER.prospect,
    customer_number: 'CUS-000001',
    first_name: 'Juan',
    middle_name: 'A',
    last_name: 'Dela Cruz',
    suffix: null,
    birth_date: '1990-05-04',
    gender: 'male',
    email: 'juan@example.com',
    phone: '09185550101',
    address: { line1: '123 Main St', city: 'Manila', province: 'Metro Manila', countryCode: 'PH' },
    government_id_type: 'philippine_id',
    government_id_number: '0011-2233-4455',
    registration_source: 'seller_created',
    status: 'prospect',
    created_by: UUID.adminStaff,
    referred_by_staff_id: null,
    referral_code_used: null,
    notes: null,
    auth_user_id: null,
    created_at: iso(30),
    updated_at: iso(30),
  },
  {
    id: CUSTOMER.prospectTwo,
    customer_number: 'CUS-000002',
    first_name: 'Maria',
    middle_name: null,
    last_name: 'Santos',
    suffix: null,
    birth_date: '1992-08-19',
    gender: 'female',
    email: 'maria@example.com',
    phone: '09185550102',
    address: { line1: '9 Katipunan', city: 'Quezon City', province: 'Metro Manila', countryCode: 'PH' },
    government_id_type: null,
    government_id_number: null,
    registration_source: 'seller_created',
    status: 'prospect',
    created_by: UUID.adminStaff,
    referred_by_staff_id: null,
    referral_code_used: null,
    notes: null,
    auth_user_id: null,
    created_at: iso(20),
    updated_at: iso(20),
  },
  {
    id: CUSTOMER.active,
    customer_number: 'CUS-000003',
    first_name: 'Pedro',
    middle_name: null,
    last_name: 'Reyes',
    suffix: null,
    birth_date: '1985-01-02',
    gender: 'male',
    email: 'pedro@example.com',
    phone: '09185550103',
    address: { line1: '2 Ortigas', city: 'Pasig', province: 'Rizal', countryCode: 'PH' },
    government_id_type: null,
    government_id_number: null,
    registration_source: 'seller_created',
    status: 'active',
    created_by: UUID.adminStaff,
    referred_by_staff_id: null,
    referral_code_used: null,
    notes: null,
    auth_user_id: null,
    created_at: iso(90),
    updated_at: iso(10),
  },
  {
    id: CUSTOMER.cancelled,
    customer_number: 'CUS-000004',
    first_name: 'Ana',
    middle_name: null,
    last_name: 'Cruz',
    suffix: null,
    birth_date: '1995-03-03',
    gender: 'female',
    email: 'ana@example.com',
    phone: '09185550104',
    address: { line1: '5 Cebu', city: 'Cebu City', province: 'Cebu', countryCode: 'PH' },
    government_id_type: null,
    government_id_number: null,
    registration_source: 'seller_created',
    status: 'cancelled',
    created_by: UUID.adminStaff,
    referred_by_staff_id: null,
    referral_code_used: null,
    notes: null,
    auth_user_id: null,
    created_at: iso(60),
    updated_at: iso(5),
  },
];

const sale = (over: FakeRow): FakeRow => ({
  id: SALE.submitted,
  sale_number: 'SALE-000001',
  customer_id: CUSTOMER.prospect,
  plan_id: PRODUCT.gold,
  seller_type: 'staff',
  seller_staff_id: UUID.adminStaff,
  seller_ost_id: null,
  cash_price: '60000.00',
  cash_price_snapshot: '60000.00',
  minimum_down_payment_snapshot: '20000.00',
  yearly_points_snapshot: 60000,
  commission_rate_snapshot: '0.04',
  expected_commission_snapshot: '2400.00',
  status: 'submitted',
  submitted_at: iso(10),
  payment_verified_at: null,
  fully_paid_at: null,
  activated_at: null,
  cancelled_at: null,
  cancellation_reason: null,
  spot_cash_started_at: null,
  spot_cash_deadline: null,
  referral_relationship_id: null,
  created_by: UUID.adminStaff,
  balance_due_at: iso(-355),
  created_at: iso(10),
  updated_at: iso(10),
  ...over,
});

export const cardSalesTable = (): FakeRow[] => [
  sale({}),
  sale({
    id: SALE.downPaid,
    sale_number: 'SALE-000002',
    customer_id: CUSTOMER.prospectTwo,
    plan_id: PRODUCT.silver,
    cash_price: '40000.00',
    cash_price_snapshot: '40000.00',
    minimum_down_payment_snapshot: '15000.00',
    yearly_points_snapshot: 40000,
    expected_commission_snapshot: '1600.00',
    status: 'payment_in_progress',
    spot_cash_started_at: iso(2),
    spot_cash_deadline: iso(-5),
    referral_relationship_id: REFERRAL.smToOst,
  }),
  sale({
    id: SALE.fullyPaid,
    sale_number: 'SALE-000003',
    customer_id: CUSTOMER.active,
    plan_id: PRODUCT.bronze,
    cash_price: '30000.00',
    cash_price_snapshot: '30000.00',
    minimum_down_payment_snapshot: '10000.00',
    yearly_points_snapshot: 25000,
    expected_commission_snapshot: '1200.00',
    status: 'payment_verified',
    payment_verified_at: iso(1),
    fully_paid_at: iso(1),
    spot_cash_started_at: iso(3),
    spot_cash_deadline: iso(-4),
  }),
  sale({
    id: SALE.active,
    sale_number: 'SALE-000004',
    customer_id: CUSTOMER.active,
    plan_id: PRODUCT.gold,
    status: 'active',
    activated_at: iso(1),
    payment_verified_at: iso(2),
    fully_paid_at: iso(2),
    spot_cash_started_at: iso(4),
    spot_cash_deadline: iso(-3),
  }),
  sale({
    id: SALE.unpaid,
    sale_number: 'SALE-000005',
    customer_id: CUSTOMER.prospect,
    plan_id: PRODUCT.bronze,
    cash_price: '30000.00',
    cash_price_snapshot: '30000.00',
    minimum_down_payment_snapshot: '10000.00',
    yearly_points_snapshot: 25000,
    expected_commission_snapshot: '1200.00',
    status: 'payment_pending',
  }),
];

export const paymentsTable = (): FakeRow[] => [
  {
    id: PAYMENT.first,
    sale_id: SALE.downPaid,
    customer_id: CUSTOMER.prospectTwo,
    amount: '15000.00',
    payment_type: 'down_payment',
    method: 'bank_transfer',
    reference: 'TRF-0001',
    notes: null,
    receipt_storage_path: null,
    status: 'verified',
    rejection_reason: null,
    recorded_by: UUID.adminStaff,
    verified_by: UUID.adminStaff,
    recorded_at: iso(2),
    verified_at: iso(2),
  },
  {
    id: PAYMENT.second,
    sale_id: SALE.downPaid,
    customer_id: CUSTOMER.prospectTwo,
    amount: '5000.00',
    payment_type: 'installment',
    method: 'cash',
    reference: 'CASH-0001',
    notes: null,
    receipt_storage_path: null,
    status: 'recorded',
    rejection_reason: null,
    recorded_by: UUID.adminStaff,
    verified_by: null,
    recorded_at: iso(1),
    verified_at: null,
  },
  {
    id: PAYMENT.rejected,
    sale_id: SALE.downPaid,
    customer_id: CUSTOMER.prospectTwo,
    amount: '9999.99',
    payment_type: 'installment',
    method: 'bank_transfer',
    reference: 'TRF-BAD',
    notes: null,
    receipt_storage_path: null,
    status: 'rejected',
    rejection_reason: 'Funds not received',
    recorded_by: UUID.adminStaff,
    verified_by: UUID.adminStaff,
    recorded_at: iso(2),
    verified_at: iso(2),
  },
  {
    id: 'cccccccc-0000-4000-8000-000000000004',
    sale_id: SALE.fullyPaid,
    customer_id: CUSTOMER.active,
    amount: '30000.00',
    payment_type: 'full',
    method: 'bank_transfer',
    reference: 'TRF-FULL',
    notes: null,
    receipt_storage_path: null,
    status: 'verified',
    rejection_reason: null,
    recorded_by: UUID.adminStaff,
    verified_by: UUID.adminStaff,
    recorded_at: iso(3),
    verified_at: iso(3),
  },
  {
    id: 'cccccccc-0000-4000-8000-000000000005',
    sale_id: SALE.active,
    customer_id: CUSTOMER.active,
    amount: '60000.00',
    payment_type: 'full',
    method: 'bank_transfer',
    reference: 'TRF-GOLD',
    notes: null,
    receipt_storage_path: null,
    status: 'verified',
    rejection_reason: null,
    recorded_by: UUID.adminStaff,
    verified_by: UUID.adminStaff,
    recorded_at: iso(4),
    verified_at: iso(4),
  },
];

export const membershipsTable = (): FakeRow[] => [
  {
    id: MEMBERSHIP.active,
    customer_id: CUSTOMER.active,
    sale_id: SALE.active,
    membership_number: 'MBS-000001',
    product_id: PRODUCT.gold,
    sale_status_at_activation: 'payment_verified',
    fallback_code_hash: 'hash-of-afh-abcd-1234',
    qr_token_hash: 'hash-of-qr-token',
    status: 'active',
    points_balance: 60000,
    yearly_points_allocated: 60000,
    activated_by: UUID.adminStaff,
    activated_at: iso(1),
    expires_at: iso(-364),
    renewal_due_at: iso(-364),
    issued_at: iso(1),
    created_at: iso(1),
  },
];

export const pointsAccountsTable = (): FakeRow[] => [
  {
    id: 'ffffffff-0000-4000-8000-000000000001',
    membership_id: MEMBERSHIP.active,
    balance: 60000,
    lifetime_allocated: 60000,
    lifetime_redeemed: 0,
    created_at: iso(1),
    updated_at: iso(1),
  },
];

export const pointsLedgerTable = (): FakeRow[] => [
  {
    id: '1',
    account_id: 'ffffffff-0000-4000-8000-000000000001',
    entry_type: 'annual_allocation',
    amount: 60000,
    balance_after: 60000,
    reference_type: 'membership',
    reference_id: MEMBERSHIP.active,
    actor_id: UUID.adminStaff,
    reason: 'Annual points allocation on activation',
    metadata: {},
    created_at: iso(1),
  },
];

export const commissionsTable = (): FakeRow[] => [
  {
    id: '99990000-0000-4000-8000-000000000001',
    sale_id: SALE.submitted,
    ost_id: null,
    beneficiary_type: 'staff',
    beneficiary_staff_id: UUID.adminStaff,
    beneficiary_ost_id: null,
    amount: '2400.00',
    rate_snapshot: '0.04',
    basis_amount_snapshot: '60000.00',
    status: 'pending',
    qualification_notes: null,
    qualified_at: null,
    qualified_by: null,
    earned_at: null,
    paid_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    paid_by: null,
    paid_reference: null,
    created_at: iso(10),
  },
  {
    id: '99990000-0000-4000-8000-000000000002',
    sale_id: SALE.active,
    ost_id: null,
    beneficiary_type: 'staff',
    beneficiary_staff_id: UUID.adminStaff,
    beneficiary_ost_id: null,
    amount: '2400.00',
    rate_snapshot: '0.04',
    basis_amount_snapshot: '60000.00',
    status: 'final_qualification_pending',
    qualification_notes: null,
    qualified_at: null,
    qualified_by: null,
    earned_at: null,
    paid_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    paid_by: null,
    paid_reference: null,
    created_at: iso(1),
  },
];

/** VD -> SSM -> SM -> OST chain, plus an HR account with no upline. */
export const referralRelationshipsTable = (): FakeRow[] => [
  {
    id: REFERRAL.vdToSsm,
    subject_staff_id: UUID.adminStaff,
    upline_staff_id: UUID.superAdminStaff,
    hierarchy_role: 'senior_sales_manager',
    is_authoritative: true,
    is_active: true,
    assigned_by: UUID.superAdminStaff,
    assigned_at: iso(120),
    created_at: iso(120),
    updated_at: iso(120),
  },
  {
    id: REFERRAL.ssmToSm,
    subject_staff_id: UUID.viewerStaff,
    upline_staff_id: UUID.adminStaff,
    hierarchy_role: 'sales_manager',
    is_authoritative: true,
    is_active: true,
    assigned_by: UUID.superAdminStaff,
    assigned_at: iso(100),
    created_at: iso(100),
    updated_at: iso(100),
  },
  {
    id: REFERRAL.smToOst,
    subject_staff_id: UUID.restrictedStaff,
    upline_staff_id: UUID.viewerStaff,
    hierarchy_role: 'ost',
    is_authoritative: true,
    is_active: true,
    assigned_by: UUID.superAdminStaff,
    assigned_at: iso(80),
    created_at: iso(80),
    updated_at: iso(80),
  },
];

/** Parent/child links used to resolve PostgREST embeds. */
export const LINKS = [
  { child: 'card_sales', parent: 'customers', fk: 'customer_id' },
  { child: 'card_sales', parent: 'card_plans', fk: 'plan_id' },
  { child: 'card_sales', parent: 'staff_users', fk: 'seller_staff_id' },
  { child: 'card_sales', parent: 'referral_relationships', fk: 'referral_relationship_id' },
  { child: 'commissions', parent: 'card_sales', fk: 'sale_id' },
  { child: 'commissions', parent: 'staff_users', fk: 'beneficiary_staff_id' },
  { child: 'commissions', parent: 'ost_members', fk: 'beneficiary_ost_id' },
  { child: 'memberships', parent: 'customers', fk: 'customer_id' },
  { child: 'memberships', parent: 'card_plans', fk: 'product_id' },
  { child: 'referral_relationships', parent: 'staff_users', fk: 'subject_staff_id' },
  { child: 'referral_relationships', parent: 'staff_users', fk: 'upline_staff_id' },
  { child: 'referral_relationships', parent: 'staff_users', fk: 'assigned_by' },
  { child: 'payments', parent: 'card_sales', fk: 'sale_id' },
  { child: 'points_accounts', parent: 'memberships', fk: 'membership_id' },
] as const;

/**
 * Column-level unique keys only. Postgres PARTIAL unique indexes (one open sale
 * per customer+product, one active upline per subject, unique government ID) are
 * enforced by the database and asserted structurally in
 * `phase2-migration.spec.ts`; the in-memory fake cannot express them, so those
 * cases inject a 23505 write error instead.
 */
export const UNIQUE: Record<string, string[][]> = {
  card_plans: [['code'], ['name']],
  card_categories: [['slug'], ['name']],
  customers: [['customer_number'], ['email']],
  card_sales: [['sale_number']],
  payments: [['sale_id', 'reference']],
  memberships: [['customer_id'], ['sale_id'], ['membership_number'], ['qr_token_hash']],
  commissions: [['sale_id']],
  roles: [['slug']],
  staff_users: [['id'], ['email']],
};

export function phase2Tables(overrides: Partial<FakeTables> = {}): FakeTables {
  return {
    ...baseTables(),
    card_categories: cardCategoriesTable(),
    card_plans: cardPlansTable(),
    customers: customersTable(),
    card_sales: cardSalesTable(),
    payments: paymentsTable(),
    memberships: membershipsTable(),
    points_accounts: pointsAccountsTable(),
    points_ledger: pointsLedgerTable(),
    commissions: commissionsTable(),
    referral_relationships: referralRelationshipsTable(),
    customer_onboarding_tokens: [],
    ost_members: [],
    ...overrides,
  };
}

/* ================================================================== */
/* Phase 2 staff roles                                                */
/* ================================================================== */

/**
 * Extra accounts so the selling hierarchy VD -> SSM -> SM -> OST, plus
 * Finance, can each be exercised as a distinct principal.
 */
export const STAFF2 = {
  viceDirector: '10101010-0000-4000-8000-000000000001',
  seniorSalesManager: '10101010-0000-4000-8000-000000000002',
  salesManager: '10101010-0000-4000-8000-000000000003',
  ost: '10101010-0000-4000-8000-000000000004',
  finance: '10101010-0000-4000-8000-000000000005',
  hr: '10101010-0000-4000-8000-000000000006',
} as const;

export const TOKEN2 = {
  viceDirector: 'tok-vd',
  seniorSalesManager: 'tok-ssm',
  salesManager: 'tok-sm',
  ost: 'tok-ost',
  finance: 'tok-finance',
  hr: 'tok-hr',
} as const;

export const ROLE2 = {
  viceDirector: '20202020-0000-4000-8000-000000000001',
  seniorSalesManager: '20202020-0000-4000-8000-000000000002',
  salesManager: '20202020-0000-4000-8000-000000000003',
  ost: '20202020-0000-4000-8000-000000000004',
  finance: UUID.role.finance,
  employee: UUID.role.employee,
  superAdmin: UUID.role.superAdmin,
  admin: UUID.role.admin,
} as const;

/** Modules each Phase 2 role holds. Mirrors the real role matrix. */
export const ROLE2_MODULES: Record<string, { key: string; crud: [boolean, boolean, boolean, boolean] }[]> = {
  [ROLE2.viceDirector]: [{ key: 'dashboard.view', crud: [true, false, false, false] }],
  [ROLE2.salesManager]: [
    { key: 'dashboard.view', crud: [true, false, false, false] },
    { key: 'sales.card_sales', crud: [true, true, false, false] },
    { key: 'sales.customers', crud: [true, true, true, false] },
    { key: 'sales.card_plans', crud: [true, false, false, false] },
  ],
  [ROLE2.seniorSalesManager]: [
    { key: 'dashboard.view', crud: [true, false, false, false] },
    { key: 'sales.card_sales', crud: [true, true, false, false] },
    { key: 'sales.customers', crud: [true, true, true, false] },
    { key: 'sales.card_plans', crud: [true, false, false, false] },
  ],
  [ROLE2.ost]: [
    { key: 'dashboard.view', crud: [true, false, false, false] },
    { key: 'sales.card_sales', crud: [true, true, false, false] },
    { key: 'sales.customers', crud: [true, true, true, false] },
  ],
  [ROLE2.finance]: [
    { key: 'dashboard.view', crud: [true, false, false, false] },
    { key: 'finance.payment_verification', crud: [true, true, true, false] },
    { key: 'finance.card_activation', crud: [true, true, true, false] },
    { key: 'finance.points', crud: [true, true, true, false] },
    { key: 'sales.customers', crud: [true, false, false, false] },
    { key: 'operations.redemption', crud: [true, false, false, false] },
    { key: 'network.commissions', crud: [true, false, true, false] },
  ],
  [ROLE2.admin]: [
    { key: 'dashboard.view', crud: [true, false, false, false] },
    { key: 'organization.staff', crud: [true, true, true, false] },
    { key: 'organization.departments', crud: [true, true, true, false] },
    { key: 'organization.roles', crud: [true, true, true, false] },
    { key: 'governance.audit', crud: [true, false, false, false] },
    { key: 'sales.card_sales', crud: [true, true, true, false] },
    { key: 'sales.card_plans', crud: [true, true, true, false] },
    { key: 'sales.customers', crud: [true, true, true, false] },
    { key: 'sales.uplines', crud: [true, true, true, false] },
    { key: 'network.referrals', crud: [true, true, false, false] },
    { key: 'finance.payment_verification', crud: [true, true, true, false] },
    { key: 'finance.card_activation', crud: [true, true, true, false] },
    { key: 'finance.points', crud: [true, true, true, false] },
    { key: 'network.commissions', crud: [true, true, true, false] },
    { key: 'operations.redemption', crud: [true, false, false, false] },
  ],
  [ROLE2.employee]: [{ key: 'dashboard.view', crud: [true, false, false, false] }],
};

const staff2Row = (id: string, fullName: string, email: string) => ({
  id,
  email,
  full_name: fullName,
  department_id: null,
  status: 'active',
  invited_at: iso(200),
  activated_at: iso(200),
  created_at: iso(200),
  updated_at: iso(200),
});

export const staffUsersPhase2Table = (): FakeRow[] => [
  ...baseTables().staff_users as FakeRow[],
  staff2Row(STAFF2.viceDirector, 'Vice Director', 'vd@afhomes.test'),
  staff2Row(STAFF2.seniorSalesManager, 'Senior Sales Manager', 'ssm@afhomes.test'),
  staff2Row(STAFF2.salesManager, 'Sales Manager', 'sm@afhomes.test'),
  staff2Row(STAFF2.ost, 'OST Seller', 'ost@afhomes.test'),
  staff2Row(STAFF2.finance, 'Finance Officer', 'finance@afhomes.test'),
  staff2Row(STAFF2.hr, 'HR Officer', 'hr@afhomes.test'),
];

export const staffAssignmentsPhase2Table = (): FakeRow[] => [
  ...baseTables().staff_role_assignments as FakeRow[],
  { staff_id: STAFF2.viceDirector, role_id: ROLE2.viceDirector, assigned_at: iso(200) },
  { staff_id: STAFF2.seniorSalesManager, role_id: ROLE2.seniorSalesManager, assigned_at: iso(190) },
  { staff_id: STAFF2.salesManager, role_id: ROLE2.salesManager, assigned_at: iso(180) },
  { staff_id: STAFF2.ost, role_id: ROLE2.ost, assigned_at: iso(170) },
  { staff_id: STAFF2.finance, role_id: ROLE2.finance, assigned_at: iso(160) },
  { staff_id: STAFF2.hr, role_id: ROLE2.employee, assigned_at: iso(150) },
];

export const rolesPhase2Table = (): FakeRow[] => [
  ...baseTables().roles as FakeRow[],
  { id: ROLE2.viceDirector, slug: 'vice_director', name: 'Vice Director', description: null, is_system: true, is_active: true, created_at: iso(200), updated_at: iso(200) },
  { id: ROLE2.seniorSalesManager, slug: 'senior_sales_manager', name: 'Senior Sales Manager', description: null, is_system: true, is_active: true, created_at: iso(200), updated_at: iso(200) },
  { id: ROLE2.salesManager, slug: 'sales_manager', name: 'Sales Manager', description: null, is_system: true, is_active: true, created_at: iso(200), updated_at: iso(200) },
  { id: ROLE2.ost, slug: 'ost', name: 'OST', description: null, is_system: true, is_active: true, created_at: iso(200), updated_at: iso(200) },
];

export const rolePermissionsPhase2Table = (): FakeRow[] => {
  const rows: FakeRow[] = [];
  for (const [roleId, modules] of Object.entries(ROLE2_MODULES)) {
    for (const m of modules) {
      rows.push({
        role_id: roleId,
        module_id: moduleId(m.key),
        can_view: m.crud[0],
        can_create: m.crud[1],
        can_update: m.crud[2],
        can_delete: m.crud[3],
      });
    }
  }
  return rows;
};

/** The Phase 2 upline chain: VD -> SSM -> SM -> OST. */
export const referralPhase2Table = (): FakeRow[] => [
  {
    id: 'eeeeeeee-0000-4000-8000-000000000010',
    subject_staff_id: STAFF2.seniorSalesManager,
    upline_staff_id: STAFF2.viceDirector,
    hierarchy_role: 'senior_sales_manager',
    is_authoritative: true,
    is_active: true,
    assigned_by: UUID.superAdminStaff,
    assigned_at: iso(190),
    created_at: iso(190),
    updated_at: iso(190),
  },
  {
    id: 'eeeeeeee-0000-4000-8000-000000000011',
    subject_staff_id: STAFF2.salesManager,
    upline_staff_id: STAFF2.seniorSalesManager,
    hierarchy_role: 'sales_manager',
    is_authoritative: true,
    is_active: true,
    assigned_by: UUID.superAdminStaff,
    assigned_at: iso(180),
    created_at: iso(180),
    updated_at: iso(180),
  },
  {
    id: 'eeeeeeee-0000-4000-8000-000000000012',
    subject_staff_id: STAFF2.ost,
    upline_staff_id: STAFF2.salesManager,
    hierarchy_role: 'ost',
    is_authoritative: true,
    is_active: true,
    assigned_by: UUID.superAdminStaff,
    assigned_at: iso(170),
    created_at: iso(170),
    updated_at: iso(170),
  },
];

/** Phase 1 modules plus the two added in Phase 2. */
export const modulesPhase2Table = (): FakeRow[] => [
  ...baseTables().modules as FakeRow[],
  {
    id: moduleId('sales.uplines'),
    key: 'sales.uplines',
    name: 'Upline Assignment',
    group_name: 'Sales & Customers',
    sort_order: 34,
    is_active: true,
  },
  {
    id: moduleId('finance.points'),
    key: 'finance.points',
    name: 'Points Ledger',
    group_name: 'Finance',
    sort_order: 44,
    is_active: true,
  },
];

/** The complete Phase 2 dataset: organisation + business + hierarchy. */
export function phase2World(overrides: Partial<FakeTables> = {}): FakeTables {
  return {
    ...baseTables(),
    modules: modulesPhase2Table(),
    roles: rolesPhase2Table(),
    staff_users: staffUsersPhase2Table(),
    staff_role_assignments: staffAssignmentsPhase2Table(),
    role_permissions: rolePermissionsPhase2Table(),
    referral_relationships: [
      ...referralRelationshipsTable(),
      ...referralPhase2Table(),
    ],
    card_categories: cardCategoriesTable(),
    card_plans: cardPlansTable(),
    customers: customersTable(),
    card_sales: cardSalesTable(),
    payments: paymentsTable(),
    memberships: membershipsTable(),
    points_accounts: pointsAccountsTable(),
    points_ledger: pointsLedgerTable(),
    commissions: commissionsTable(),
    customer_onboarding_tokens: [],
    ost_members: [],
    ...overrides,
  };
}

export function phase2WorldTokens(): Record<string, { id: string; email: string; email_confirmed_at: string }> {
  const out: Record<string, { id: string; email: string; email_confirmed_at: string }> = {
    ...baseTokens(),
  };
  for (const [token, id] of Object.entries({
    [TOKEN2.viceDirector]: STAFF2.viceDirector,
    [TOKEN2.seniorSalesManager]: STAFF2.seniorSalesManager,
    [TOKEN2.salesManager]: STAFF2.salesManager,
    [TOKEN2.ost]: STAFF2.ost,
    [TOKEN2.finance]: STAFF2.finance,
    [TOKEN2.hr]: STAFF2.hr,
  })) {
    out[token] = { id, email: `${id.slice(0, 8)}@afhomes.test`, email_confirmed_at: '2026-09-01T00:00:00.000Z' };
  }
  return out;
}
