import type { ReactNode } from 'react';

import { Icon, StatusChip } from '@jad/ui';

import styles from './CmsSectionCard.module.css';

export function CmsSectionCard({
  id,
  title,
  description,
  dirty,
  collapsible,
  open,
  onToggle,
  index,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  dirty?: boolean;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
  index?: number;
  children: ReactNode;
}) {
  const isCollapsible = collapsible && typeof open === 'boolean' && onToggle;
  const panelId = id ? `${id}-panel` : undefined;
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section id={id} className={styles.card} aria-labelledby={headingId}>
      {isCollapsible ? (
        <button
          type="button"
          className={styles.headerButton}
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${title} section, ${open ? 'expanded' : 'collapsed'}`}
        >
          <span className={styles.titleWrap}>
            {typeof index === 'number' ? (
              <span className={styles.badge} aria-hidden="true">
                {index}
              </span>
            ) : null}
            <h2 id={headingId} className={styles.title}>
              {title}
            </h2>
          </span>
          <span className={styles.headerActions}>
            {dirty ? <StatusChip label="Unsaved changes" tone="warning" /> : null}
            <Icon
              name="chevron-down"
              size={16}
              className={styles.chevron}
              aria-hidden
              style={open ? { transform: 'rotate(0deg)' } : { transform: 'rotate(-90deg)' }}
            />
          </span>
        </button>
      ) : (
        <div className={styles.header}>
          <span className={styles.titleWrap}>
            {typeof index === 'number' ? (
              <span className={styles.badge} aria-hidden="true">
                {index}
              </span>
            ) : null}
            <h2 id={headingId} className={styles.title}>
              {title}
            </h2>
          </span>
          {dirty ? <StatusChip label="Unsaved changes" tone="warning" /> : null}
        </div>
      )}
      {description ? <p className={styles.description}>{description}</p> : null}
      {isCollapsible && !open ? null : (
        <div id={panelId} role="region" aria-labelledby={headingId} className={styles.fields}>
          {children}
        </div>
      )}
    </section>
  );
}
