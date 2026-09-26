import type { Policy } from '@jad/contracts';

/**
 * Policies static fallback (Q6). When the public `GET /policies` endpoint is
 * unreachable, the public Policies pages render these contract-valid rows so
 * visitors - and the registration consent links - always resolve to the real
 * documents. Mirrors `POLICY_SEEDS` (supabase/seed.ts); never invented copy.
 *
 * Each policy additionally carries its uploaded PDF (`documentUrl`), which the
 * detail page prefers over the plain-text summary.
 */

export const POLICIES_PATH = '/policies';

/** `/policies/{slug}` - slugs (not ids) are the stable public URL key. */
export function policyPath(slugOrId: string): string {
  return `${POLICIES_PATH}/${slugOrId}`;
}

/** Canonical policy slugs used by deep links (footer, consent, login note). */
export const TERMS_POLICY_SLUG = 'terms';
export const GUIDELINES_POLICY_SLUG = 'guidelines';
export const PRIVACY_POLICY_SLUG = 'privacy';

export const POLICY_FALLBACK: Policy[] = [
  {
    id: 'pol-001',
    slug: 'terms',
    title: 'Terms and Conditions',
    type: 'terms',
    content:
      'By registering for JA&D membership you agree to abide by the JA&D terms and conditions as published on the official website. Membership has no purchase requirement.',
    updatedAt: '2026-08-18T10:00:00.000Z',
  },
  {
    id: 'pol-002',
    slug: 'guidelines',
    title: 'Program Guidelines',
    type: 'guidelines',
    content:
      'These guidelines describe how qualifying sales and referrals work within the JA&D membership program.',
    updatedAt: '2026-08-18T10:00:00.000Z',
  },
  {
    id: 'pol-003',
    slug: 'privacy',
    title: 'Privacy Policy',
    type: 'privacy',
    content:
      'JA&D collects only the personal information needed to operate the membership platform. Personal data is never sold. Full details are published on the official website.',
    updatedAt: '2026-08-18T10:00:00.000Z',
  },
];

/**
 * Resolve a route param to a policy: slugs first (canonical), legacy ids and
 * `type` (e.g. /policies/terms finding a row typed `terms`) accepted so old
 * or mis-typed links keep working and canonical deep links survive slug edits.
 */
export function findPolicy(items: Policy[], slugOrId: string): Policy | undefined {
  const normalized = slugOrId.trim().toLowerCase();
  return items.find(
    (item) =>
      item.slug.toLowerCase() === normalized ||
      item.id.toLowerCase() === normalized ||
      item.type.toLowerCase() === normalized,
  );
}

/** Token an admin can place in policy content to embed the live programs list. */
export const PROGRAMS_TOKEN = '{{programs}}';

export type PolicyContentBlock = { kind: 'text'; text: string } | { kind: 'programs' };

/**
 * Split policy plain text into renderable blocks at each `{{programs}}`
 * token. Text blocks are rendered with whitespace preserved (everything
 * stays plain text - no HTML/markdown), and the programs block renders the
 * live `GET /programs` list.
 */
export function splitProgramsToken(content: string): PolicyContentBlock[] {
  const parts = content.split(/\{\{\s*programs\s*\}\}/gi);
  const blocks: PolicyContentBlock[] = [];
  parts.forEach((part, index) => {
    if (part.trim().length > 0) blocks.push({ kind: 'text', text: part });
    if (index < parts.length - 1) blocks.push({ kind: 'programs' });
  });
  return blocks;
}
