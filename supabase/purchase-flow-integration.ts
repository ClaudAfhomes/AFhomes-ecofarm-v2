import type { Client } from 'pg';

/** Read-only catalog checks for Gate 3. Not invoked until Gate 2 approval. */
export async function runPurchaseFlowCatalogChecks(db: Client): Promise<void> {
  const columns = await db.query<{ table_name: string; column_name: string; is_nullable: string }>(`
    select table_name,column_name,is_nullable from information_schema.columns
    where table_schema='public' and table_name in ('payments','reservation_agreements') and column_name='sale_id'
  `);
  if (columns.rows.length !== 2 || columns.rows.some((row) => row.is_nullable !== 'YES'))
    throw new Error('PURCHASE_CATALOG: both pre-sale links must be nullable');
  const constraints = await db.query<{
    conname: string;
    condeferrable: boolean;
    condeferred: boolean;
  }>(`
    select conname,condeferrable,condeferred from pg_constraint
    where conname in ('payments_reservation_sale_fk','reservation_purchase_identity_fk','application_purchase_terms_fk')
  `);
  if (constraints.rows.length !== 3)
    throw new Error('PURCHASE_CATALOG: exact source/terms foreign keys missing');
  const paymentFk = constraints.rows.find((row) => row.conname === 'payments_reservation_sale_fk');
  if (!paymentFk?.condeferrable || !paymentFk.condeferred)
    throw new Error('PURCHASE_CATALOG: finalized payment linking must be commit-deferred');
  const invalid = await db.query<{ violations: number }>(`
    select count(*)::integer as violations from public.payments p
    left join public.reservation_agreements r on r.id=p.reservation_id
    where (p.origin='sale' and (p.sale_id is null or p.reservation_id is not null))
      or (p.origin='reservation' and (r.id is null or p.sale_id is distinct from r.sale_id or p.customer_id is distinct from r.customer_id))
  `);
  if (invalid.rows[0]?.violations !== 0)
    throw new Error('PURCHASE_CATALOG: contradictory persisted payment sources');
  const exposed = await db.query<{ violations: number }>(`
    select count(*)::integer as violations from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname in (
      'append_purchase_document','build_purchase_document_fields','complete_purchase_mutation')
      and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE')
        or has_function_privilege('service_role',p.oid,'EXECUTE'))
  `);
  if (exposed.rows[0]?.violations !== 0)
    throw new Error('PURCHASE_CATALOG: private evidence mutation helpers exposed');
  const helpers = await db.query<{ count: number }>(`
    select count(*)::integer as count from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname in (
      'append_purchase_document','build_purchase_document_fields','complete_purchase_mutation')
  `);
  if (helpers.rows[0]?.count !== 3)
    throw new Error('PURCHASE_CATALOG: private evidence helpers missing or overloaded');
  const evidenceAcl = await db.query<{ violations: number }>(`
    select count(*)::integer as violations from (values ('anon'),('authenticated'),('service_role')) r(role_name)
    where has_table_privilege(r.role_name,'private.purchase_document_evidence','SELECT,INSERT,UPDATE,DELETE')
  `);
  if (evidenceAcl.rows[0]?.violations !== 0)
    throw new Error('PURCHASE_CATALOG: immutable evidence table exposed');
}
