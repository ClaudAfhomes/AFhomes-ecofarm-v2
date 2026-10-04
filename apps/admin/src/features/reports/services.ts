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
  if (Array.isArray(value)) return value.map((item) => formatCell(key, item)).join(' · ');
  if (typeof value === 'object')
    return Object.entries(value)
      .map(([label, item]) => `${humanizeReportLabel(label)}: ${formatCell(label, item)}`)
      .join(' · ');
  if (typeof value !== 'string') return String(value);
  if (
    /^(0|[1-9][0-9]*)\.\d{2}$/.test(value) &&
    /price|paid|remaining|value|amount|total|fee|down|monthly/i.test(key)
  ) {
    return formatMoney(value);
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return formatDateTime(value);
  return value;
}

export function humanizeReportLabel(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
}

export { envelopeBlob as exportToBlob, downloadFile as downloadExport } from '../../lib/download';
