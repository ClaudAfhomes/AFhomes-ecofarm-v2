import { Link } from 'react-router';

import { Icon } from './Icon';
import styles from './Breadcrumbs.module.css';

export interface BreadcrumbItem {
  to?: string;
  label: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  ariaLabel?: string;
}

/** Contextual path back to the queue/section (UI-UX §4.3/§4.7). Last item is the current page. */
export function Breadcrumbs({ items, ariaLabel = 'Breadcrumb' }: BreadcrumbsProps) {
  // A group whose only page shares its name ("Reports > Reports") reads as a
  // stutter; keep the later (more specific) item.
  const trail = items.filter((item, index) => item.label !== items[index + 1]?.label);
  const lastIndex = trail.length - 1;
  return (
    <nav className={styles.breadcrumbs} aria-label={ariaLabel}>
      <ol className={styles.list}>
        {trail.map((item, index) => {
          const isLast = index === lastIndex;
          return (
            <li key={`${index}-${item.label}`} className={styles.item}>
              {isLast || !item.to ? (
                <span
                  className={isLast ? styles.current : styles.group}
                  aria-current={isLast ? 'page' : undefined}
                >
                  {item.label}
                </span>
              ) : (
                <Link to={item.to} className={styles.link}>
                  {item.label}
                </Link>
              )}
              {!isLast && (
                <span className={styles.separator} aria-hidden="true">
                  <Icon name="chevron-right" size={14} />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
