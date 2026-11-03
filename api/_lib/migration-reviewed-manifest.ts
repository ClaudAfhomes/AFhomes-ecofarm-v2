import {
  reviewedAccessMigrationTables,
  reviewedOrganizationReferenceTables,
  reviewedStaffMigrationTable,
  reviewedNetworkProfileMigrationTable,
} from './migration-access-manifest.js';
import {
  reviewedCatalogMigrationTables,
  reviewedPointsTierMigrationTable,
} from './migration-catalog-manifest.js';
import { reviewedNetworkMigrationTables } from './migration-network-manifest.js';
import { reviewedCustomerMigrationTable } from './migration-customer-manifest.js';
import { reviewedMembershipPointsMigrationTables } from './migration-points-manifest.js';
import { reviewedFinanceMigrationTables } from './migration-finance-manifest.js';
import { reviewedFormsMigrationTables } from './migration-forms-manifest.js';
import { reviewedImportMigrationTables } from './migration-imports.js';
import { reviewedLegacyOstMigrationTables } from './migration-legacy-ost.js';
import { reviewedIdentityDocumentMigrationTable } from './migration-documents.js';
import { reviewedAuditMigrationTable } from './migration-audit.js';
import { reviewedRulesAndPolicyTables } from './migration-rules-policy.js';
import { reviewedEmptySourceGuards } from './migration-empty-source.js';
import { reviewedIdentifierAndDisabledHistoryTables } from './migration-identifiers.js';

export function reviewedBusinessMigrationTables() {
  return [
    ...reviewedOrganizationReferenceTables(),
    ...reviewedAccessMigrationTables(),
    reviewedStaffMigrationTable(),
    reviewedNetworkProfileMigrationTable(),
    ...reviewedCatalogMigrationTables(),
    reviewedPointsTierMigrationTable(),
    ...reviewedNetworkMigrationTables(),
    reviewedCustomerMigrationTable(),
    ...reviewedMembershipPointsMigrationTables(),
    ...reviewedFinanceMigrationTables(),
    ...reviewedFormsMigrationTables(),
    ...reviewedImportMigrationTables(),
    ...reviewedLegacyOstMigrationTables(),
    reviewedIdentityDocumentMigrationTable(),
    reviewedAuditMigrationTable(),
    ...reviewedRulesAndPolicyTables(),
    ...reviewedEmptySourceGuards(),
    ...reviewedIdentifierAndDisabledHistoryTables(),
  ];
}
