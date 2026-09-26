import { Link } from 'react-router';

import { categoryPath, photoUrl } from '../content';
import type { PropertyCategory } from '../content';
import styles from './PropertyCategoryCard.module.css';

export interface PropertyCategoryCardProps {
  category: PropertyCategory;
  /** Number of properties in the category. */
  count: number;
}

/**
 * Category tile: representative imagery with an overlay label and property
 * count. Links to the category listing page (`/properties/{slug}`).
 */
export function PropertyCategoryCard({ category, count }: PropertyCategoryCardProps) {
  return (
    <Link to={categoryPath(category.slug)} className={styles.card}>
      <img
        className={styles.image}
        src={photoUrl(category.image.id, 800)}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
      />
      <div className={styles.scrim} aria-hidden="true" />
      <div className={styles.body}>
        <p className={styles.count}>
          {count} {count === 1 ? 'property' : 'properties'}
        </p>
        <h3 className={styles.title}>{category.title}</h3>
        <p className={styles.description}>{category.shortDescription}</p>
        <span className={styles.link}>
          View Properties
          <svg
            className={styles.arrow}
            viewBox="0 0 16 16"
            width="14"
            height="14"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M3 8h10M9 4l4 4-4 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>
    </Link>
  );
}
