import { Link } from 'react-router';

import { PROPERTIES_PATH, categoryPath } from '../content';
import styles from './PropertyBreadcrumbs.module.css';

export interface PropertyBreadcrumbsProps {
  categorySlug: string;
  categoryTitle: string;
  /** Property name for the current leaf (rendered as the final, non-link crumb). */
  propertyName?: string;
}

/**
 * Breadcrumb navigation for category and property detail pages. Provides
 * context back to the listings root and, on detail pages, to the category.
 */
export function PropertyBreadcrumbs({
  categorySlug,
  categoryTitle,
  propertyName,
}: PropertyBreadcrumbsProps) {
  return (
    <nav className={styles.nav} aria-label="Breadcrumb">
      <ol className={styles.list}>
        <li className={styles.item}>
          <Link to={PROPERTIES_PATH} className={styles.link}>
            Properties
          </Link>
        </li>
        <li className={styles.item}>
          <span className={styles.separator} aria-hidden="true">
            /
          </span>
          {propertyName ? (
            <Link to={categoryPath(categorySlug)} className={styles.link}>
              {categoryTitle}
            </Link>
          ) : (
            <span className={styles.current} aria-current="page">
              {categoryTitle}
            </span>
          )}
        </li>
        {propertyName ? (
          <li className={styles.item}>
            <span className={styles.separator} aria-hidden="true">
              /
            </span>
            <span className={styles.current} aria-current="page">
              {propertyName}
            </span>
          </li>
        ) : null}
      </ol>
    </nav>
  );
}
