import { randomUUID } from 'node:crypto';
import type { ClientSession, Db } from 'mongodb';
import type { authorizeAfHomes } from './afhomes-access.js';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { validateImportRow, type NormalizedImportRow } from './customer-import.js';
import { loadMongoCustomerImportContext } from './customer-import-context.mongo.js';
import { companyKeys, personKeys } from './import-customer-fields.js';
import {
  allocatePurchaseId,
  createMongoPurchaseRecords,
  purchaseFingerprint,
} from './purchase-records.mongo.js';
import { companyId } from './customers.mongo.js';
import { hashIdentifier } from './identifier.js';
import { manilaToday } from './sale-team.mongo.js';
import type { VercelRequest } from './http.js';
import { createMongoLegacyPurchase } from './legacy-member-create.mongo.js';

const record = (value: unknown) => (value ?? {}) as Record<string, unknown>;
const column = (key: string) => key.replace(/[A-Z]/g, (letter) => '_' + letter.toLowerCase());
function refuse(message: string): never {
  throw new CustomerActivationError(409, message);
}
export function isMongoLegacyIntake(row: MongoRow) {
  const n = record(row.normalized_data);
  return (
    !['company_v1', 'company_v2'].includes(String(record(row.raw_data).workbook_format)) &&
    ['PENDING', 'INACTIVE', 'CANCELLED'].includes(String(n.category)) &&
    (
      { PENDING: 'prospect', INACTIVE: 'suspended', CANCELLED: 'cancelled' } as Record<
        string,
        string
      >
    )[String(n.category)] === n.customerStatus &&
    n.requireMember === false &&
    n.payment == null &&
    !n.historicalSaleTotal &&
    !n.totalPaid &&
    !n.existingVipControlNumber &&
    !n.existingCardActivationStatus &&
    !n.existingCardActivationDate &&
    !n.existingCardValidUntil &&
    Number(n.existingStayPointsTotal ?? 0) === 0 &&
    Number(n.openingBalance ?? 0) === 0 &&
    !n.membershipNumber &&
    !n.externalVerified &&
    !row.membership_id
  );
}
export function isMongoLegacyMemberUpdate(row: MongoRow) {
  const n = record(row.normalized_data);
  return (
    !['company_v1', 'company_v2'].includes(String(record(row.raw_data).workbook_format)) &&
    row.action === 'UPDATE' &&
    ['ACTIVE_VIP', 'SUSPENDED', 'EXPIRED', 'CANCELLED'].includes(String(n.category)) &&
    n.payment == null &&
    !n.externalVerified
  );
}
export function isMongoLegacyMemberCreate(row: MongoRow) {
  const n = record(row.normalized_data);
  return (
    !['company_v1', 'company_v2'].includes(String(record(row.raw_data).workbook_format)) &&
    row.action === 'CREATE' &&
    n.requireMember === true &&
    ['ACTIVE_VIP', 'SUSPENDED', 'EXPIRED'].includes(String(n.category)) &&
    !!n.payment &&
    !!n.historicalSaleTotal &&
    !n.externalVerified &&
    !n.existingVipControlNumber &&
    !n.existingCardActivationStatus &&
    !n.existingCardActivationDate &&
    !n.existingCardValidUntil &&
    Number(n.existingStayPointsTotal ?? 0) === 0
  );
}
export function isMongoLegacyFinancialCreate(row: MongoRow) {
  const n = record(row.normalized_data);
  return (
    !['company_v1', 'company_v2'].includes(String(record(row.raw_data).workbook_format)) &&
    row.action === 'CREATE' &&
    n.requireMember === false &&
    !!n.payment &&
    [
      'RESERVATION_PAID',
      'DOWN_PAYMENT_COMPLETED',
      'PARTIALLY_PAID',
      'FULLY_PAID_AWAITING_ACTIVATION',
    ].includes(String(n.category)) &&
    !n.externalVerified &&
    !n.existingVipControlNumber &&
    !n.existingCardActivationStatus &&
    !n.existingCardActivationDate &&
    !n.existingCardValidUntil &&
    Number(n.existingStayPointsTotal ?? 0) === 0
  );
}
const revision = (n: NormalizedImportRow) => {
  const snapshot = { ...n, person: { ...n.person } };
  delete snapshot.person.age;
  return purchaseFingerprint(snapshot);
};

/** Legacy intake, financial history and member updates; caller holds organization/sales guards. */
export async function commitMongoLegacyRow(
  db: Db,
  req: VercelRequest,
  row: MongoRow,
  session: ClientSession,
  authorize: typeof authorizeAfHomes,
) {
  const col = (name: string) => db.collection<MongoRow>(name),
    purchase = createMongoPurchaseRecords(db);
  let actor = '';
  for (const action of ['view', 'update'] as const) {
    const access = await authorize(req, 'governance.customer_import', action);
    if ('error' in access)
      throw new CustomerActivationError(access.error.status, 'Import permission is required');
    actor = access.userId;
  }
  if (row.committed_at)
    return {
      customerId: String(row.customer_id),
      membershipId: row.membership_id ? String(row.membership_id) : null,
      continuation: undefined,
    };
  if (
    (!isMongoLegacyIntake(row) &&
      !isMongoLegacyMemberUpdate(row) &&
      !isMongoLegacyMemberCreate(row) &&
      !isMongoLegacyFinancialCreate(row)) ||
    !['valid', 'warning'].includes(String(row.validation_status))
  )
    refuse('Legacy financial or membership history requires its reviewed import workflow');
  const raw = row.raw_data as Record<string, string>,
    original = row.normalized_data as NormalizedImportRow;
  const { ctx } = await loadMongoCustomerImportContext(db, [{ fields: raw }], session);
  const fresh = validateImportRow(Number(row.row_number), raw, ctx, manilaToday());
  if (
    !fresh.normalized ||
    fresh.errors.length ||
    fresh.action !== row.action ||
    fresh.customerId !== (row.customer_id ?? null) ||
    fresh.membershipId !== (row.membership_id ?? null) ||
    revision(fresh.normalized) !== revision(original)
  )
    refuse('Legacy customer identity or source changed. Review the file again');
  const n = fresh.normalized,
    now = new Date().toISOString();
  const code = (raw.referral_code || raw.seller_code || '').trim().toUpperCase();
  let sponsor: string | null = null,
    seller: string | null = null;
  for (const value of new Set(
    [code, (raw.seller_code || '').trim().toUpperCase()].filter(Boolean),
  )) {
    const referral = await col('referral_codes').findOne(
      { code_hash: hashIdentifier(value), is_active: true },
      { session },
    );
    const expires = referral ? new Date(String(referral.expires_at)).valueOf() : NaN;
    if (
      !referral ||
      !Number.isFinite(expires) ||
      expires <= Date.now() ||
      !Number.isSafeInteger(Number(referral.use_count)) ||
      !Number.isSafeInteger(Number(referral.max_uses)) ||
      Number(referral.use_count) < 0 ||
      Number(referral.use_count) >= Number(referral.max_uses) ||
      !(await col('staff_users').findOne(
        { _id: String(referral.sponsor_staff_id), status: 'active' },
        { session },
      ))
    )
      refuse('The imported referral code is no longer valid');
    if (value === code) sponsor = String(referral.sponsor_staff_id);
    if (value === (raw.seller_code || '').trim().toUpperCase())
      seller = String(referral.sponsor_staff_id);
  }
  const address = Object.fromEntries(
    Object.entries({
      line1: 'address_line_1',
      line2: 'address_line_2',
      city: 'city',
      province: 'province',
      barangay: 'barangay',
      postalCode: 'postal_code',
      countryCode: 'country',
    }).flatMap(([key, field]) => (raw[field]?.trim() ? [[key, raw[field].trim()]] : [])),
  );
  const company = Object.fromEntries(
    companyKeys.flatMap((key) =>
      n.company[key] != null && n.company[key] !== '' ? [[column(key), n.company[key]]] : [],
    ),
  );
  let id: string,
    membershipId: string | null = null,
    saleId: string | null = null;
  if (row.action === 'CREATE') {
    id = randomUUID();
    const values = Object.fromEntries(
      personKeys
        .filter((key) => key !== 'address')
        .map((key) => [column(key), n.person[key] ?? null]),
    );
    const person: MongoRow = {
      _id: id,
      ...values,
      ...company,
      customer_number: await allocatePurchaseId(
        db,
        'AF-CUS',
        'customers',
        'customer_number',
        session,
      ),
      customer_code: await allocatePurchaseId(
        db,
        'AF-CC',
        'customers',
        'customer_code',
        session,
        8,
      ),
      address: {
        line1: 'Imported address',
        city: 'Imported',
        province: 'Imported',
        countryCode: 'PH',
        ...address,
      },
      status: n.customerStatus,
      auth_user_id: null,
      registration_source: 'bulk_import',
      referred_by_staff_id: sponsor,
      ...(sponsor ? { referral_code_used: code } : {}),
      notes:
        [raw.notes, n.secondaryNote ? `Secondary cardholder: ${n.secondaryNote}` : '']
          .filter(Boolean)
          .join('\n') || null,
      created_by: actor,
      created_at: now,
      updated_at: now,
    };
    person.ra_number = await companyId(db, person.ra_number, session, true);
    await col('customers').insertOne(person, { session });
    if (isMongoLegacyMemberCreate(row) || isMongoLegacyFinancialCreate(row)) {
      const restored = await createMongoLegacyPurchase(db, row, n, id, actor, seller, session);
      membershipId = restored.membershipId;
      saleId = restored.saleId;
    }
    await purchase.audit(
      actor,
      'CUSTOMER_IMPORTED',
      'customer_import_row',
      String(row.import_job_id),
      null,
      { customerId: id, saleId, membershipId },
      session,
    );
  } else {
    id = String(row.customer_id);
    const person = await purchase.required('customers', id, session);
    const members = await col('memberships')
      .find({ customer_id: id }, { session })
      .limit(2)
      .toArray();
    if (members.length > 1) refuse('Multiple memberships require individual review');
    const member = members[0];
    if (member) {
      if (!isMongoLegacyMemberUpdate(row) || member._id !== row.membership_id)
        refuse('Existing membership ownership changed. Review the file again');
      const sale = await purchase.required('card_sales', String(member.sale_id), session);
      const plan = await purchase.required('card_plans', String(sale.plan_id), session);
      if (sale.customer_id !== id || (n.tier && plan.code !== n.tier))
        refuse('Existing membership tier or ownership conflicts with the file');
      const current = String(member.status);
      if (!['active', 'suspended', 'expired', 'cancelled'].includes(current))
        refuse('Existing membership status requires individual review');
      if (n.category === 'ACTIVE_VIP' && current !== 'active')
        refuse('Import cannot reactivate an existing membership');
      const target =
        (
          { SUSPENDED: 'suspended', EXPIRED: 'expired', CANCELLED: 'cancelled' } as Record<
            string,
            string
          >
        )[n.category] ?? current;
      if (target !== current && current !== 'active')
        refuse('Import cannot change an inactive membership to another status');
      await col('memberships').updateOne(
        { _id: member._id },
        { $set: { status: target } },
        { session },
      );
      membershipId = member._id;
      saleId = sale._id;
      if (sale.origin === 'legacy_import')
        await col('card_sales').updateOne(
          { _id: sale._id },
          { $set: { import_row_id: row._id } },
          { session },
        );
    } else if (row.membership_id || n.requireMember) {
      refuse('An existing customer cannot acquire a membership through a legacy update');
    }
    const patch: Record<string, unknown> = {
      ...company,
      address: { ...record(person.address), ...address },
      updated_at: now,
    };
    for (const key of personKeys.filter((key) => !['address', 'email'].includes(key)))
      if (n.person[key] != null && n.person[key] !== '') patch[column(key)] = n.person[key];
    if (raw.notes?.trim()) patch.notes = raw.notes.trim();
    if (['SUSPENDED', 'CANCELLED'].includes(n.category)) patch.status = n.customerStatus;
    if (patch.ra_number) patch.ra_number = await companyId(db, patch.ra_number, session, false);
    await col('customers').updateOne({ _id: id }, { $set: patch }, { session });
  }
  await col('customer_import_rows').updateOne(
    { _id: row._id },
    { $set: { customer_id: id, membership_id: membershipId, sale_id: saleId, committed_at: now } },
    { session },
  );
  await purchase.audit(
    actor,
    'CUSTOMER_IMPORT_ROW_COMMITTED',
    'customer_import_row',
    row._id,
    null,
    { customerId: id, membershipId, saleId, importJobId: row.import_job_id },
    session,
  );
  return { customerId: id, membershipId, continuation: undefined };
}
