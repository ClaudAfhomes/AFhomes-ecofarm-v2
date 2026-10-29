import type { Db, ClientSession } from 'mongodb';
import type { MongoRow } from './customer-activation.mongo.js';
import type { ImportContext } from './customer-import.js';
import type { WorkbookStaffMatch } from './customer-workbook.js';
import { createMongoImportClaimRecords } from './import-claim-records.mongo.js';
import { hashIdentifier } from './identifier.js';
import { manilaToday } from './sale-team.mongo.js';

/** Registered choices and current identity snapshots only; validation never creates people or money. */
export async function loadMongoCustomerImportContext(
  db: Db,
  records: { fields: Record<string, string> }[],
  session?: ClientSession,
) {
  const col = (table: string) => db.collection<MongoRow>(table);
  const emails = [
    ...new Set(
      records.map((r) => r.fields.email?.trim().toLowerCase()).filter((v): v is string => !!v),
    ),
  ];
  const numbers = [...new Set(records.map((r) => r.fields.customer_number ?? '').filter(Boolean))];
  const membershipNumbers = [
    ...new Set(records.map((r) => r.fields.membership_number ?? '').filter(Boolean)),
  ];
  const memberships = membershipNumbers.length
    ? await col('memberships')
        .find({ membership_number: { $in: membershipNumbers } }, { session })
        .toArray()
    : [];
  const selectors = [];
  if (emails.length)
    selectors.push({
      email: {
        $in: emails.map(
          (e) => new RegExp('^' + e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'),
        ),
      },
    });
  if (numbers.length) selectors.push({ customer_number: { $in: numbers } });
  if (memberships.length)
    selectors.push({ _id: { $in: memberships.map((m) => String(m.customer_id)) } });
  const customers = selectors.length
    ? await col('customers').find({ $or: selectors }, { session }).toArray()
    : [];
  const plans = await col('card_plans').find({ is_active: true }, { session }).toArray();
  const ctx: ImportContext = {
    plansByTier: new Map(
      plans.map((p) => [
        String(p.code).toUpperCase(),
        { id: p._id, code: String(p.code).toUpperCase() },
      ]),
    ),
    customerByNumber: new Map(
      customers
        .filter((c) => numbers.includes(String(c.customer_number)))
        .map((c) => [String(c.customer_number), { id: c._id, email: String(c.email ?? '') }]),
    ),
    customerByEmail: new Map(
      customers
        .filter((c) => emails.includes(String(c.email).toLowerCase()))
        .map((c) => [String(c.email).toLowerCase(), { id: c._id }]),
    ),
    membershipByNumber: new Map(
      memberships.map((m) => [
        String(m.membership_number),
        { id: m._id, customerId: String(m.customer_id) },
      ]),
    ),
    referralStaffByCode: new Map(),
    seenMembershipNumbers: new Map(),
    customerIdentityById: new Map(),
    companySnapshots: new Map(),
  };
  for (const customer of customers)
    ctx.customerIdentityById!.set(
      customer._id,
      Object.fromEntries(
        ['first_name', 'middle_name', 'last_name', 'suffix', 'email', 'phone', 'birth_date'].map(
          (k) => [k, typeof customer[k] === 'string' ? (customer[k] as string) : null],
        ),
      ),
    );
  const codes = [
    ...new Set(
      records
        .flatMap((r) => [r.fields.referral_code ?? '', r.fields.seller_code ?? ''])
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  const referrals = codes.length
    ? await col('referral_codes')
        .find({ code_hash: { $in: codes.map(hashIdentifier) } }, { session })
        .toArray()
    : [];
  for (const code of codes) {
    const referral = referrals.find((r) => r.code_hash === hashIdentifier(code));
    if (referral) ctx.referralStaffByCode.set(code, String(referral.sponsor_staff_id));
  }
  const ras = [...new Set(records.map((r) => r.fields.ra_number ?? '').filter(Boolean))],
    raOwners = new Map<string, Set<string>>();
  if (ras.length) {
    for (const row of await col('customer_import_rows')
      .find({ 'raw_data.ra_number': { $in: ras }, committed_at: { $type: 'string' } }, { session })
      .toArray()) {
      const fields = row.raw_data as Record<string, string>,
        owners = raOwners.get(fields.ra_number!) ?? new Set<string>();
      owners.add((fields.email ?? '').toLowerCase());
      raOwners.set(fields.ra_number!, owners);
    }
    for (const agreement of await col('reservation_agreements')
      .find({ reservation_number: { $in: ras } }, { session })
      .toArray())
      raOwners.set(String(agreement.reservation_number), new Set(['*']));
  }
  if (customers.length) {
    for (const row of await col('customer_import_rows')
      .find({
        customer_id: { $in: customers.map((c) => c._id) },
        committed_at: { $type: 'string' },
        'raw_data.workbook_format': 'company_v1',
      }, { session })
      .sort({ committed_at: -1 })
      .toArray()) {
      const id = String(row.customer_id);
      if (ctx.companySnapshots!.has(id)) continue;
      const customer = customers.find((c) => c._id === id)!;
      ctx.companySnapshots!.set(id, {
        fields: row.raw_data as Record<string, string>,
        current: Object.fromEntries(
          Object.entries(customer).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        ),
      });
    }
  }
  const staff = await col('staff_users')
    .find({ status: 'active' }, { session, projection: { full_name: 1 } })
    .toArray();
  const imports = createMongoImportClaimRecords(db),
    matches = new Map<string, WorkbookStaffMatch>();
  for (const row of await imports.matchStaff(staff.map((s) => String(s.full_name)), session))
    matches.set(`${row.staff_id}:${row.role_slug}`, row as WorkbookStaffMatch);
  const ids = [...matches.values()].map((s) => s.staff_id);
  const numbersByStaff = ids.length
    ? await col('sale_team_accreditations')
        .find({
          staff_id: { $in: ids },
          status: 'active',
          $or: [{ expires_on: null }, { expires_on: { $gte: manilaToday() } }],
        }, { session })
        .toArray()
    : [];
  const ost = ids.length
    ? await col('ost_members')
        .find({ _id: { $in: ids } }, { session })
        .toArray()
    : [];
  const staffMatches = [...matches.values()].map((match) => ({
    ...match,
    aa_number:
      (numbersByStaff.find((n) => n.staff_id === match.staff_id)?.aa_number as string) ?? null,
    ...(ost.find((m) => m._id === match.staff_id)
      ? {
          phone: String(ost.find((m) => m._id === match.staff_id)!.phone ?? ''),
          email: String(ost.find((m) => m._id === match.staff_id)!.email ?? ''),
        }
      : {}),
  }));
  return { ctx, staffMatches, raOwners };
}
