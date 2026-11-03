import type { ClientSession, Db, MongoClient } from 'mongodb';
import { z } from 'zod';
import { compareMoney } from '@afhomes/shared';
import {
  customerImportContinuationSchema,
  importSourceIntakeSchema,
  importContinuationRequestSchema,
  WORKBOOK_PAYMENT_SCHEMES,
} from '@afhomes/contracts';
import type { authorizeAfHomes } from './afhomes-access.js';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { buildImportedCustomerFacts, legacyPaymentClaims } from './customer-import-continuation.js';
import { workbookApplicationPrefill } from './customer-workbook.js';
import { createMongoImportSourceRecords } from './import-source.mongo.js';
import { reviewMongoHistoricalImport } from './historical-import-review.mongo.js';
import {
  createMongoImportClaimRecords,
  importNormalKey,
  importRevision,
} from './import-claim-records.mongo.js';
import { deny, fail, jsonBody, method, subPath } from './handler-kit.js';
import type { VercelRequest, VercelResponse } from './http.js';

const companyKeys = [
  'raNumber',
  'companyStatus',
  'citizenship',
  'civilStatus',
  'tinNumber',
  'occupationBusinessName',
  'officeBusinessAddress',
  'employedPosition',
  'supplementaryFullName',
  'supplementaryAddress',
  'supplementaryBirthday',
  'supplementaryGender',
  'supplementaryCitizenship',
  'supplementaryCivilStatus',
  'supplementaryTinNumber',
  'supplementaryMobile',
  'supplementaryEmail',
  'supplementaryLandline',
  'supplementaryOccupationBusinessName',
  'supplementaryOfficeAddress',
  'supplementaryPosition',
  'svdName',
  'ssmName',
  'smName',
  'referrerName',
  'vipRecommenderName',
  'relatedContactNo',
  'relatedEmail',
  'statedVipPackage',
  'statedPaymentTerms',
  'statedRegularPrice',
  'statedDiscount',
  'statedTotalAmount',
  'statedRf',
  'statedPaymentType',
  'statedRefNo',
  'statedPaymentDate',
];
const personKeys = [
  'firstName',
  'middleName',
  'lastName',
  'suffix',
  'birthDate',
  'gender',
  'email',
  'phone',
  'landline',
];
const addressKeys = [
  'line1',
  'line2',
  'province',
  'city',
  'barangay',
  'postalCode',
  'provinceCode',
  'cityMunicipalityCode',
  'barangayCode',
  'countryCode',
];
const column = (key: string) => key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
const record = (value: unknown) => (value ?? {}) as Record<string, unknown>;
const nullable = (value: unknown) => (typeof value === 'string' && value ? value : null);
const refuse = (status: number, message: string): never => {
  throw new CustomerActivationError(status, message);
};
const listSchema = z.object({
  customerId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().nonnegative().default(0),
});

/** Current continuation/intake projections only; no customer, purchase or source mutation. */
export function createMongoImportContinuationHandlers(
  db: Db,
  client: MongoClient,
  authorize: typeof authorizeAfHomes,
) {
  const col = (table: string) => db.collection<MongoRow>(table),
    imports = createMongoImportClaimRecords(db);
  async function canUpdate(
    req: VercelRequest,
    module: 'sales.customers' | 'finance.payment_verification',
  ) {
    return !('error' in (await authorize(req, module, 'update')));
  }
  async function allowedRow(
    req: VercelRequest,
    actor: string,
    row: MongoRow,
    session: ClientSession,
  ) {
    const job = await col('customer_import_jobs').findOne(
      { _id: String(row.import_job_id) },
      { session },
    );
    if (!job) refuse(404, 'Import job not found');
    if (
      job!.created_by !== actor &&
      !(await canUpdate(req, 'sales.customers')) &&
      !(await canUpdate(req, 'finance.payment_verification'))
    )
      refuse(403, 'This import source is outside your review authority');
  }
  function context(row: MongoRow) {
    const normalized = record(row.normalized_data),
      fields = (row.raw_data ?? {}) as Record<string, string>;
    const recovered = normalized.customerFacts
      ? null
      : { ...buildImportedCustomerFacts(fields), paymentClaims: legacyPaymentClaims(fields) };
    const facts = record(recovered ?? normalized.customerFacts);
    const sourceNormalized = { ...normalized };
    delete sourceNormalized.continuationPreview;
    return {
      fields,
      facts,
      normalized,
      sourceHash: importRevision({
        raw: fields,
        normalized: sourceNormalized,
        recoveryFacts: recovered,
      }),
    };
  }
  async function proposal(
    row: MongoRow,
    customer: MongoRow | null,
    facts: Record<string, unknown>,
    session: ClientSession,
  ) {
    const fills: { field: string; value: unknown }[] = [],
      conflicts: { field: string; message: string }[] = [];
    if (!customer) return { fills, conflicts };
    const raw = record(row.raw_data),
      company = record(facts.company),
      person = record(facts.person);
    const otherPurchase = await col('customer_import_purchase_sources').findOne(
      {
        customer_id: customer._id,
        normalized_reference: {
          $ne: importNormalKey(raw.purchase_reference || `legacy-import-${row._id}`),
        },
      },
      { session },
    );
    for (const key of companyKeys) {
      const field = column(key),
        value = company[key],
        previous = customer[field];
      if (
        value === undefined ||
        value === null ||
        value === '' ||
        (key === 'raNumber' && value === customer.customer_number)
      )
        continue;
      if (previous === undefined || previous === null || previous === '')
        fills.push({ field, value });
      else if (importRevision(previous) !== importRevision(value)) {
        if ((field.startsWith('stated_') || field === 'company_status') && otherPurchase) continue;
        if (
          ['statedRegularPrice', 'statedDiscount', 'statedTotalAmount', 'statedRf'].includes(key) &&
          [previous, value].every((v) => /^\d+(\.\d{1,2})?$/.test(String(v))) &&
          compareMoney(String(previous), String(value)) === 0
        )
          continue;
        conflicts.push({
          field,
          message:
            'Imported value conflicts with the current customer record. No current value will be replaced.',
        });
      }
    }
    for (const key of personKeys) {
      const field = column(key),
        value = person[key],
        previous = customer[field];
      if (value === undefined || value === null || value === '') continue;
      if (previous === undefined || previous === null || previous === '')
        fills.push({ field, value });
      else if (importNormalKey(previous) !== importNormalKey(value)) {
        const phone = (v: unknown) => String(v).replace(/\D/g, '').replace(/^63/, '0');
        if (key === 'phone' && phone(previous) === phone(value)) continue;
        conflicts.push({
          field,
          message: 'Imported identity conflicts with the current customer record. Review required.',
        });
      }
    }
    const address = record(person.address),
      merged = { ...record(customer.address) };
    let changed = false;
    for (const key of addressKeys) {
      const value = address[key],
        previous = merged[key];
      if (value === undefined || value === null || value === '') continue;
      if (previous === undefined || previous === null || previous === '') {
        merged[key] = value;
        changed = true;
      } else if (importRevision(previous) !== importRevision(value))
        conflicts.push({
          field: `address.${key}`,
          message: 'Imported address conflicts with the current customer record. Review required.',
        });
    }
    if (changed) fills.push({ field: 'address', value: merged });
    return { fills, conflicts };
  }
  async function preview(row: MongoRow, session: ClientSession) {
    const data = context(row);
    const source = await imports.sourceForRow(row, session),
      customer = await imports.customerFor(row, session);
    let appId = nullable(source?.application_id);
    if (data.fields.existing_reservation_reference) {
      const existing = await col('reservation_agreements').findOne(
        { reservation_number: data.fields.existing_reservation_reference.trim() },
        { session },
      );
      if (!existing || existing.customer_id !== customer?._id || !existing.customer_application_id)
        refuse(409, 'The existing reservation identity requires review');
      for (const [field, target] of [
        ['stated_total', 'total_price_snapshot'],
        ['stated_rf', 'reservation_fee_snapshot'],
      ] as const)
        if (
          data.fields[field] &&
          compareMoney(data.fields[field]!, String(existing![target])) !== 0
        )
          refuse(409, 'The existing reservation terms require review');
      if (
        (data.fields.vip_tier && data.fields.vip_tier.toUpperCase() !== existing!.tier_snapshot) ||
        (data.fields.stated_payment_scheme_code &&
          data.fields.stated_payment_scheme_code !== existing!.payment_scheme_snapshot)
      )
        refuse(409, 'The existing reservation terms require review');
      if (appId && appId !== existing!.customer_application_id)
        refuse(409, 'The imported purchase identity requires review');
      appId ??= String(existing!.customer_application_id);
    }
    const app = appId
      ? await col('customer_applications').findOne({ _id: appId }, { session })
      : null;
    if (appId && (!app || app.customer_id !== customer?._id))
      refuse(409, 'The imported application identity requires review');
    const reservation = appId
      ? await col('reservation_agreements').findOne(
          { customer_application_id: appId },
          { session, sort: { created_at: -1, _id: 1 } },
        )
      : null;
    let stage = 'application',
      label = 'Complete imported application',
      path = `/admin/customers/applications/new?customerId=${customer?._id ?? ''}&importRowId=${row._id}`;
    let missing = [
      'Complete and review the application, including actual acknowledgment date, consent and required holder fields.',
    ];
    if (appId) {
      missing = [];
      path = `/admin/customers/applications/${appId}`;
      label = 'Continue application';
      if (reservation) {
        path = `/admin/sales/reservations/${reservation._id}`;
        if (reservation.status === 'cancelled') {
          stage = 'review';
          label = 'Review cancelled reservation';
          missing = [
            'This reservation was cancelled; review its preserved history before any new action.',
          ];
        } else if (reservation.sale_id) {
          const sale = await col('card_sales').findOne(
            { _id: String(reservation.sale_id) },
            { session },
          );
          if (sale?.status === 'active') {
            stage = 'complete';
            label = 'View active customer';
            path = `/admin/customers/${customer!._id}`;
          } else if (sale?.status === 'cancelled') {
            stage = 'review';
            label = 'Review cancelled purchase';
            path = `/admin/customers/${customer!._id}`;
          } else {
            stage = 'activation';
            label = 'Continue activation';
            path = '/admin/finance/activation';
          }
        } else if (reservation.status === 'executed') {
          stage = 'finance';
          label = 'Review payments and continue collection';
          path = '/admin/finance/payments';
        } else {
          stage = 'reservation';
          label = 'Complete reservation';
        }
      } else if (app && ['cancelled', 'rejected'].includes(String(app.status))) {
        stage = 'review';
        label = 'Review existing application';
        missing = [
          'The existing application is cancelled or rejected; review it before continuing.',
        ];
      }
    }
    const proposed =
      source && appId
        ? { fills: [], conflicts: [] }
        : await proposal(row, customer, data.facts, session);
    if (proposed.conflicts.length) {
      stage = 'review';
      label = 'Review conflicting customer details';
      path = `/admin/customers/${customer!._id}`;
    }
    const company = record(data.facts.company);
    const claims = data.facts.paymentClaims ?? data.normalized.paymentClaims;
    const result = customerImportContinuationSchema.parse({
      rowId: row._id,
      sourceId: source?._id ?? null,
      customerId: customer?._id ?? null,
      applicationId: appId,
      reservationId: reservation?._id ?? null,
      saleId: reservation?.sale_id ?? null,
      stage,
      missingRequirements: missing,
      conflicts: proposed.conflicts,
      proposedFields: proposed.fills.map((fill) => ({
        ...fill,
        value: fill.field.includes('tin') ? 'Private value supplied' : fill.value,
      })),
      nextAction: { label, path },
      expectedSourceHash: data.sourceHash,
      expectedTargetVersion: await imports.targetForRow(row, source, session),
      expectedTeamVersion: importRevision(await imports.teamFor(data.fields, session)),
      claimCount: source
        ? await col('customer_import_payment_claims').countDocuments(
            { source_id: source._id },
            { session },
          )
        : Array.isArray(claims)
          ? claims.length
          : 0,
      customerName: customer
        ? [customer.first_name, customer.middle_name, customer.last_name, customer.suffix]
            .filter(Boolean)
            .join(' ')
            .trim()
        : null,
      purchaseReference: source?.purchase_reference ?? data.fields.purchase_reference ?? null,
      purchaseStatement: {
        tier: nullable(company.statedVipPackage),
        total: nullable(company.statedTotalAmount),
        reservationFee: nullable(company.statedRf),
      },
    });
    return customerImportContinuationSchema.parse(
      await reviewMongoHistoricalImport(db, row, result, session),
    );
  }
  const handler = async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    const path = subPath(req),
      route = /^(rows|sources)\/([^/]+)\/(intake|continuation)$/.exec(path);
    const writing =
      method(req) === 'POST' && route?.[1] === 'rows' && route?.[3] === 'continuation';
    if ((!writing && method(req) !== 'GET') || !(path === 'continuations' || route))
      return fail(res, 'NOT_IMPLEMENTED', 'This native import workflow is not enabled', 501);
    if (route && route[1] === 'sources' && route[3] !== 'intake')
      return fail(res, 'NOT_FOUND', 'Import endpoint not found', 404);
    const session = client.startSession(writing ? { defaultTimeoutMS: 45_000 } : {});
    try {
      const actor = await authorize(req, 'governance.customer_import', writing ? 'update' : 'view');
      if ('error' in actor) return deny(res, actor);
      const customerAccess = await authorize(req, 'sales.customers', 'view');
      if ('error' in customerAccess) return deny(res, customerAccess);
      const input = writing ? importContinuationRequestSchema.safeParse(jsonBody(req)) : null;
      if (writing && !input?.success)
        return fail(res, 'VALIDATION_ERROR', 'Review the source before continuing', 400);
      const data = await session.withTransaction(async () => {
        if (route) {
          if (!z.uuid().safeParse(route[2]).success) refuse(400, 'Invalid import source');
          const source =
            route[1] === 'sources'
              ? await imports.required('customer_import_purchase_sources', route[2]!, session)
              : null;
          const rowId = source ? String(source.original_row_id) : route[2]!;
          const row = await col('customer_import_rows').findOne({ _id: rowId }, { session });
          if (!row) refuse(404, 'Import row not found');
          if (writing && input?.success) {
            for (const key of ['organization-write', 'sales-write'])
              await db
                .collection<{ _id: string; seq: number }>('counters')
                .updateOne({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, session });
            return createMongoImportSourceRecords(db, authorize, {
              context,
              proposal,
              preview,
              allowedRow,
            }).commit(req, rowId, input.data, session);
          }
          await allowedRow(req, actor.userId, row!, session);
          const continuation = await preview(row!, session);
          if (route[3] === 'continuation') return continuation;
          const fields: Record<string, string> = {
            ...context(row!).fields,
            tin: '',
            secondary_tin: '',
            tin_number: '',
            supplementary_tin_number: '',
          };
          fields.stated_payment_scheme_code =
            WORKBOOK_PAYMENT_SCHEMES[fields.stated_payment_scheme ?? ''] ?? '';
          const team = Object.fromEntries(
            Object.entries({
              svdStaffId: 'vd_staff_id',
              ssmStaffId: 'ssm_staff_id',
              smStaffId: 'sm_staff_id',
              referrerStaffId: 'referrer_staff_id',
            }).flatMap(([key, field]) => (fields[field] ? [[key, fields[field]]] : [])),
          );
          return importSourceIntakeSchema.parse({
            continuation,
            prefill: workbookApplicationPrefill(fields),
            claims: [],
            purchaseReference: fields.purchase_reference || null,
            team,
          });
        }
        const query = listSchema.safeParse(req.query);
        if (!query.success) refuse(400, 'Invalid continuation filters');
        if (!query.success) return;
        const mayReviewOthers =
          (await canUpdate(req, 'sales.customers')) ||
          (await canUpdate(req, 'finance.payment_verification'));
        const all = await col('customer_import_rows')
          .aggregate<MongoRow>(
            [
              {
                $match: {
                  committed_at: { $type: 'string' },
                  'raw_data.workbook_format': { $in: ['company_v1', 'company_v2'] },
                  ...(query.data.customerId ? { customer_id: query.data.customerId } : {}),
                },
              },
              {
                $lookup: {
                  from: 'customer_import_jobs',
                  localField: 'import_job_id',
                  foreignField: '_id',
                  as: 'job',
                },
              },
              { $unwind: '$job' },
              ...(!mayReviewOthers ? [{ $match: { 'job.created_by': actor.userId } }] : []),
              {
                $lookup: {
                  from: 'customer_import_source_rows',
                  localField: '_id',
                  foreignField: 'row_id',
                  as: 'links',
                },
              },
              {
                $set: {
                  sourceKey: { $ifNull: [{ $arrayElemAt: ['$links.source_id', 0] }, '$_id'] },
                },
              },
              { $sort: { committed_at: -1, _id: 1 } },
              { $group: { _id: '$sourceKey', row: { $first: '$$ROOT' } } },
              { $replaceRoot: { newRoot: '$row' } },
              { $sort: { committed_at: -1, _id: 1 } },
              { $skip: query.data.offset },
              { $limit: query.data.limit },
              { $project: { job: 0, links: 0, sourceKey: 0 } },
            ],
            { session },
          )
          .toArray();
        const result = [];
        for (const row of all) {
          await allowedRow(req, actor.userId, row, session);
          result.push(await preview(row, session));
        }
        return result;
      });
      return res.status(200).json(data);
    } catch (error) {
      if (error instanceof CustomerActivationError)
        return fail(
          res,
          error.status === 403
            ? 'FORBIDDEN'
            : error.status === 400
              ? 'VALIDATION_ERROR'
              : error.status === 404
                ? 'NOT_FOUND'
                : error.status === 501
                  ? 'NOT_IMPLEMENTED'
                  : 'CONFLICT',
          error.message,
          error.status,
        );
      return fail(res, 'INTERNAL', 'Imported purchase review is unavailable. Please retry.', 503);
    } finally {
      await session.endSession();
    }
  };
  return { handler, preview, context, proposal, allowedRow };
}
