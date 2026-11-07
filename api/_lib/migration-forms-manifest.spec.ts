import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { reviewedFormsMigrationTables, reconcileSourceForms } from './migration-forms-manifest.js';
import {
  planMigrationMapping,
  type MigrationManifest,
  type MigrationRecord,
} from './migration-mapping.js';
import { reconcileMigrationMapping } from './migration-reconciliation.js';
import { createTestReplica } from './testing/mongo-replica.js';
import { setupMongoOfficialForms } from './official-forms.mongo.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-10-31T00:00:00.123456Z';
function fixture() {
  const definitions = reviewedFormsMigrationTables(),
    parents = [
      'customers',
      'card_sales',
      'card_plans',
      'ost_members',
      'commission_rules',
      'payments',
      'memberships',
    ];
  const manifest: MigrationManifest = {
    version: 1,
    timestampPrecision: 'preserve-source',
    protectedOwner: { table: 'public.staff_users', sourceId: id(1), targetId: id(2) },
    tables: [
      {
        source: 'public.staff_users',
        target: 'staff_users',
        key: ['id'],
        columns: ['id', 'email', 'status'],
        ownerField: 'id',
        uuids: ['id'],
      },
      ...parents.map((name) => ({
        source: `public.${name}`,
        target: name,
        key: ['id'],
        columns: ['id'],
        uuids: ['id'],
      })),
      ...definitions,
    ],
  };
  const source: Record<string, Record<string, unknown>[]> = {
    'public.staff_users': [{ id: id(1), email: 'owner@example.invalid', status: 'active' }],
  };
  parents.forEach((name, index) => (source[`public.${name}`] = [{ id: id(index + 3) }]));
  for (const table of definitions)
    source[table.source] = [Object.fromEntries(table.columns.map((column) => [column, null]))];
  Object.assign(source['public.customer_applications']![0]!, {
    id: id(20),
    application_number: 'SYNTHETIC-APPLICATION',
    customer_id: id(3),
    sale_id: id(4),
    plan_id: id(5),
    tier_snapshot: 'BRONZE',
    payment_scheme_snapshot: 'spot_cash',
    vip_amount_snapshot: '54000.00',
    discount_percent_snapshot: 5,
    validity_years_snapshot: 7,
    yearly_points_snapshot: 60000,
    annual_points_tranches_snapshot: 7,
    holder_limit_snapshot: 1,
    acquisition_channels: ['Walk-In'],
    consent_acknowledged: true,
    primary_signature_status: 'received',
    valid_id_received: true,
    reservation_payment_proof_received: true,
    status: 'approved',
    created_by: id(1),
    created_at: at,
    updated_at: at,
    submitted_at: at,
    approved_at: at,
    purchase_terms_id: id(21),
  });
  Object.assign(source['public.customer_application_purchase_terms']![0]!, {
    id: id(21),
    application_id: id(20),
    customer_id: id(3),
    plan_id: id(5),
    seller_staff_id: id(1),
    version: 1,
    capture_kind: 'submission',
    captured_by: id(1),
    captured_at: at,
    tier: 'BRONZE',
    payment_scheme: 'spot_cash',
    total_price: '54000.00',
    reservation_fee: '10000.00',
    minimum_down_payment: '10000.00',
    required_initial: '10000.00',
    spot_cash_days: 7,
    validity_months: 84,
    discount_percent: 5,
    yearly_points: 60000,
    annual_points_tranches: 7,
    holder_limit: 1,
    inclusions: ['FROZEN BENEFITS'],
    commission_rate: '0',
    commission_base: '54000.00',
    expected_commission: '0.00',
  });
  Object.assign(source['public.customer_application_holders']![0]!, {
    id: id(22),
    application_id: id(20),
    holder_type: 'PRIMARY',
    last_name: 'Customer',
    first_name: 'Fictional',
    birth_date: '1940-01-01',
    permanent_address_line_1: 'Fictional historical address',
    city_municipality: 'Fictional city',
    province: 'Fictional province',
    mobile: '09123456789',
    email: 'fictional@example.invalid',
    printed_name: 'FICTIONAL CUSTOMER',
    created_at: at,
  });
  Object.assign(source['public.reservation_agreements']![0]!, {
    id: id(23),
    reservation_number: 'SYNTHETIC-RESERVATION',
    reservation_date: '2026-10-31',
    agreement_date: '2026-10-31',
    sale_id: id(4),
    customer_application_id: id(20),
    plan_id: id(5),
    tier_snapshot: 'BRONZE',
    inclusions_snapshot: { items: ['FROZEN BENEFITS'] },
    total_price_snapshot: '54000.00',
    reservation_fee_snapshot: '10000.00',
    down_payment_snapshot: '10000.00',
    total_payment_received_snapshot: '54000.00',
    balance_snapshot: '0.00',
    payment_scheme_snapshot: 'spot_cash',
    discount_percent_snapshot: 5,
    validity_years_snapshot: 7,
    yearly_points_snapshot: 60000,
    annual_points_tranches_snapshot: 7,
    holder_limit_snapshot: 1,
    status: 'executed',
    created_by: id(1),
    created_at: at,
    updated_at: at,
    submitted_at: at,
    executed_at: at,
    origin: 'application',
    customer_id: id(3),
    seller_staff_id: id(1),
    purchase_terms_id: id(21),
    minimum_down_payment_snapshot: '10000.00',
    required_initial_snapshot: '10000.00',
    spot_cash_days_snapshot: 7,
    validity_months_snapshot: 84,
    commission_rate_snapshot: '0',
    commission_base_snapshot: '54000.00',
    expected_commission_snapshot: '0.00',
    finalized_by: id(1),
    finalized_at: at,
  });
  Object.assign(source['public.reservation_agreement_holders']![0]!, {
    id: id(24),
    agreement_id: id(23),
    holder_type: 'PRIMARY',
    name: 'FICTIONAL CUSTOMER',
    address: 'Fictional address',
    contact_number: '09123456789',
    email: 'fictional@example.invalid',
    created_at: at,
  });
  Object.assign(source['public.reservation_agreement_schedule']![0]!, {
    id: id(25),
    agreement_id: id(23),
    line_number: 1,
    particular: 'RESERVATION',
    amount_snapshot: '10000.00',
    created_at: at,
  });
  Object.assign(source['private.purchase_document_evidence']![0]!, {
    id: id(26),
    kind: 'reservation',
    reservation_id: id(23),
    source_id: id(23),
    revision: 1,
    schema_version: 1,
    actor_id: id(1),
    captured_at: at,
    fields: {
      reservationNumber: 'SYNTHETIC-RESERVATION',
      saleNumber: 'SYNTHETIC-SALE',
      applicationNumber: 'SYNTHETIC-APPLICATION',
      customerNumber: 'SYNTHETIC-CUSTOMER',
      customerName: 'FICTIONAL CUSTOMER',
      sellerName: 'FROZEN SELLER',
      actorName: 'FROZEN ACTOR',
      totalPrice: '54000.00',
      purchaseTermsId: id(21),
      termsVersion: 1,
      tier: 'BRONZE',
      paymentScheme: 'spot_cash',
      reservationFee: '10000.00',
      requiredInitial: '10000.00',
      yearlyPoints: 60000,
      validityMonths: 84,
      commissionRate: '0',
      expectedCommission: '0.00',
      minimumDownPayment: '10000.00',
      installmentMonths: null,
      monthlyAmount: null,
      spotCashDays: 7,
      discountPercent: 5,
      annualPointsTranches: 7,
      holderLimit: 1,
      inclusions: ['FROZEN BENEFITS'],
      secondaryAddress: null,
      schedule: [],
      reservationDate: '2026-10-31',
      agreementDate: '2026-10-31',
      revisionNumber: null,
      monthlyAmortizationStart: null,
      monthlyAmortizationEnd: null,
      paymentDueDay: null,
      status: 'executed',
      primaryName: 'FICTIONAL CUSTOMER',
      primaryAddress: 'Fictional address',
      secondaryName: null,
      verifiedTotal: '54000.00',
      balance: '0.00',
      primarySignatureStatus: 'received',
      secondarySignatureStatus: null,
    },
  });
  const target: Record<string, MigrationRecord[]> = Object.fromEntries(
    manifest.tables.map((table) => [table.target, []]),
  );
  target.staff_users = [
    { _id: id(2), email: 'owner@example.invalid', status: 'active', preserved: true },
  ];
  return { manifest, data: { source, target } };
}

it('covers all form source columns, nullability, scalar types and source keys', () => {
  const inventory = JSON.parse(
    readFileSync(
      new URL('../../docs/mongodb/SOURCE-SCHEMA-INVENTORY-2026-10-30.json', import.meta.url),
      'utf8',
    ),
  ) as {
    columns: {
      schema: string;
      table: string;
      name: string;
      type: string;
      nullable: string;
      udt_name: string;
    }[];
    constraints: { schema: string; table: string; kind: string; columns: string[] }[];
  };
  for (const table of reviewedFormsMigrationTables()) {
    const columns = inventory.columns.filter(
      (column) => `${column.schema}.${column.table}` === table.source,
    );
    expect([...table.columns].sort()).toEqual(columns.map((column) => column.name).sort());
    expect([...table.notNull!].sort()).toEqual(
      columns
        .filter((column) => column.nullable === 'NO')
        .map((column) => column.name)
        .sort(),
    );
    expect(table.key).toEqual(
      inventory.constraints.find(
        (constraint) =>
          `${constraint.schema}.${constraint.table}` === table.source && constraint.kind === 'p',
      )!.columns,
    );
    for (const column of columns) {
      const declared =
        column.type === 'uuid'
          ? table.uuids
          : column.type === 'text'
            ? [...(table.text ?? []), ...(table.money ?? [])]
            : column.type === 'integer'
              ? table.int32
              : column.type === 'boolean'
                ? table.booleans
                : column.type === 'timestamp with time zone'
                  ? table.timestamps
                  : column.type === 'date'
                    ? table.dates
                    : column.type === 'ARRAY'
                      ? table.stringArrays
                      : [column.name];
      expect(declared).toContain(column.name);
      if (column.type === 'ARRAY') expect(column.udt_name).toBe('_text');
    }
  }
});

it('preserves original commercial versions, old holder dates, document signatures and nested names without recomputation', () => {
  const { manifest, data } = fixture(),
    saved = structuredClone(data),
    plan = planMigrationMapping(manifest, data);
  expect(plan.issues).toEqual([]);
  expect(reconcileSourceForms(data.source).issues).toEqual([]);
  expect(plan.records.customer_application_holders![0]!.birth_date).toBe('1940-01-01');
  expect(plan.records.purchase_document_evidence![0]!.fields).toEqual(
    data.source['private.purchase_document_evidence']![0]!.fields,
  );
  expect(plan.records.purchase_document_evidence![0]!.actor_id).toBe(id(2));
  expect(data).toEqual(saved);
});

it('rejects mismatched composite terms, illegal channels, lifecycle gaps and unexpected evidence fields', () => {
  for (const [table, column, value] of [
    ['public.customer_application_purchase_terms', 'required_initial', '9999.00'],
    ['public.customer_applications', 'approved_at', null],
    ['public.customer_applications', 'acquisition_channels', ['UNKNOWN']],
    ['public.reservation_agreements', 'finalized_at', null],
    ['private.purchase_document_evidence', 'source_id', id(99)],
  ]) {
    const { manifest, data } = fixture();
    data.source[String(table)]![0]![String(column)] = value;
    expect(planMigrationMapping(manifest, data).ready).toBe(false);
  }
  const { data } = fixture();
  data.source['public.customer_application_purchase_terms']![0]!.customer_id = id(99);
  expect(reconcileSourceForms(data.source).issues).toContainEqual(
    expect.objectContaining({ code: 'RESERVATION_TERMS_LINK_MISMATCH' }),
  );
});

it('loads frozen forms into native indexes and reconciles an identical replay', async () => {
  const replica = await createTestReplica();
  try {
    await setupMongoOfficialForms(replica.db);
    const { manifest, data } = fixture(),
      plan = planMigrationMapping(manifest, data);
    expect(plan.issues).toEqual([]);
    for (const [name, rows] of Object.entries(data.target))
      if (rows.length) await replica.db.collection<MigrationRecord>(name).insertMany(rows);
    for (const [name, rows] of Object.entries(plan.records))
      if (rows.length) await replica.db.collection<MigrationRecord>(name).insertMany(rows);
    const after: Record<string, MigrationRecord[]> = {};
    for (const table of manifest.tables)
      after[table.target] = await replica.db
        .collection<MigrationRecord>(table.target)
        .find()
        .toArray();
    expect(reconcileMigrationMapping(manifest, data, after).issues).toEqual([]);
    expect(
      planMigrationMapping(manifest, { ...data, target: after }).records.purchase_document_evidence,
    ).toEqual([]);
    expect(after.staff_users).toEqual(data.target.staff_users);
  } finally {
    await replica.stop();
  }
}, 15000);
