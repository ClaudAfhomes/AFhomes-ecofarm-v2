import { usePolicies } from './usePolicies';
import {
  GUIDELINES_POLICY_SLUG,
  POLICY_FALLBACK,
  PRIVACY_POLICY_SLUG,
  TERMS_POLICY_SLUG,
  policyPath,
} from '../features/public/content/policies';

/**
 * Live policy deep links for the footer and consent copy. Returns the
 * canonical `/policies/{slug}` path only for policies that actually exist in
 * the API response, so a deleted/renamed policy hides its link instead of
 * dead-ending on "Policy not found". When the API is unreachable the seeded
 * fallback list keeps the legal links resolvable (Q6).
 */
export function usePolicyLinks(): {
  terms?: string;
  privacy?: string;
  guidelines?: string;
} {
  const { data, isError } = usePolicies();
  const usingFallback = isError || !data || data.length === 0;
  const items = usingFallback ? POLICY_FALLBACK : data;
  const slugOrType = (slug: string): boolean =>
    items.some(
      (policy) => policy.slug.toLowerCase() === slug || policy.type.toLowerCase() === slug,
    );
  const linkFor = (slug: string): string | undefined =>
    slugOrType(slug) ? policyPath(slug) : undefined;
  return {
    terms: linkFor(TERMS_POLICY_SLUG),
    privacy: linkFor(PRIVACY_POLICY_SLUG),
    guidelines: linkFor(GUIDELINES_POLICY_SLUG),
  };
}
