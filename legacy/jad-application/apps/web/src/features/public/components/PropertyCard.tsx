import { Link } from 'react-router';

import { formatMoney } from '@jad/shared';

import { ButtonLink } from '../../../components/ButtonLink';
import { ImageBlock } from '../../../components/ImageBlock';
import { getCategoryBySlug, getPropertyHeroPhoto, photoUrl, propertyPath } from '../content';
import type { Property } from '../content';
import styles from './PropertyCard.module.css';

export interface PropertyCardProps {
  property: Property;
  /** Heading level; `h3` (default) nests under a page `h2`. */
  headingLevel?: 'h2' | 'h3';
}

/**
 * Property listing card. Shows name, category, location, price (when
 * published), key characteristics, and a "View Details" action. The title and
 * CTA are semantic links to the property detail route; the card itself is not
 * a clickable div.
 */
export function PropertyCard({ property, headingLevel = 'h3' }: PropertyCardProps) {
  const Tag = headingLevel;
  const category = getCategoryBySlug(property.categoryId);
  const detailPath = propertyPath(property.categoryId, property.id);

  return (
    <article className={styles.card}>
      <div className={styles.media}>
        <Link to={detailPath} className={styles.imageLink} tabIndex={-1} aria-hidden="true">
          <ImageBlock
            src={photoUrl(getPropertyHeroPhoto(property).id, 900)}
            alt={getPropertyHeroPhoto(property).alt}
            ratio="landscape"
          />
        </Link>
        {property.price ? <p className={styles.priceBadge}>{formatMoney(property.price)}</p> : null}
      </div>
      <div className={styles.body}>
        {category ? <p className={styles.category}>{category.title}</p> : null}
        <Tag className={styles.title}>
          <Link to={detailPath} className={styles.titleLink}>
            {property.name}
          </Link>
        </Tag>
        <p className={styles.location}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="10.5" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
          </svg>
          {property.location}
        </p>
        {property.characteristics.length > 0 ? (
          <ul className={styles.characteristics}>
            {property.characteristics.map((characteristic) => (
              <li key={characteristic}>{characteristic}</li>
            ))}
          </ul>
        ) : (
          <p className={styles.inquiryNote}>Details available upon inquiry</p>
        )}
        <ButtonLink to={detailPath} variant="secondary" className={styles.cta}>
          View Details
        </ButtonLink>
      </div>
    </article>
  );
}
