/**
 * Phase 15 audit-center redaction.
 *
 * `audit_events.before_data/after_data` were written by many phases for
 * debugging, so a metadata viewer must assume the payload can contain
 * anything: tokens, hashes, storage paths, OCR text. Everything rendered in
 * `/admin/audit` (and every export of it) passes through `sanitizeAuditValue`,
 * which redacts sensitive keys recursively, caps depth, breadth, array length
 * and string length, and breaks reference cycles.
 */

const SENSITIVE_KEY =
  /(token|secret|password|passwd|hash|qr_?token|fallback|government|gov_?id|otp|reset|private|storage_?path|receipt|ocr|raw_?text|auth_?user|service_?role|signing|api_?key|credential|code_hint)/i;

const MAX_DEPTH = 4;
const MAX_KEYS = 30;
const MAX_ITEMS = 20;
const MAX_STRING = 500;

export function sanitizeAuditValue(
  value: unknown,
  depth = 0,
  seen: Set<object> = new Set(),
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (value.length > MAX_STRING) return `${value.slice(0, MAX_STRING)}…[truncated]`;
    // A 40+-hex-char blob outside a known-safe key is almost certainly a hash
    // or token fragment; never render it in full.
    if (/^[0-9a-f]{40,}$/i.test(value)) return '[redacted]';
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'object') return '[redacted]';
  if (seen.has(value)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[depth-capped]';
  seen.add(value);
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ITEMS)
      .map((item) => sanitizeAuditValue(item, depth + 1, seen));
    if (value.length > MAX_ITEMS) items.push(`…[${value.length - MAX_ITEMS} more]`);
    seen.delete(value);
    return items;
  }
  const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_KEYS);
  const out: Record<string, unknown> = {};
  for (const [key, item] of entries) {
    out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : sanitizeAuditValue(item, depth + 1, seen);
  }
  if (Object.keys(value as Record<string, unknown>).length > MAX_KEYS) out['…'] = '[keys-capped]';
  seen.delete(value);
  return out;
}

/** One-line human summary for the audit table. Never includes payload data. */
export function auditSummary(action: string, entityType: string, entityId: string | null): string {
  void entityId; // Technical references remain available in explicit metadata.
  const humanize = (value: string) =>
    value
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .toLowerCase()
      .replace(/^./, (c) => c.toUpperCase());
  return `${humanize(action)} · ${humanize(entityType)}`;
}

export function maskEmail(email: unknown): string | null {
  if (typeof email !== 'string' || !email.includes('@')) return null;
  const [local, domain] = email.split('@');
  if (!local || !domain) return null;
  return `${local.slice(0, 1)}***@${domain}`;
}

export function maskPhone(phone: unknown): string | null {
  if (typeof phone !== 'string' || phone.length < 4) return null;
  return `***${phone.slice(-4)}`;
}
