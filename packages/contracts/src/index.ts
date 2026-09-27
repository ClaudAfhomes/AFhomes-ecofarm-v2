/**
 * AF Homes Ecofarm shared contracts - the single source of truth for every
 * request/response shape exchanged over the REST API and validated at the
 * browser boundary.
 *
 * Phase 1 surface only. The JAD Realty schemas (members, sales, vouchers,
 * withdrawals, commissions, CMS, registration) were removed with the JAD
 * handlers; new domains are added here as their Phase 2+ handlers land, so
 * client and server can never drift on a DTO.
 */
export {
  afHomesActionSchema,
  afHomesModuleKeySchema,
  afHomesPermissionSchema,
  afHomesRestrictionSchema,
  afHomesRoleSchema,
  afHomesDepartmentSchema,
  afHomesStaffSchema,
  afHomesSessionSchema,
  afHomesDashboardPointSchema,
  afHomesDashboardSchema,
  createAfHomesRoleSchema,
  inviteAfHomesStaffSchema,
} from './schemas/afhomes.js';
export type {
  AfHomesAction,
  AfHomesModuleKey,
  AfHomesPermission,
  AfHomesRole,
  AfHomesDepartment,
  AfHomesStaff,
  AfHomesSession,
  AfHomesDashboard,
} from './schemas/afhomes.js';

export { errorEnvelopeSchema, apiErrorCodeSchema } from './schemas/error.js';
export type { ErrorEnvelope, ApiErrorCode } from './schemas/error.js';

export {
  exactDecimalStringSchema,
  exactDecimalRateSchema,
  EXACT_DECIMAL_STRING_RE,
  EXACT_DECIMAL_RATE_RE,
} from './schemas/money.js';

export { listResponseSchema } from './schemas/collection.js';
export type { ListResponse } from './schemas/collection.js';

/* ---- Staff redemption of customer points (Phase 4) ----
   The client sends no price, balance, status or staff identity: those fields do
   not exist in the request schema, so a tampered body cannot change what a
   redemption costs. Points are whole units, not money. */
export {
  pointsAmountSchema,
  redemptionItemSchema,
  createRedemptionItemRequestSchema,
  updateRedemptionItemRequestSchema,
  redemptionPreviewSchema,
  createRedemptionRequestSchema,
  redemptionReceiptSchema,
  redemptionStatusSchema,
  redemptionSchema,
  redemptionListSchema,
  customerRedemptionSchema,
  customerRedemptionListSchema,
} from './schemas/redemption.js';
export type {
  RedemptionItem,
  CreateRedemptionItemRequest,
  UpdateRedemptionItemRequest,
  RedemptionPreview,
  CreateRedemptionRequest,
  RedemptionReceipt,
  RedemptionStatus,
  Redemption,
  CustomerRedemption,
} from './schemas/redemption.js';

/* ---- Phase 2: default role permission baseline (explicit grants) ----
   `super_admin` (implicit full access) and `customer` (ownership-based, zero
   admin modules) intentionally have no rows here. */
export {
  BASELINE_EXCLUDED_MODULES,
  BASELINE_ROLES,
  BASELINE_ROW_COUNT,
  DEFAULT_ROLE_BASELINE,
} from './schemas/role-baseline.js';
export type { BaselineGrant, BaselineRole } from './schemas/role-baseline.js';

/* ---- Phase 2: lifecycle states (single source for every status string) ---- */
export {
  customerStatusSchema,
  saleStatusSchema,
  paymentStatusSchema,
  paymentTypeSchema,
  membershipStatusSchema,
  commissionStatusSchema,
  pointsEntryTypeSchema,
  hierarchyRoleSchema,
  spotCashStateSchema,
  HIERARCHY_ORDER,
  SALE_ACCEPTS_PAYMENT,
  SALE_AWAITING_FULL_PAYMENT,
  SALE_ACTIVATABLE,
  canTransitionCustomer,
  canTransitionSale,
  canTransitionPayment,
  canTransitionMembership,
  canTransitionCommission,
  hierarchyAllowsUpline,
} from './schemas/lifecycle.js';
export type {
  CustomerStatus,
  SaleStatus,
  PaymentStatus,
  PaymentType,
  MembershipStatus,
  CommissionStatus,
  PointsEntryType,
  HierarchyRole,
  SpotCashState,
} from './schemas/lifecycle.js';

export {
  cardProductSchema,
  updateCardProductSchema,
  governmentIdTypeSchema,
  genderSchema,
  customerAddressSchema,
  createCustomerSchema,
  updateCustomerSchema,
  customerSchema,
  maskGovernmentId,
  assertProductEconomicsSane,
  createSaleSchema,
  saleSchema,
  saleFinancialSummarySchema,
  referralRelationshipSchema,
  createReferralSchema,
  correctReferralSchema,
} from './schemas/sales.js';
export type {
  CardProduct,
  UpdateCardProductRequest,
  GovernmentIdType,
  CustomerAddress,
  CreateCustomerRequest,
  UpdateCustomerRequest,
  Customer,
  CreateSaleRequest,
  Sale,
  SaleFinancialSummary,
  ReferralRelationship,
  CreateReferralRequest,
  CorrectReferralRequest,
} from './schemas/sales.js';

export {
  paymentSchema,
  recordPaymentSchema,
  verifyPaymentSchema,
  activateSaleSchema,
  activationResultSchema,
  membershipSchema,
  membershipResolutionSchema,
  pointsAccountSchema,
  pointsLedgerEntrySchema,
  commissionSchema,
  qualifyCommissionSchema,
  issueOnboardingTokenSchema,
  onboardingTokenSchema,
  financeQueueItemSchema,
} from './schemas/finance.js';
export type {
  Payment,
  RecordPaymentRequest,
  VerifyPaymentRequest,
  ActivateSaleRequest,
  ActivationResult,
  Membership,
  MembershipResolution,
  PointsAccount,
  PointsLedgerEntry,
  Commission,
  QualifyCommissionRequest,
  IssueOnboardingTokenRequest,
  OnboardingToken,
  FinanceQueueItem,
} from './schemas/finance.js';

/* ---- Customer portal (Phase 3) ----
   Ownership-based, not permission-based: nothing here derives from the staff
   module model. */
export {
  customerActivationRequestSchema,
  customerActivationResultSchema,
  customerProfileSchema,
  customerMembershipSchema,
  customerPointsSummarySchema,
  customerPointsEntrySchema,
  customerPointsLedgerSchema,
  customerCredentialsSchema,
  CUSTOMER_ACTIVATION_ERRORS,
} from './schemas/customer.js';
export type {
  CustomerActivationRequest,
  CustomerActivationResult,
  CustomerProfile,
  CustomerMembership,
  CustomerPointsSummary,
  CustomerPointsEntry,
  CustomerCredentials,
  CustomerActivationError,
} from './schemas/customer.js';
