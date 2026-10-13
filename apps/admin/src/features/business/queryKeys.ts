/**
 * Central query-key factory for the business domain.
 *
 * Every `useQuery` key and every `invalidateQueries` prefix used by
 * `features/business` is built here, so a segment rename or a missed
 * invalidation is a single-file change instead of a hunt across pages.
 *
 * Keys are opaque arrays and invalidation matches by PREFIX, so each `Scope`
 * entry must stay a prefix of the keys it clears. The pinning spec
 * (`queryKeys.spec.ts`) locks the exact segments: change a segment and the
 * spec fails before any cache can go stale silently.
 */

export type BusinessQueryKey = readonly unknown[];

const key = (...parts: unknown[]): BusinessQueryKey => parts;

/** `['business', ...]` family: queues, sales, customers, catalog, commissions. */
const saleSummaryKey = (saleId: string) => key('business', 'sale-summary', saleId);
const reservationFinanceKey = (saleId: string) => key('business', 'reservation-finance', saleId);
const salePaymentsKey = (saleId: string) => key('business', 'sale-payments', saleId);
const reservationPaymentsKey = (reservationId: string) =>
  key('business', 'reservation-payments', reservationId);

export const businessKeys = {
  all: key('business'),
  queue: key('business', 'queue'),
  activationQueue: key('business', 'queue', 'activation'),
  financeQueue: (settled: string) => key('business', 'queue', 'finance', settled),
  saleSummary: saleSummaryKey,
  saleSummaryScope: key('business', 'sale-summary'),
  reservationFinance: reservationFinanceKey,
  salePayments: salePaymentsKey,
  salePaymentsScope: key('business', 'sale-payments'),
  reservationPayments: reservationPaymentsKey,
  /** Money summary for a dialog that serves both sales and reservations. */
  summaryFor: (origin: 'sale' | 'reservation', saleId: string) =>
    origin === 'reservation' ? reservationFinanceKey(saleId) : saleSummaryKey(saleId),
  /** Payment list for a dialog that serves both sales and reservations. */
  paymentsFor: (origin: 'sale' | 'reservation', saleId: string) =>
    origin === 'reservation' ? reservationPaymentsKey(saleId) : salePaymentsKey(saleId),
  sales: key('business', 'sales'),
  customers: (applied: unknown, filters: unknown, page: number) =>
    key('business', 'customers', applied, filters, page),
  customersScope: key('business', 'customers'),
  customer: (id: string | undefined) => key('business', 'customer', id),
  customerScope: key('business', 'customer'),
  customerSales: (id: string | undefined) => key('business', 'customer-sales', id),
  customerImportJobs: key('business', 'customer-import-jobs'),
  cardProducts: (search: string, visibility: unknown) =>
    key('business', 'card-products', search, visibility),
  cardProductsScope: key('business', 'card-products'),
  cardCategories: key('business', 'card-categories'),
  commissions: (applied: unknown) => key('business', 'commissions', applied),
  commissionsScope: key('business', 'commissions'),
  memberships: key('business', 'memberships'),
};

/** `['earning', ...]` family: operational service sales, claims, refunds. */
export const earningKeys = {
  all: key('earning'),
  services: key('earning', 'services'),
  rules: key('earning', 'rules'),
  tierDiscounts: key('earning', 'tier-discounts'),
  redemptionRules: key('earning', 'redemption-rules'),
  purchases: (page: number) => key('earning', 'purchases', page),
  purchasesScope: key('earning', 'purchases'),
  claims: (page: number) => key('earning', 'claims', page),
  purchase: (purchaseId: string) => key('earning', 'purchase', purchaseId),
  purchaseSummary: (purchaseId: string) => key('earning', 'purchase', purchaseId, 'summary'),
  purchaseReceipts: (purchaseId: string) => key('earning', 'purchase', purchaseId, 'receipts'),
  settlement: (purchaseId: string | null) => key('earning', 'settlement', purchaseId),
  settlementScope: key('earning', 'settlement'),
  financePurchases: key('earning', 'finance', 'purchases'),
  posPurchases: key('earning', 'pos', 'purchases'),
  ownPurchases: key('earning', 'own-purchases'),
  pointRefunds: (purchaseId: string) => key('earning', 'point-refunds', purchaseId),
  serviceRefunds: (purchaseId: string) => key('earning', 'service-refunds', purchaseId),
};

/** Customer-application family (transaction headers plus their lookups). */
export const applicationKeys = {
  list: (
    status: string,
    tier: string,
    search: string,
    from: string,
    to: string,
    workOnly: boolean,
    page: number,
  ) => key('customer-applications', status, tier, search, from, to, workOnly, page),
  scope: key('customer-applications'),
  reservationSource: key('customer-applications', 'reservation-source'),
  detail: (id: string | undefined) => key('customer-application', id),
  reservationSourceDetail: (customerApplicationId: string) =>
    key('customer-application', 'reservation-source', customerApplicationId),
  reservations: (applicationId: string) => key('customer-application-reservations', applicationId),
  reservationsScope: key('customer-application-reservations'),
  picker: key('customer-picker'),
  sellerOptions: key('customer-seller-options'),
};

/** Reservation-agreement family (IST contracts plus their money views). */
export const reservationKeys = {
  list: (status: string, tier: string, search: string, workOnly: boolean, page: number) =>
    key('reservation-agreements', status, tier, search, workOnly, page),
  scope: key('reservation-agreements'),
  detail: (id: string | undefined) => key('reservation-agreement', id),
  finance: (id: string | undefined) => key('reservation-finance', id),
  payments: (id: string | undefined) => key('reservation-payments', id),
  purchaseTermsProposal: (id: string | undefined) => key('purchase-terms-proposal', id),
  purchaseTermsReservationSource: (customerApplicationId: string) =>
    key('purchase-terms-proposal', 'reservation-source', customerApplicationId),
};

/** `['memberships', ...]` family: issued cards, points, and desk lookups. */
export const membershipKeys = {
  scope: key('memberships'),
  list: (status: string) => key('memberships', status),
  record: (id: string | undefined) => key('memberships', id),
  card: (id: string | undefined) => key('memberships', id, 'card'),
  history: (id: string | undefined) => key('memberships', id, 'history'),
  points: (id: string | undefined) => key('memberships', id, 'points'),
  ledger: (id: string | undefined, accountId: string | undefined) =>
    key('memberships', id, 'ledger', accountId),
  customerLookup: (term: string) => key('customer-lookup', term),
  memberLookup: (term: string) => key('member-lookup', term),
};

/** `['documents', ...]` family: identity intake, review, and signed previews. */
export const documentKeys = {
  scope: key('documents'),
  list: (subjectType: string, subjectId: string) => key('documents', subjectType, subjectId),
  detail: (id: string | undefined) => key('documents', id),
  accessUrl: (id: string | undefined, uploadedAt: unknown) =>
    key('documents', id, 'access-url', uploadedAt),
};

/** `['genealogy', ...]` family: the authorized seller tree and its panels. */
export const genealogyKeys = {
  tree: key('genealogy'),
  node: (staffId: string | undefined) => key('genealogy', staffId),
  upline: (staffId: string | undefined) => key('genealogy', staffId, 'upline'),
  summary: (staffId: string | undefined) => key('genealogy', staffId, 'summary'),
};

/** Roots shared with other domains; business pages only read or clear them. */
export const sharedScopes = {
  sales: key('sales'),
  cardProducts: key('card-products'),
  memberships: key('memberships'),
  memberLookup: key('member-lookup'),
  reports: key('reports'),
  analytics: key('analytics'),
  commissionRules: key('commission-rules'),
  commissionRuleHistory: (historyId: string | null) => key('commission-rule-history', historyId),
  documentsCustomer: (customerId: string) => key('documents', 'customer', customerId),
  documentsCurrentCustomer: (customerId: string) =>
    key('documents', 'current', 'customer', customerId),
  saleSummary: (saleId: string) => key('sale-summary', saleId),
};
