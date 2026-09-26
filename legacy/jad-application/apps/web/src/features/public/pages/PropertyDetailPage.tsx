import { useParams } from 'react-router';

import { formatMoney } from '@jad/shared';

import { ButtonLink } from '../../../components/ButtonLink';
import { SectionHeader } from '../../../components/SectionHeader';
import { CTASection } from '../components/CTASection';
import { PropertyBreadcrumbs } from '../components/PropertyBreadcrumbs';
import { PropertyCard } from '../components/PropertyCard';
import { PropertyGallery } from '../components/PropertyGallery';
import { NotFoundPage } from './NotFoundPage';
import {
  MESSENGER_URL,
  PROPERTIES_PATH,
  categoryPath,
  getCategoryBySlug,
  getPropertyById,
  getRelatedProperties,
} from '../content';
import styles from './PropertyDetailPage.module.css';

/**
 * Reusable property detail page (`/properties/:categorySlug/:propertySlug`).
 *
 * Renders the full static record from the catalog: gallery, facts, overview,
 * highlights, and a "Message Us" CTA that opens Messenger. Unknown or
 * mismatched slugs render the friendly not-found state.
 */
export function PropertyDetailPage() {
  const { categorySlug = '', propertySlug = '' } = useParams();
  const category = getCategoryBySlug(categorySlug);
  const property = getPropertyById(propertySlug);

  if (!category || !property || property.categoryId !== category.slug) {
    return <NotFoundPage />;
  }

  const related = getRelatedProperties(property);
  const hasKeyFacts = property.keyFacts.length > 0;

  return (
    <div className={styles.page}>
      <section className={styles.section}>
        <div className="container">
          <PropertyBreadcrumbs
            categorySlug={category.slug}
            categoryTitle={category.title}
            propertyName={property.name}
          />

          <div className={styles.hero}>
            <div className={styles.gallery}>
              <PropertyGallery photos={property.gallery} />
            </div>

            <div className={styles.summary}>
              <p className={styles.category}>{category.title}</p>
              <h1 className={styles.title}>{property.name}</h1>
              <p className={styles.location}>{property.location}</p>

              {property.price ? (
                <div className={styles.priceBlock}>
                  <span className={styles.priceLabel}>Price</span>
                  <p className={styles.price}>{formatMoney(property.price)}</p>
                </div>
              ) : null}

              {hasKeyFacts ? (
                <dl className={styles.facts}>
                  {property.keyFacts.map((fact) => (
                    <div key={fact.label} className={styles.fact}>
                      <dt>{fact.label}</dt>
                      <dd>{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className={styles.inquiryNote}>Details available upon inquiry</p>
              )}

              <div className={styles.ctaRow}>
                <ButtonLink
                  href={MESSENGER_URL}
                  variant="primary"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Message Us
                </ButtonLink>
                <ButtonLink to={categoryPath(category.slug)} variant="ghost">
                  Back to {category.title}
                </ButtonLink>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionMuted}`}>
        <div className="container">
          <div className={styles.detailColumns}>
            <div>
              <SectionHeader eyebrow="Overview" title="About this property" />
              {property.overview.map((paragraph) => (
                <p key={paragraph} className={`${styles.paragraph} prose`}>
                  {paragraph}
                </p>
              ))}
            </div>
            <div>
              <SectionHeader eyebrow="Highlights" title="Key characteristics" />
              <ul className={styles.highlights}>
                {property.highlights.map((highlight) => (
                  <li key={highlight} className={styles.highlight}>
                    <svg
                      className={styles.check}
                      viewBox="0 0 16 16"
                      width="16"
                      height="16"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path
                        d="M3 8.5 6.5 12 13 4.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                    </svg>
                    {highlight}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {related.length > 0 ? (
        <section className={styles.section}>
          <div className="container">
            <SectionHeader
              eyebrow="Related properties"
              title="Related properties"
              lead="More listings from the catalog to explore."
            />
            <div className={styles.propertyGrid}>
              {related.map((relatedProperty) => (
                <PropertyCard key={relatedProperty.id} property={relatedProperty} />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <CTASection
        title="Interested in this kind of property?"
        lead="Talk with JA&D Realty Services and tell us what you are looking for - we will match you with the right opportunity."
        primaryCta={{ label: 'Talk to Us', to: '/contact' }}
        secondaryCta={{ label: 'View All Properties', to: PROPERTIES_PATH }}
      />
    </div>
  );
}
