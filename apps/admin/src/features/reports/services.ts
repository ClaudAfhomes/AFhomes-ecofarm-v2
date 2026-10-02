/**
 * Phase 15 report API client. Every call goes through `lib/api/client` and is
 * validated against `@jad/contracts`. Exports arrive as base64-in-JSON
 * envelopes; this module turns them back into downloads. The browser never
 * computes a report row - it only renders what the scoped server query
 * returned.
 */
import {
  auditResponseSchema,
  reportExportSchema,
  reportResponseSchema,
  type AuditResponse,
  type ReportExport,
  type ReportResponse,
} from '@jad/contracts';
import { protectedRequest as request } from '../../lib/api/client';
import { formatDateTime } from '../../lib/format';
import { formatMoney, formatPoints } from '../business/format';

export type ReportFilters = {
  from?: string;
  to?: string;
  status?: string;
  planId?: string;
  seller?: string;
  role?: string;
  itemId?: string;
  kind?: string;
  search?: string;
  transactionType?: string;
  limit?: number;
  offset?: number;
};

export type AuditFilters = {
  actor?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

function queryString(filters: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const suffix = params.toString();
  return suffix ? `?${suffix}` : '';
}

export const getReport = (type: string, filters: ReportFilters = {}): Promise<ReportResponse> =>
  request(`/reports/${type}${queryString(filters)}`, reportResponseSchema);

export const getAudit = (filters: AuditFilters = {}): Promise<AuditResponse> =>
  request(`/reports/audit${queryString(filters)}`, auditResponseSchema);

export const exportReport = (
  type: string,
  filters: ReportFilters,
  format: 'csv' | 'xlsx' | 'pdf',
): Promise<ReportExport> =>
  request(`/reports/${type}${queryString({ ...filters, format })}`, reportExportSchema);

export const exportAudit = (
  filters: AuditFilters,
  format: 'csv' | 'xlsx' | 'pdf',
): Promise<ReportExport> =>
  request(`/reports/audit${queryString({ ...filters, format })}`, reportExportSchema);

/** Render a raw report cell: dates, money strings, and points read naturally. */
export function formatCell(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    if (/points|spent|balance|count|qty|descendants|downline|sales|entries/i.test(key)) {
      return formatPoints(value);
    }
    return String(value);
  }
  if (typeof value !== 'string') return JSON.stringify(value);
  if (
    /^(0|[1-9][0-9]*)\.\d{2}$/.test(value) &&
    /price|paid|remaining|value|amount|total|fee|down|monthly/i.test(key)
  ) {
    return formatMoney(value);
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return formatDateTime(value);
  return value;
}

/** Envelope bytes as a Blob - pure apart from `atob`, so it is unit-testable. */
export function exportToBlob(envelope: Pick<ReportExport, 'mime' | 'content'>): Blob {
  const binary = atob(envelope.content);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: envelope.mime });
}

/** Trigger a file download for a validated export envelope. */
export function downloadExport(
  envelope: Pick<ReportExport, 'mime' | 'content' | 'filename'>,
): void {
  const blob = exportToBlob(envelope);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = envelope.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
