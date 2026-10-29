import { personKeys, companyKeys } from './import-customer-fields.js';
import { randomUUID } from 'node:crypto';
import type { Db, ClientSession } from 'mongodb';
import { addMoney, compareMoney } from '@afhomes/shared';
import { workbookPaymentClaimSchema } from '@afhomes/contracts';
import type { authorizeAfHomes } from './afhomes-access.js';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { companyId, allocateMongoVipCardNumber } from './customers.mongo.js';
import {
  createMongoImportClaimRecords,
  importNormalKey,
  importRevision,
} from './import-claim-records.mongo.js';
import { createMongoPurchaseRecords, allocatePurchaseId } from './purchase-records.mongo.js';
import { manilaToday } from './sale-team.mongo.js';
import type { createMongoImportContinuationHandlers } from './import-continuation.mongo.js';
import type { VercelRequest } from './http.js';
import { reconcileMongoHistoricalPurchase, requireMongoHistoricalImportSetup } from './historical-import.mongo.js';

type Readers = Pick<
  ReturnType<typeof createMongoImportContinuationHandlers>,
  'context' | 'proposal' | 'preview' | 'allowedRow'
>;
type Draft = {
  data: { header: Record<string, unknown>; primary: Record<string, unknown>; secondary: unknown };
  create: () => Promise<{
    id: string;
    terms: { totalPrice: string; reservationFee: string; tier: string; paymentScheme: string };
  }>;
};
const record = (value: unknown) => (value ?? {}) as Record<string, unknown>;
const refuse = (status: number, message: string): never => {
  throw new CustomerActivationError(status, message);
};
const column = (value: string) => value.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
/** Private business writer: callers supply a guarded transaction; never mounted as a generic RPC. */
export function createMongoImportSourceRecords(
  db: Db,
  authorize: typeof authorizeAfHomes,
  reads: Readers,
) {
  const col = (table: string) => db.collection<MongoRow>(table),
    imports = createMongoImportClaimRecords(db),
    records = createMongoPurchaseRecords(db);
  async function permitted(
    req: VercelRequest,
    module: 'governance.customer_import' | 'sales.customers' | 'sales.card_sales' | 'finance.payment_verification' | 'finance.card_activation',
    action: 'view' | 'update' | 'create',
  ) {
    const actor = await authorize(req, module, action);
    if ('error' in actor) refuse(actor.error.status, 'Import action is not permitted');
    if ('error' in actor) throw new Error('Unreachable import authority');
    return actor;
  }
  async function team(raw: Record<string, unknown>, session: ClientSession) {
    const matches = await imports.teamFor(raw, session),
      rank: Record<string, number> = {
        vice_director: 0,
        senior_sales_manager: 1,
        sales_manager: 2,
        ost: 3,
      };
    const parents: string[] = [];
    let ref: string[] | null = null,
      vip: string[] | null = null;
    for (const key of ['vd_name', 'ssm_name', 'sm_name', 'referrer_name', 'recommender_name']) {
      if (!String(raw[key] ?? '').trim()) continue;
      const expected =
        key === 'vd_name'
          ? 'vice_director'
          : key === 'ssm_name'
            ? 'senior_sales_manager'
            : key === 'sm_name'
              ? 'sales_manager'
              : 'ost';
      const match = matches.find(
        (m) => m.staff_id === raw[key.replace('_name', '_staff_id')] && m.role_slug === expected,
      );
      if (!match || (raw.workbook_format !== 'company_v2' && match.match_count !== 1))
        refuse(409, 'The registered sales team requires review');
      const ancestors = match!.ancestor_ids as string[];
      if (
        new Set(ancestors).size !== ancestors.length ||
        ancestors.includes(String(match!.staff_id))
      )
        refuse(409, 'The registered sales hierarchy requires review');
      let previous = rank[String(match!.role_slug)]!;
      for (const id of ancestors) {
        const staff = await col('staff_users').findOne({ _id: id, status: 'active' }, { session });
        const assignments = await col('staff_role_assignments')
          .find({ staff_id: id }, { session })
          .toArray();
        const role =
          assignments.length === 1
            ? await col('roles').findOne(
                { _id: String(assignments[0]!.role_id), is_active: true },
                { session },
              )
            : null;
        const next = role ? rank[String(role.slug)] : undefined;
        if (!staff || next === undefined || next >= previous)
          refuse(409, 'The registered sales hierarchy requires review');
        previous = next!;
      }
      if (previous !== 0) refuse(409, 'The registered sales hierarchy requires review');
      if (['vd_name', 'ssm_name', 'sm_name'].includes(key)) {
        if (parents.some((p) => !ancestors.includes(p)))
          refuse(409, 'The registered sales team requires review');
        parents.push(String(match!.staff_id));
      } else if (key === 'referrer_name') {
        if (parents.some((p) => !ancestors.includes(p)))
          refuse(409, 'The registered sales team requires review');
        ref = ancestors;
      } else vip = ancestors;
    }
    if (ref && vip && (!ref.length || !vip.length || ref.at(-1) !== vip.at(-1)))
      refuse(409, 'The registered referral teams conflict');
  }
  function intent(row: MongoRow) {
    const data = reads.context(row),
      company = { ...record(data.facts.company) };
    for (const key of [
      'raNumber',
      'existingVipControlNumber',
      'existingCardActivationStatus',
      'existingStayPointsTotal',
      'existingCardActivationDate',
      'existingCardValidUntil',
      'vipPurchaseDate',
      'contractClassification',
      'paymentTermMonths',
    ])
      delete company[key];
    const claims = (
      Array.isArray(data.normalized.paymentClaims) ? data.normalized.paymentClaims : []
    )
      .map((c) => {
        const { customerKey: _customer, paymentKey: _key, ...claim } = record(c);
        return claim;
      })
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return importRevision({
      person: data.facts.person,
      company,
      claims,
      existingReservation: data.fields.existing_reservation_reference || null,
    });
  }
  async function vip(row: MongoRow, customer: MongoRow, actor: string, session: ClientSession) {
    const raw = record(row.raw_data);
    if (!Object.hasOwn(raw, 'existing_vip_control_number')) return;
    const supplied = String(raw.existing_vip_control_number ?? ''),
      existing = String(customer.vip_card_number ?? '');
    if (supplied && !/^\d{11}[BGS]1[CT]\d{2}[SN]$/.test(supplied))
      refuse(409, 'The supplied VIP control number requires review');
    if (supplied && supplied !== existing && (existing || record(row.normalized_data).externalVerified !== true))
      refuse(409, 'A supplied historical VIP number requires certified evidence');
    if (existing) {
      if (
        raw.contract_classification &&
        existing.endsWith('N') !== (raw.contract_classification === 'Non-Standard')
      )
        refuse(409, 'The VIP contract classification conflicts');
      return;
    }
    if (supplied) {
      if (Boolean(raw.contract_classification === 'Non-Standard') !== supplied.endsWith('N'))
        refuse(409, 'The VIP contract classification conflicts');
      if (await col('customers').findOne({ vip_card_number: supplied, _id: { $ne: customer._id } }, { session }))
        refuse(409, 'This VIP card ID belongs to another customer');
      await col('customers').updateOne({ _id: customer._id }, { $set: { vip_card_number: supplied } }, { session });
      customer.vip_card_number = supplied;
      return;
    }
    if (raw.contract_classification === 'Non-Standard')
      refuse(409, 'A non-standard VIP number requires reviewed historical evidence');
    const scheme = String(raw.stated_payment_scheme_code ?? ''),
      months =
        scheme === 'installment_4_month'
          ? 4
          : ['move_b1_40_12', 'move_b2_25_12'].includes(scheme)
            ? 12
            : 1;
    if (raw.payment_term_months && Number(raw.payment_term_months) !== months)
      refuse(409, 'The VIP payment term requires review');
    const number = await allocateMongoVipCardNumber(
      db,
      String(raw.vip_tier),
      ['spot_cash', 'move_a'].includes(scheme) ? 'CASH' : 'INSTALLMENT',
      months,
      session,
    );
    await col('customers').updateOne(
      { _id: customer._id },
      { $set: { vip_card_number: number } },
      { session },
    );
    customer.vip_card_number = number;
  }
  async function commit(
    req: VercelRequest,
    rowId: string,
    input: { expectedSourceHash: string; expectedTargetVersion: string },
    session: ClientSession,
    draft?: Draft,
  ) {
    const actor = await permitted(req, 'governance.customer_import', 'update');
    await permitted(req, 'sales.customers', 'view');
    const row = await imports.required('customer_import_rows', rowId, session);
    await reads.allowedRow(req, actor.userId, row, session);
    const data = reads.context(row),
      normalized = data.normalized,
      raw = data.fields;
    const historical = normalized.externalVerified === true;
    if (historical) {
      if (draft) refuse(409, 'Certified history uses its reviewed historical application');
      for (const [module, action] of [['sales.customers', 'create'], ['sales.card_sales', 'create'], ['finance.payment_verification', 'update']] as const)
        await permitted(req, module, action);
      if (['active', 'inactive'].includes(String(record(normalized.externalSummary).stage)))
        await permitted(req, 'finance.card_activation', 'update');
      await requireMongoHistoricalImportSetup(db);
      const review = await reads.preview(row, session);
      if (review.stage === 'review' || review.conflicts.length) refuse(409, 'Historical source requires reconciliation before confirmation');
    }
    if (
      !['company_v1', 'company_v2'].includes(raw.workbook_format ?? '') ||
      row.validation_status === 'error' ||
      normalized.customerStatus !== 'prospect' ||
      normalized.requireMember !== false ||
      normalized.payment != null
    )
      refuse(409, 'This import row requires reviewed prospect intake');
    const job = await imports.required('customer_import_jobs', String(row.import_job_id), session);
    if (
      !['ready', 'validated', 'committing', 'completed', 'completed_with_errors'].includes(
        String(job.status),
      )
    )
      refuse(409, 'The import job is not committable');
    if (data.sourceHash !== input.expectedSourceHash)
      refuse(409, 'The import source changed. Reload its review');
    const reference =
      raw.purchase_reference?.trim() ||
      String(draft?.data.header.importPurchaseReference ?? '').trim() ||
      `legacy-import-${rowId}`;
    if (
      draft &&
      !raw.purchase_reference?.trim() &&
      !String(draft.data.header.importPurchaseReference ?? '').trim()
    )
      refuse(409, 'Provide the reviewed purchase reference');
    let customer = await imports.customerFor(row, session);
    const candidates = (
      await col('customer_import_purchase_sources')
        .find({ issuer_scope: 'afhomes' }, { session })
        .toArray()
    ).filter(
      (s) =>
        s.normalized_reference === importNormalKey(reference) ||
        String(s.purchase_reference).toLowerCase() === reference.toLowerCase(),
    );
    if (candidates.length > 1) refuse(409, 'The imported purchase identity requires review');
    let source = candidates[0] ?? null;
    const linked = await imports.sourceForRow(row, session),
      draftData = draft ? { ...draft.data, header: { ...draft.data.header } } : null;
    if (draftData) delete draftData.header.importPurchaseReference;
    const hash = intent(row);
    if (
      source &&
      (source.customer_id !== customer?._id ||
        (source.intent_hash !== hash &&
          intent(
            await imports.required('customer_import_rows', String(source.original_row_id), session),
          ) !== hash))
    )
      refuse(409, 'The import source conflicts with its original purchase');
    const link = await col('customer_import_source_rows').findOne({ row_id: rowId }, { session });
    if (
      link &&
      source &&
      link.source_id === source._id &&
      link.source_hash === input.expectedSourceHash &&
      (!draft ||
        (source.application_id && source.application_input_hash === importRevision(draftData)))
    )
    {
      if (historical) await reconcileMongoHistoricalPurchase(db, row, source, actor.userId, input.expectedSourceHash, session);
      return reads.preview(row, session);
    }
    if ((await imports.targetForRow(row, linked, session)) !== input.expectedTargetVersion) {
      const baseline = record(normalized.continuationPreview),
        snapshot = customer ? importRevision(customer) : '';
      const siblings = customer
        ? await col('customer_import_purchase_sources')
            .find({ customer_id: customer._id }, { session })
            .toArray()
        : [];
      let sibling = false;
      for (const s of siblings) {
        const original = await imports.required(
          'customer_import_rows',
          String(s.original_row_id),
          session,
        );
        if (original.import_job_id !== row.import_job_id)
          refuse(409, 'The purchase changed. Reload its review');
        if (s.created_customer_snapshot && importRevision(s.created_customer_snapshot) === snapshot)
          sibling = true;
      }
      if (
        draft ||
        baseline.expectedTargetVersion !== input.expectedTargetVersion ||
        baseline.customerId !== null ||
        baseline.expectedTeamVersion !== importRevision(await imports.teamFor(raw, session)) ||
        !sibling
      )
        refuse(409, 'The purchase changed. Reload its review');
      for (const table of [
        'customer_applications',
        'reservation_agreements',
        'payments',
        'memberships',
      ])
        if (await col(table).findOne({ customer_id: customer!._id }, { session }))
          refuse(409, 'The purchase changed. Reload its review');
    }
    await team(raw, session);
    const facts = record(data.facts.person),
      company = record(data.facts.company);
    let created = false;
    if (!customer) {
      await permitted(req, 'sales.customers', 'create');
      created = true;
      const values: Record<string, unknown> = {};
      for (const key of personKeys) values[column(key)] = facts[key] ?? null;
      for (const key of companyKeys) values[column(key)] = company[key] ?? null;
      const now = new Date().toISOString();
      customer = {
        _id: randomUUID(),
        ...values,
        email: String(facts.email ?? '')
          .trim()
          .toLowerCase(),
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
        status: 'prospect',
        auth_user_id: null,
        referred_by_staff_id: null,
        registration_source: 'bulk_import',
        created_by: actor.userId,
        created_at: now,
        updated_at: now,
      };
      customer.ra_number = await companyId(db, customer.ra_number, session, true);
      await col('customers').insertOne(customer, { session });
    } else {
      const proposal = await reads.proposal(row, customer, data.facts, session);
      if (proposal.conflicts.length)
        refuse(409, 'Imported customer fields conflict with the current record');
      const patch = Object.fromEntries(proposal.fills.map((fill) => [fill.field, fill.value]));
      if (Object.keys(patch).length) {
        await col('customers').updateOne({ _id: customer._id }, { $set: patch }, { session });
        Object.assign(customer, patch);
      }
    }
    if (raw.referrer_staff_id) {
      if (customer.referred_by_staff_id && customer.referred_by_staff_id !== raw.referrer_staff_id)
        refuse(409, 'The registered customer referrer conflicts');
      if (!customer.referred_by_staff_id) {
        await col('customers').updateOne(
          { _id: customer._id },
          { $set: { referred_by_staff_id: raw.referrer_staff_id } },
          { session },
        );
        customer.referred_by_staff_id = raw.referrer_staff_id;
      }
    }
    if (!source) {
      const before = await reads.preview({ ...row, customer_id: customer._id }, session);
      source = {
        _id: randomUUID(),
        issuer_scope: 'afhomes',
        purchase_reference: reference,
        normalized_reference: importNormalKey(reference),
        customer_id: customer._id,
        original_row_id: rowId,
        intent_hash: hash,
        created_by: actor.userId,
        created_at: new Date().toISOString(),
        created_customer_snapshot: created ? customer : null,
        application_id: before.applicationId,
        application_input_hash: null,
      };
      await col('customer_import_purchase_sources').insertOne(source, { session });
    }
    if (link && link.source_id !== source._id) {
      const old = await imports.required(
        'customer_import_purchase_sources',
        String(link.source_id),
        session,
      );
      if (
        !draft ||
        raw.purchase_reference ||
        old.customer_id !== customer._id ||
        old.application_id ||
        old.purchase_reference !== `legacy-import-${rowId}` ||
        (await col('customer_import_payment_claims').findOne({ source_id: old._id }, { session }))
      )
        refuse(409, 'The provisional purchase source cannot be replaced');
      await col('customer_import_source_rows').updateOne(
        { _id: link._id },
        {
          $set: {
            source_id: source._id,
            source_hash: input.expectedSourceHash,
            linked_by: actor.userId,
            linked_at: new Date().toISOString(),
          },
        },
        { session },
      );
      await records.audit(
        actor.userId,
        'CUSTOMER_IMPORT_SOURCE_RECONCILED',
        'customer_import_row',
        rowId,
        null,
        { previousSourceId: old._id, sourceId: source._id },
        session,
      );
    } else if (!link)
      await col('customer_import_source_rows').insertOne(
        {
          _id: randomUUID(),
          row_id: rowId,
          source_id: source._id,
          source_hash: input.expectedSourceHash,
          linked_by: actor.userId,
          linked_at: new Date().toISOString(),
        },
        { session },
      );
    const claims = data.facts.paymentClaims ?? normalized.paymentClaims ?? [];
    if (!Array.isArray(claims)) refuse(409, 'Imported payment claims require review');
    for (const item of claims as unknown[]) {
      const parsed = workbookPaymentClaimSchema.safeParse(item);
      if (!parsed.success) refuse(409, 'Imported payment claims require review');
      if (!parsed.success) continue;
      const claim = parsed.data;
      if (compareMoney(claim.amount, '0.00') <= 0 || claim.date > manilaToday())
        refuse(409, 'Imported payment amount or date requires review');
      const amount = addMoney(claim.amount, '0.00'),
        fingerprint = importRevision([
          customer._id,
          importNormalKey(claim.reference),
          claim.method,
          claim.date,
          amount,
          'PHP',
        ]);
      let key = claim.paymentKey;
      if (key.startsWith('AUTO-')) {
        const aliases = await col('customer_import_payment_claims')
          .find(
            { source_id: source._id, fingerprint, claim_reference: { $regex: '^AUTO-' } },
            { session },
          )
          .toArray();
        if (aliases.length === 1) key = String(aliases[0]!.claim_reference);
      }
      if (
        !(await col('customer_import_payment_claims').findOne(
          { source_id: source._id, normalized_reference: importNormalKey(key) },
          { session },
        ))
      )
        await col('customer_import_payment_claims').insertOne(
          {
            _id: randomUUID(),
            source_id: source._id,
            claim_reference: key,
            normalized_reference: importNormalKey(key),
            purpose: claim.purpose,
            amount,
            payment_date: claim.date,
            method: claim.method,
            bank_reference: claim.reference ?? '',
            notes: claim.notes ?? '',
            fingerprint,
            status: 'claim',
            payment_id: null,
            proof_id: null,
            proof_uploaded_at: null,
            updated_at: new Date().toISOString(),
          },
          { session },
        );
    }
    if (draft) {
      await permitted(req, 'sales.customers', 'create');
      for (const [field, key] of Object.entries({
        vd_staff_id: 'svdStaffId',
        ssm_staff_id: 'ssmStaffId',
        sm_staff_id: 'smStaffId',
        referrer_staff_id: 'referrerStaffId',
      }))
        if (raw[field] && raw[field] !== draft.data.header[key])
          refuse(409, 'The imported sales team must be preserved');
      if (draft.data.header.customerId !== customer._id)
        refuse(409, 'The imported customer identity must be preserved');
      if (source.application_id && source.application_input_hash !== importRevision(draftData))
        refuse(409, 'An application is already linked to this purchase');
      if (!source.application_id) {
        const saved = await draft.create();
        for (const [field, key] of [
          ['statedTotalAmount', 'totalPrice'],
          ['statedRf', 'reservationFee'],
        ] as const)
          if (company[field] && compareMoney(String(company[field]), saved.terms[key]) !== 0)
            refuse(409, 'The imported amounts conflict with the current purchase terms');
        if (
          (company.statedVipPackage &&
            String(company.statedVipPackage).toUpperCase() !== saved.terms.tier) ||
          (raw.stated_payment_scheme_code &&
            raw.stated_payment_scheme_code !== saved.terms.paymentScheme)
        )
          refuse(409, 'The imported tier or payment terms require review');
        await col('customer_import_purchase_sources').updateOne(
          { _id: source._id },
          { $set: { application_id: saved.id, application_input_hash: importRevision(draftData) } },
          { session },
        );
      }
    }
    await col('customer_import_rows').updateOne(
      { _id: rowId },
      {
        $set: {
          customer_id: customer._id,
          committed_at: row.committed_at ?? new Date().toISOString(),
        },
      },
      { session },
    );
    await vip(row, customer, actor.userId, session);
    if (historical) await reconcileMongoHistoricalPurchase(db,
      { ...row, customer_id: customer._id, committed_at: row.committed_at ?? new Date().toISOString() },
      source, actor.userId, input.expectedSourceHash, session);
    if (Object.hasOwn(raw, 'existing_vip_control_number'))
      await col('customer_import_purchase_sources').updateOne(
        { _id: source._id },
        { $set: { purchase_reference: customer.vip_card_number } },
        { session },
      );
    await records.audit(
      actor.userId,
      'CUSTOMER_IMPORT_CONTINUED',
      'customer_import_row',
      rowId,
      null,
      {
        sourceId: source._id,
        customerId: customer._id,
        claimsCreated: (claims as unknown[]).length,
      },
      session,
    );
    return reads.preview({ ...row, customer_id: customer._id }, session);
  }
  return { commit };
}
