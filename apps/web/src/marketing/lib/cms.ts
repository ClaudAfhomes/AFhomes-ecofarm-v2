/**
 * Phase 3 static content repository.
 *
 * This module is the Phase 3 stand-in for the source `cmsRepository`: it
 * exposes the same synchronous read surface (`getSiteConfig`,
 * `getPageContent`, `getExperiences`, `getVipPlans`, `getFaqCategories`,
 * `getStories`, `getMediaBlocks`) backed by the repository-held static
 * fallback content under `../data/mock`, which is the same content the
 * source site renders when its CMS backend is unreachable.
 *
 * The old Supabase CMS project was deleted, so there is no live backend in
 * this phase: `hydrate()` does not exist, `getMediaBlocks()` is empty (hero
 * and section components render their coded fallbacks), and nothing here
 * performs network I/O.
 *
 * Phase 4 seam: when the current Supabase CMS lands, replace the bodies
 * below with live reads. Callers must not change — they already program
 * against this interface.
 */
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

export const cmsRepository = {
  getSiteConfig(): SiteConfig {
    return siteConfig;
  },
  getPageContent(): PageContent {
    return pageContent;
  },
  getExperiences(): Experience[] {
    return experiences.filter((experience) => !experience.archived);
  },
  getVipPlans(): VipPlan[] {
    return vipPlans.filter((plan) => !plan.archived);
  },
  getFaqCategories(): FaqCategory[] {
    return faqCategories
      .filter((category) => !category.archived)
      .map((category) => ({
        ...category,
        items: category.items.filter((item) => !item.archived),
      }));
  },
  getStories(): Story[] {
    return stories.filter((story) => !story.archived);
  },
  /** No CMS media backend in Phase 3: heroes and sections use fallbacks. */
  getMediaBlocks(): CmsMediaBlock[] {
    return [];
  },
};
