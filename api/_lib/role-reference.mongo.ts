import {
  DEFAULT_ROLE_BASELINE,
  type AfHomesModuleKey,
  type BaselineGrant,
  type BaselineRole,
} from '@afhomes/contracts';

const v = (moduleKey: AfHomesModuleKey): BaselineGrant => ({
  moduleKey,
  canView: true,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
});
const vc = (key: AfHomesModuleKey): BaselineGrant => ({ ...v(key), canCreate: true });
const vu = (key: AfHomesModuleKey): BaselineGrant => ({ ...v(key), canUpdate: true });
const vcu = (key: AfHomesModuleKey): BaselineGrant => ({
  ...v(key),
  canCreate: true,
  canUpdate: true,
});
export const CUSTOMER_LOOKUP_GRANT = v('operations.customer_lookup');

// Exact later-source grants; feature flags independently keep Services/Reports/CMS off.
export const LATER_MONGO_ROLE_GRANTS: Partial<Record<BaselineRole, readonly BaselineGrant[]>> = {
  admin: [
    vcu('governance.customer_import'),
    vc('operations.sales'),
    vu('operations.payments'),
    CUSTOMER_LOOKUP_GRANT,
    vcu('network.members'),
  ],
  employee: [vc('operations.sales'), CUSTOMER_LOOKUP_GRANT],
  finance: [v('operations.sales'), vu('operations.payments')],
  vice_director: [v('network.members')],
  senior_sales_manager: [v('network.members'), v('network.ost_registrations')],
  sales_manager: [v('network.members')],
  ost: [v('network.members')],
};
export const MONGO_ROLE_GRANT_SOURCES: Partial<Record<AfHomesModuleKey, string>> = {
  'governance.customer_import': '20261019000002_afhomes_customer_import_jobs.sql',
  'operations.sales': '20261105000001_afhomes_service_tier_discounts.sql',
  'operations.payments': '20261106000001_afhomes_operational_service_payments.sql',
  'operations.customer_lookup': '20261131000003_afhomes_customer_lookup_module.sql',
  'network.members': '20261205000001_afhomes_network_members.sql',
  'network.ost_registrations': '20261208000004_afhomes_ost_ist_conversion.sql',
};
export function mongoRoleReferenceGrants(slug: string): readonly BaselineGrant[] {
  return [
    ...(DEFAULT_ROLE_BASELINE[slug as BaselineRole] ?? []),
    ...(LATER_MONGO_ROLE_GRANTS[slug as BaselineRole] ?? []),
  ];
}
