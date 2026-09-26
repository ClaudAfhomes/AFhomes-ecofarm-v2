import { useParams } from 'react-router';

import { ButtonLink } from '../../../components/ButtonLink';
import { EmptyState } from '../../../components/EmptyState';
import { SectionHeader } from '../../../components/SectionHeader';
import { CTASection } from '../components/CTASection';
import { Hero } from '../components/Hero';
import { PropertyBreadcrumbs } from '../components/PropertyBreadcrumbs';
import { PropertyCard } from '../components/PropertyCard';
import { NotFoundPage } from './NotFoundPage';
import { PROPERTIES_PATH, getCategoryBySlug, getPropertiesByCategory } from '../content';
import styles from './CategoryPage.module.css';

/**
 * Property category listing page (`/properties/:categorySlug`).
 *
 * Derives its listing from the static catalog - no property records are
 * duplicated here. Unknown slugs render the friendly not-found state.
 */
export function CategoryPage() {
  const { categorySlug = '' } = useParams();
  const category = getCategoryBySlug(categorySlug);

  if (!category) {
    return <NotFoundPage />;
  }

  const properties = getPropertiesByCategory(category.slug);
  const count = properties.length;

  return (
    <div className={styles.page}>
      <Hero
        variant="page"
        eyebrow="Properties"
        title={category.title}
        lead={category.description}
        primaryCta={{ label: 'Talk to Us', to: '/contact' }}
        image={category.image}
      />

      <section className={styles.section}>
        <div className="container">
          <PropertyBreadcrumbs categorySlug={category.slug} categoryTitle={category.title} />
          <SectionHeader eyebrow="Listings" title={`Properties in ${category.title}`} />
          <p className={styles.meta}>
            {count} {count === 1 ? 'property' : 'properties'} in this category
          </p>
          <p className={styles.note}>
            Message us now for more details or to schedule a site viewing.
          </p>

          {count > 0 ? (
            <div className={styles.propertyGrid}>
              {properties.map((property) => (
                <PropertyCard key={property.id} property={property} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No properties listed yet"
              description="This category has no listed properties right now. Tell us what you are looking for and we will share matching opportunities in consultation."
              action={
                <ButtonLink to={PROPERTIES_PATH} variant="secondary">
                  Back to Properties
                </ButtonLink>
              }
            />
          )}
        </div>
      </section>

      <CTASection
        title={`Looking for something in ${category.title.toLowerCase()}?`}
        lead="Talk with JA&D Realty Services and tell us what you are looking for - we will match you with the right opportunity."
        primaryCta={{ label: 'Talk to Us', to: '/contact' }}
      />
    </div>
  );
}
