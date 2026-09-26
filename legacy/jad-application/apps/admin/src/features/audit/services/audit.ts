import { auditLogEntrySchema, type AuditLogEntry } from '@jad/contracts';

import { requestList } from '../../../lib/api/client';

/** Audit trail - REST over api/v1 (Phase B4 cutover). */
export function getAudit(): Promise<AuditLogEntry[]> {
  return requestList('/admin/audit-log', auditLogEntrySchema);
}
