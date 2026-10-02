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
  staffTestPurgeResponseSchema,
  staffAccountSetupSchema,
  afHomesDashboardPointSchema,
  afHomesDashboardSchema,
  createAfHomesRoleSchema,
  inviteAfHomesStaffSchema,
  createAfHomesStaffSchema,
  updateAfHomesStaffProfileSchema,
  changeAfHomesStaffPasswordSchema,
} from './schemas/afhomes.js';
export type {
  AfHomesAction,
  AfHomesModuleKey,
  AfHomesPermission,
  AfHomesRole,
  AfHomesDepartment,
  AfHomesStaff,
  AfHomesSession,
  StaffTestPurgeResponse,
  StaffAccountSetup,
  AfHomesDashboard,
} from './schemas/afhomes.js';

export { errorEnvelopeSchema, apiErrorCodeSchema } from './schemas/error.js';
export type { ErrorEnvelope, ApiErrorCode } from './schemas/error.js';

/* ---- Cross-portal identity (portal routing + OST self-service) ----
   `GET /auth/portals` answers which AF Homes identities the bearer's own
   Auth user holds. Login screens route on it; it authorizes nothing. */
export { authPortalsSchema, ostMeSchema } from './schemas/auth.js';
export type { AuthPortals, OstMe } from './schemas/auth.js';

export {
  ADMIN_PORTAL_ROLES,
  STAFF_PORTAL_ROLES,
  isAdminPortalRole,
  isStaffPortalRole,
  staffPortalRoleSchema,
  portalDestinationSchema,
  resolvePortalDestination,
} from './schemas/portal-routing.js';
export type { PortalDestination, PortalIdentity } from './schemas/portal-routing.js';

export {
  exactDecimalStringSchema,
  exactDecimalRateSchema,
  EXACT_DECIMAL_STRING_RE,
  EXACT_DECIMAL_RATE_RE,
} from './schemas/money.js';

export {
  PERSON_NAME_RE,
  personNameSchema,
  optionalPersonNameSchema,
  nullablePersonNameSchema,
  optionalPhoneSchema,
  phoneSchema,
  optionalContactNumberSchema,
  emailSchema,
  dateOfBirthSchema,
  birthDateSchema,
  uppercaseAddressSchema,
  uppercasedText,
  normalizePersonName,
  normalizeAddressField,
  normalizePostalCode,
  normalizePhilippinePhone,
  normalizeEmail,
  normalizeMoneyString,
  isPlausibleBirthDate,
} from './schemas/input.js';

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
  MIGRATION_SEEDED_GRANTS,
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
  customerApplicationStatusSchema,
  reservationAgreementStatusSchema,
  pointsEntryTypeSchema,
  hierarchyRoleSchema,
  spotCashStateSchema,
  paymentSchemeSchema,
  PAYMENT_SCHEMES,
  PAYMENT_SCHEME_LABELS,
  paymentSchemeLabel,
  validateSchemeTransition,
  HIERARCHY_ORDER,
  SALE_ACCEPTS_PAYMENT,
  SALE_AWAITING_FULL_PAYMENT,
  SALE_ACTIVATABLE,
  canTransitionCustomer,
  canTransitionSale,
  canTransitionPayment,
  canTransitionMembership,
  canTransitionCommission,
  canTransitionCustomerApplication,
  canTransitionReservationAgreement,
  hierarchyAllowsUpline,
} from './schemas/lifecycle.js';
export type {
  CustomerStatus,
  SaleStatus,
  PaymentStatus,
  PaymentType,
  MembershipStatus,
  CommissionStatus,
  CustomerApplicationStatus,
  ReservationAgreementStatus,
  PointsEntryType,
  HierarchyRole,
  SpotCashState,
  PaymentScheme,
  SchemeTransitionRejection,
} from './schemas/lifecycle.js';

export {
  cardProductSchema,
  cardCategorySchema,
  createCardProductSchema,
  createCardCategorySchema,
  updateCardProductSchema,
  updateCardCategorySchema,
  governmentIdTypeSchema,
  genderSchema,
  customerAddressSchema,
  createCustomerSchema,
  updateCustomerSchema,
  customerSchema,
  maskGovernmentId,
  assertProductEconomicsSane,
  assertCardPlanEconomicsSane,
  assertCommissionRateInRange,
  normalizePlanCode,
  normalizeCategorySlug,
  createSaleSchema,
  saleSchema,
  saleFinancialSummarySchema,
  referralRelationshipSchema,
  createReferralSchema,
  correctReferralSchema,
} from './schemas/sales.js';
export type {
  CardProduct,
  CardCategory,
  CreateCardProductRequest,
  CreateCardCategoryRequest,
  UpdateCardProductRequest,
  UpdateCardCategoryRequest,
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
  onboardingDeliverySchema,
  activationResultSchema,
  membershipSchema,
  membershipResolutionSchema,
  pointsAccountSchema,
  pointsLedgerEntrySchema,
  commissionSchema,
  commissionRuleTargetSchema,
  commissionRuleSchema,
  createCommissionRuleSchema,
  updateCommissionRuleSchema,
  qualifyCommissionSchema,
  markCommissionPaidSchema,
  issueOnboardingTokenSchema,
  onboardingTokenSchema,
  customerOnboardingRecoverySchema,
  financeQueueItemSchema,
} from './schemas/finance.js';
export type {
  Payment,
  RecordPaymentRequest,
  VerifyPaymentRequest,
  ActivateSaleRequest,
  OnboardingDelivery,
  ActivationResult,
  Membership,
  MembershipResolution,
  PointsAccount,
  PointsLedgerEntry,
  Commission,
  CommissionRule,
  CreateCommissionRuleRequest,
  UpdateCommissionRuleRequest,
  QualifyCommissionRequest,
  MarkCommissionPaidRequest,
  IssueOnboardingTokenRequest,
  OnboardingToken,
  CustomerOnboardingRecovery,
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
  customerPaymentSchema,
  customerPaymentListSchema,
  customerCredentialsSchema,
  CUSTOMER_ACTIVATION_ERRORS,
} from './schemas/customer.js';

/* ---- Bulk customer import/export (main-system feature) ----
   Header/detail job model, tier + status mapping, and the shared display-
   category resolver. Display categories are never persisted. */
export {
  CUSTOMER_IMPORT_COLUMNS,
  CUSTOMER_EXPORT_COLUMNS,
  CUSTOMER_IMPORT_ROW_LIMIT,
  importSourceSchema,
  importJobStatusSchema,
  importRowActionSchema,
  importValidationSchema,
  normalizeTier,
  customerCategorySchema,
  CUSTOMER_CATEGORY_LABELS,
  mapSourceStatus,
  customerStatusForCategory,
  categoryRequiresMember,
  compareMoney,
  resolveCustomerCategory,
  parseGoogleSheetUrl,
  googleSheetCsvUrl,
  customerImportJobSchema,
  customerImportRowSchema,
  customerImportParseResponseSchema,
  customerImportCommitResponseSchema,
} from './schemas/customer-import.js';
export type {
  CustomerImportColumn,
  CustomerExportRow,
  ImportSource,
  ImportJobStatus,
  ImportRowAction,
  ImportValidation,
  VipTier,
  CustomerCategory,
  CustomerImportJob,
  CustomerImportRow,
  CustomerImportParseResponse,
  CustomerImportCommitResponse,
} from './schemas/customer-import.js';
/* ---- Official paper-form transaction snapshots and review-first imports. ---- */
export {
  vipTierSchema,
  holderTypeSchema,
  signatureStatusSchema,
  acquisitionChannelSchema,
  applicationHolderSchema,
  reservationHolderSchema,
  createCustomerApplicationSchema,
  customerApplicationSchema,
  customerApplicationDecisionSchema,
  createReservationAgreementSchema,
  reservationAgreementSchema,
  reservationAgreementDecisionSchema,
  formImportPreviewSchema,
  officialFormListQuerySchema,
} from './schemas/official-forms.js';
export type {
  ApplicationHolder,
  CreateCustomerApplicationRequest,
  CustomerApplication,
  CustomerApplicationDecision,
  CreateReservationAgreementRequest,
  ReservationAgreement,
  ReservationAgreementDecision,
  FormImportPreview,
} from './schemas/official-forms.js';

/* ---- PHASE 7: authorized sales genealogy ---- */
export {
  genealogyStatusSchema,
  genealogyNodeSchema,
  genealogySummarySchema,
} from './schemas/genealogy.js';
export type { GenealogyNode, GenealogySummary } from './schemas/genealogy.js';
export {
  analyticsOverviewSchema,
  analyticsPeriodSchema,
  analyticsScopeSchema,
  analyticsTrendPointSchema,
  salesTrendGranularitySchema,
  salesTrendPeriodSchema,
  salesTrendReportSchema,
} from './schemas/analytics.js';
export type {
  AnalyticsOverview,
  AnalyticsPeriod,
  SalesTrendGranularity,
  SalesTrendPeriod,
  SalesTrendReport,
} from './schemas/analytics.js';

/* ---- Phase 2B: operational dashboard queue cards (JAD QueueCard parity) ----
   Three server-side counts (null when unauthorized); no withdrawals until the
   payout workflow exists. */
export { dashboardQueuesSchema } from './schemas/queues.js';
export type { DashboardQueues } from './schemas/queues.js';

/* ---- Phase 15: role-scoped reports and the audit center ----
   Exports are generated from the same scoped server-side query as the
   on-screen table and returned as base64-in-JSON, so the browser never
   computes a row. */
export {
  reportTypeSchema,
  reportFormatSchema,
  reportQuerySchema,
  reportScopeSchema,
  reportRowSchema,
  reportResponseSchema,
  reportExportSchema,
  auditQuerySchema,
  auditEventSchema,
  auditResponseSchema,
  REPORT_EXPORT_CAP,
  REPORT_PAGE_MAX,
} from './schemas/reports.js';
export type {
  ReportType,
  ReportFormat,
  ReportQuery,
  ReportScope,
  ReportRow,
  ReportResponse,
  ReportExport,
  AuditQuery,
  AuditEvent,
  AuditResponse,
} from './schemas/reports.js';

/* ---- Phase 8: OST registration and approval (SM -> OST) ----
   The public request carries a referral CODE, never a sponsor id: the
   sponsor is resolved and frozen server-side, so there is no field to
   spoof. `submitted` is the pending state; no new lifecycle vocabulary. */
export {
  ostApplicationStatusSchema,
  OST_REVIEWABLE_STATUSES,
  OST_TERMINAL_STATUSES,
  canTransitionOstApplication,
  ostMemberStatusSchema,
  ostReferralCodeSchema,
  normalizeOstReferralCode,
  buildOstRegistrationUrl,
  ostReferralResolutionSchema,
  submitOstApplicationSchema,
  ostApplicationSubmittedSchema,
  ostApplicationSchema,
  rejectOstApplicationSchema,
  requestOstApplicationChangesSchema,
  ostMemberSchema,
  createOstReferralCodeSchema,
  ostReferralCodeIssuedSchema,
  ostReferralCodeRecordSchema,
} from './schemas/ost.js';
export type {
  OstApplicationStatus,
  OstMemberStatus,
  OstReferralCode,
  OstReferralResolution,
  SubmitOstApplicationRequest,
  OstApplicationSubmitted,
  OstApplication,
  RejectOstApplicationRequest,
  RequestOstApplicationChangesRequest,
  OstMember,
  CreateOstReferralCodeRequest,
  OstReferralCodeIssued,
  OstReferralCodeRecord,
} from './schemas/ost.js';

/* ---- Phase 10: membership card management ----
   Hash-only credentials can be rotated but never recovered, so the card view
   carries everything printable EXCEPT the codes, and rotation returns the
   plaintext pair exactly once. Printing records a print; it never rotates. */
export {
  membershipCardSchema,
  reissueMembershipCardSchema,
  reissuedMembershipCardSchema,
  markedPrintedSchema,
} from './schemas/card.js';
export type {
  MembershipCard,
  ReissueMembershipCardRequest,
  ReissuedMembershipCard,
  MarkedPrinted,
} from './schemas/card.js';

/* ---- Phase 12: identity documents and OCR-assisted extraction ----
   OCR output is suggestion data, never authoritative. Confirmed values are
   human decisions; nothing here finalizes identity on its own. */
export {
  ocrStatusSchema,
  documentVerificationStatusSchema,
  documentSubjectSchema,
  documentMimeSchema,
  ocrFieldSchema,
  identityDocumentSchema,
  documentUploadRequestSchema,
  documentUploadGrantSchema,
  documentConfirmSchema,
  documentAccessUrlSchema,
} from './schemas/document.js';
export type {
  OcrStatus,
  DocumentVerificationStatus,
  DocumentSubject,
  DocumentMime,
  OcrField,
  IdentityDocument,
  DocumentUploadRequest,
  DocumentUploadGrant,
  DocumentConfirmRequest,
  DocumentAccessUrl,
} from './schemas/document.js';

/* ---- Phase 6: staff-managed public website CMS ---- */
export {
  cmsDocumentKeySchema,
  cmsPublishStateSchema,
  cmsJsonObjectSchema,
  cmsDocumentSchema,
  updateCmsDocumentSchema,
  cmsBlockTypeSchema,
  cmsSectionSchema,
  cmsSeoSchema,
  cmsPageSchema,
  createCmsPageSchema,
  updateCmsPageSchema,
  cmsHistorySchema,
  cmsMediaSchema,
  createCmsMediaSchema,
  cmsPublicContentSchema,
} from './schemas/cms.js';
export type {
  CmsDocumentKey,
  CmsDocument,
  CmsPage,
  CmsSection,
  CmsHistory,
  CmsMedia,
  CmsPublicContent,
} from './schemas/cms.js';
export type {
  CustomerActivationRequest,
  CustomerActivationResult,
  CustomerProfile,
  CustomerMembership,
  CustomerPointsSummary,
  CustomerPointsEntry,
  CustomerPayment,
  CustomerCredentials,
  CustomerActivationError,
} from './schemas/customer.js';

export { memberLookupSchema, type MemberLookup } from './schemas/customer-import.js';

export { customerSellerOptionSchema } from './schemas/customer-import.js';
