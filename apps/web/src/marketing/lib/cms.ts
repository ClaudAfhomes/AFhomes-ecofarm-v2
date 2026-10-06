/**
 * Phase 6 CMS-backed content repository with the Phase 3 static fallback.
 *
 * This module preserves the source `cmsRepository` synchronous read surface: it
 * exposes the same synchronous read surface (`getSiteConfig`,
 * `getPageContent`, `getExperiences`, `getVipPlans`, `getFaqCategories`,
 * `getStories`, `getMediaBlocks`) backed by the repository-held static
 * fallback content under `../data/mock`, which is the same content the
 * source site renders when its CMS backend is unreachable.
 *
 * The repository defaults render first. `hydrateCms()` then overlays only
 * structurally valid, published documents from the current AF Homes API. A
 * network, parse, or shape failure leaves the defaults in place.
 *
 * Callers continue to program against this stable repository interface.
 */
import { cmsPublicContentSchema } from '@afhomes/contracts';
import { request } from '../../lib/api/client';
import { experiences } from '../data/mock/experiences';
import { faqCategories } from '../data/mock/faq';
import { pageContent } from '../data/mock/pageContent';
import { siteConfig } from '../data/mock/site';
import { stories } from '../data/mock/stories';
import { vipPlans } from '../data/mock/vip';
import type { Experience } from '../types/experience';
import type { FaqCategory } from '../types/faq';
import type { CmsMediaBlock } from '../types/mediaBlock';
import type { PageContent } from '../types/pageContent';
import type { SiteConfig } from '../types/site';
import type { Story } from '../types/story';
import type { VipPlan } from '../types/vip';

type CmsState = {
  site: SiteConfig;
  pageContent: PageContent;
  experiences: Experience[];
  vip: VipPlan[];
  faq: FaqCategory[];
  stories: Story[];
  mediaBlocks: CmsMediaBlock[];
};

const fallback: CmsState = {
  site: siteConfig,
  pageContent,
  experiences,
  vip: vipPlans,
  faq: faqCategories,
  stories,
  mediaBlocks: [],
};
let current: CmsState = fallback;
let hydration: Promise<void> | null = null;

function matchesFallbackShape(value: unknown, template: unknown): boolean {
  if (template === null) return value === null || value !== undefined;
  if (Array.isArray(template)) {
    if (!Array.isArray(value)) return false;
    if (template.length === 0 || value.length === 0) return true;
    return value.every((item) => matchesFallbackShape(item, template[0]));
  }
  if (typeof template === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.entries(template as Record<string, unknown>).every(([key, child]) =>
      matchesFallbackShape((value as Record<string, unknown>)[key], child),
    );
  }
  return typeof value === typeof template;
}

export function safeOverride<T>(value: unknown, defaultValue: T): T {
  return matchesFallbackShape(value, defaultValue) ? (value as T) : defaultValue;
}

/** Overlay published server documents on repository defaults. Failure is intentionally non-fatal. */
export function hydrateCms(): Promise<void> {
  if (hydration) return hydration;
  hydration = request('/cms/public', cmsPublicContentSchema)
    .then(({ documents }) => {
      current = {
        site: safeOverride(documents.site, fallback.site),
        pageContent: safeOverride(documents.pageContent, fallback.pageContent),
        experiences: safeOverride(documents.experiences, fallback.experiences),
        vip: safeOverride(documents.vip, fallback.vip),
        faq: safeOverride(documents.faq, fallback.faq),
        stories: safeOverride(documents.stories, fallback.stories),
        mediaBlocks: safeOverride(documents.mediaBlocks, fallback.mediaBlocks),
      };
      window.dispatchEvent(new Event('afhomes-cms-updated'));
    })
    .catch(() => {
      // Static Phase 3 content remains authoritative when CMS is unavailable.
    });
  return hydration;
}

export const cmsRepository = {
  getSiteConfig(): SiteConfig {
    return current.site;
  },
  getPageContent(): PageContent {
    return current.pageContent;
  },
  getExperiences(): Experience[] {
    return current.experiences.filter((experience) => !experience.archived);
  },
  getVipPlans(): VipPlan[] {
    return current.vip.filter((plan) => !plan.archived);
  },
  getFaqCategories(): FaqCategory[] {
    return current.faq
      .filter((category) => !category.archived)
      .map((category) => ({
        ...category,
        items: category.items.filter((item) => !item.archived),
      }));
  },
  getStories(): Story[] {
    return current.stories.filter((story) => !story.archived);
  },
  /** No CMS media backend in Phase 3: heroes and sections use fallbacks. */
  getMediaBlocks(): CmsMediaBlock[] {
    return current.mediaBlocks;
  },
};
