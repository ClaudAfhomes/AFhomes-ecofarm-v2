/**
 * Policy URL-slug helpers (admin form). The API validates the same shape via
 * `policySlugSchema`; these keep the create/edit dialogs consistent and let
 * the slug auto-suggest from the title until the admin edits it.
 */
export const POLICY_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugifyPolicyTitle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function isValidPolicySlug(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 80 && POLICY_SLUG_RE.test(trimmed);
}
