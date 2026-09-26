import type { StatusTone } from '@jad/ui';

/**
 * Policy type display map. `type` is a free string server-side (no SSOT
 * vocabulary), so known types get a friendly label and unknown ones render
 * verbatim with the fallback tone.
 */
export const POLICY_TYPE_LABEL: Record<string, string> = {
  terms: 'Terms',
  privacy: 'Privacy',
  guidelines: 'Guidelines',
};

export const POLICY_TYPE_TONE: Record<string, StatusTone> = {
  terms: 'info',
  privacy: 'success',
  guidelines: 'warning',
};

export function policyTypeLabel(type: string): string {
  return POLICY_TYPE_LABEL[type] ?? type;
}

export function policyTypeTone(type: string): StatusTone {
  return POLICY_TYPE_TONE[type] ?? 'neutral';
}
