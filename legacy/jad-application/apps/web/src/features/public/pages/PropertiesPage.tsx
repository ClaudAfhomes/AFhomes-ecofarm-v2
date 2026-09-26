import { SectionHeader } from '../../../components/SectionHeader';
import { useQuery } from '@tanstack/react-query';
import { getPropertiesCmsPublic } from '@/lib/cms';
import { CTASection } from '../components/CTASection';
import { Hero } from '../components/Hero';
import { PropertyCard } from '../components/PropertyCard';
import { PropertyCategoryCard } from '../components/PropertyCategoryCard';
import {
  PROPERTIES,
  PROPERTY_CATEGORIES,
  getFeaturedProperties,
  getPropertiesByCategory,
} from '../content';
import styles from './PropertiesPage.module.css';

/**
 * Public Properties / Listings landing page (`/properties`).
 *
 * Entry point into the browsing experience: intro, category cards (each
 * linking to its category listing), and featured sample properties. All records
 * derive from the static catalog - nothing is duplicated and nothing is a live
 * listing.
 */
export function PropertiesPage() {
  const { data: cms } = useQuery({
    queryKey: ['cms', 'properties'],
    queryFn: getPropertiesCmsPublic,
    staleTime: 0,
  });
  // CMS PropertiesContent stores page-level copy under `page` (hero/intro/featured/note/cta + title/lead),
  // while static PROPERTIES has it top-level. Normalize so both shapes work without a cast that hides mismatches.
  const content = (() => {
    if (!cms) return PROPERTIES;
    const raw = cms as unknown as { page?: typeof PROPERTIES } & typeof PROPERTIES;
    if (raw.page) {
      return {
        hero: raw.page.hero ?? PROPERTIES.hero,
        title: raw.page.title ?? PROPERTIES.title,
        lead: raw.page.lead ?? PROPERTIES.lead,
        intro: raw.page.intro ?? PROPERTIES.intro,
        featured: raw.page.featured ?? PROPERTIES.featured,
        note: raw.page.note ?? PROPERTIES.note,
        cta: raw.page.cta ?? PROPERTIES.cta,
      } as typeof PROPERTIES;
    }
    return cms as unknown as typeof PROPERTIES;
  })();
  const featured = getFeaturedProperties();

  return (
    <div className={styles.page}>
      <Hero
        variant="page"
        eyebrow={content.hero.eyebrow}
        title={content.title}
        lead={content.lead}
        primaryCta={content.hero.primaryCta}
        image={content.hero.image}
      />

      <section className={styles.section}>
        <div className="container">
          <SectionHeader
            eyebrow={content.intro.eyebrow}
            title={content.intro.title}
            lead={content.intro.lead}
          />
          <div className={styles.categoryGrid}>
            {PROPERTY_CATEGORIES.map((category) => (
              <PropertyCategoryCard
                key={category.slug}
                category={category}
                count={getPropertiesByCategory(category.slug).length}
              />
            ))}
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionMuted}`}>
        <div className="container">
          <SectionHeader
            eyebrow={content.featured.eyebrow}
            title={content.featured.title}
            lead={content.featured.lead}
          />
          <div className={styles.propertyGrid}>
            {featured.map((property) => (
              <PropertyCard key={property.id} property={property} />
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className="container">
          <SectionHeader
            eyebrow={content.note.eyebrow}
            title={content.note.title}
            lead={content.note.lead}
          />
          <ol className={styles.noteSteps}>
            {content.note.steps.map((step, index) => (
              <li key={step.title} className={styles.noteStep}>
                <span className={styles.noteStepIndex} aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3 className={styles.noteStepTitle}>{step.title}</h3>
                <p className={styles.noteStepBody}>{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <CTASection
        title={content.cta.title}
        lead={content.cta.lead}
        primaryCta={content.cta.primaryCta}
      />
    </div>
  );
}
