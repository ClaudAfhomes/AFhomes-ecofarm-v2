import { ButtonLink } from '../../../components/ButtonLink';
import { ImageBlock } from '../../../components/ImageBlock';
import { SectionHeader } from '../../../components/SectionHeader';
import { useQuery } from '@tanstack/react-query';

import type { HomepageContent } from '@jad/contracts';

import { CTASection } from '../components/CTASection';
import { Hero } from '../components/Hero';
import { getHomepageCms } from '@/lib/cms';
import { PropertyCard } from '../components/PropertyCard';
import { PropertyCategoryCard } from '../components/PropertyCategoryCard';
import {
  HOME,
  PROPERTY_CATEGORIES,
  getFeaturedProperties,
  getPropertiesByCategory,
  photoUrl,
} from '../content';
import styles from './HomePage.module.css';

/** Stroke icons for the trust pillars, indexed to `content.trust.items`. */
const TRUST_ICONS = [
  // Ownership, directly
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" key="ownership">
    <path
      d="M12 3l7 2.4v5.6c0 4.3-2.9 7.7-7 9.1-4.1-1.4-7-4.8-7-9.1V5.4L12 3z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M9 11.6l2.1 2.1L15.2 9.4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>,
  // Due diligence first
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" key="diligence">
    <circle cx="11" cy="11" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
    <path
      d="M15.6 15.6L20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    />
  </svg>,
  // Complete documentation
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" key="documentation">
    <path
      d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8l-4-5z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M14 3v5h5M9.5 13h5M9.5 16.5h5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>,
  // Honest, professional advice
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" key="advice">
    <path
      d="M12 4.5a8 8 0 1 1-6.3 12.9L4 20l2.6-1.6A8 8 0 0 1 12 4.5z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M9 11.8l2 2 4-4.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>,
];

/** Public Home / landing page - CMS-driven with static fallback (Q6). */
export function HomePage() {
  const { data: cms } = useQuery({
    queryKey: ['cms', 'homepage'],
    queryFn: getHomepageCms,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const content = (cms as HomepageContent | undefined) ?? (HOME as unknown as HomepageContent);
  const featured = getFeaturedProperties(3);

  return (
    <>
      <Hero
        eyebrow={content.hero.eyebrow}
        title={content.hero.title}
        lead={content.hero.lead}
        primaryCta={content.hero.primaryCta}
        secondaryCta={content.hero.secondaryCta}
        image={content.hero.image}
      />

      <section className={styles.section}>
        <div className={`container ${styles.split}`}>
          <div>
            <SectionHeader eyebrow={content.value.eyebrow} title={content.value.title} />
            {content.value.paragraphs.map((paragraph) => (
              <p key={paragraph} className={`${styles.paragraph} prose`}>
                {paragraph}
              </p>
            ))}
          </div>
          <ImageBlock
            src={photoUrl(content.value.image.id, 900)}
            alt={content.value.image.alt}
            ratio="portrait"
            className={styles.editorialImage}
            frameClassName={styles.editorialFrame}
          />
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionMuted}`}>
        <div className="container">
          <SectionHeader
            eyebrow={content.categories.eyebrow}
            title={content.categories.title}
            lead={content.categories.lead}
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

      <section className={styles.section}>
        <div className="container">
          <div className={styles.featuredHeader}>
            <SectionHeader
              eyebrow={content.featured.eyebrow}
              title={content.featured.title}
              lead={content.featured.lead}
            />
          </div>
          <div className={styles.propertyGrid}>
            {featured.map((property) => (
              <PropertyCard key={property.id} property={property} />
            ))}
          </div>
          <div className={styles.featuredFooter}>
            {typeof content.featured.cta.href === 'string' &&
            content.featured.cta.href.length > 0 ? (
              <ButtonLink
                href={content.featured.cta.href}
                variant="primary"
                target="_blank"
                rel="noopener noreferrer"
              >
                {content.featured.cta.label}
              </ButtonLink>
            ) : (
              <ButtonLink to={content.featured.cta.to ?? '/properties'} variant="primary">
                {content.featured.cta.label}
              </ButtonLink>
            )}
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionMuted}`}>
        <div className="container">
          <SectionHeader eyebrow={content.approach.eyebrow} title={content.approach.title} />
          <ol className={styles.steps}>
            {content.approach.steps.map((step, index) => (
              <li key={step.title} className={styles.step}>
                <span className={styles.stepNumber} aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div>
                  <h3 className={styles.stepTitle}>{step.title}</h3>
                  <p className={styles.stepBody}>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className={styles.section}>
        <div className="container">
          <SectionHeader
            eyebrow={content.trust.eyebrow}
            title={content.trust.title}
            align="center"
          />
          <ul className={styles.pillars}>
            {content.trust.items.map((item, index) => (
              <li key={item.title} className={styles.pillar}>
                <span className={styles.pillarIcon}>{TRUST_ICONS[index]}</span>
                <h3 className={styles.pillarTitle}>{item.title}</h3>
                <p className={styles.pillarBody}>{item.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionMuted}`}>
        <div className={`container ${styles.split} ${styles.aboutPreview}`}>
          <ImageBlock
            src={photoUrl(content.aboutPreview.image.id, 900)}
            alt={content.aboutPreview.image.alt}
            ratio="landscape"
            className={styles.editorialImage}
            frameClassName={styles.editorialFrame}
          />
          <div>
            <SectionHeader
              eyebrow={content.aboutPreview.eyebrow}
              title={content.aboutPreview.title}
            />
            <p className={`${styles.paragraph} prose`}>{content.aboutPreview.lead}</p>
            {typeof content.aboutPreview.cta.href === 'string' &&
            content.aboutPreview.cta.href.length > 0 ? (
              <ButtonLink
                href={content.aboutPreview.cta.href}
                variant="secondary"
                target="_blank"
                rel="noopener noreferrer"
              >
                {content.aboutPreview.cta.label}
              </ButtonLink>
            ) : (
              <ButtonLink to={content.aboutPreview.cta.to ?? '/about'} variant="secondary">
                {content.aboutPreview.cta.label}
              </ButtonLink>
            )}
          </div>
        </div>
      </section>

      <CTASection
        title={content.ctaBand.title}
        lead={content.ctaBand.lead}
        primaryCta={content.ctaBand.primaryCta}
        secondaryCta={content.ctaBand.secondaryCta}
      />
    </>
  );
}
