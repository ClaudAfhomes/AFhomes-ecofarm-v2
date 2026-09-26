import type { ReactNode } from 'react';

import styles from './SectionHeader.module.css';

export interface SectionHeaderProps {
  eyebrow?: string;
  title: string;
  lead?: ReactNode;
  align?: 'start' | 'center';
  /** Heading level; default `h2`. Use `h3` only when nested under an `h2`. */
  as?: 'h2' | 'h3';
}

/** Editorial section header: accent eyebrow, serif title, optional lead. */
export function SectionHeader({
  eyebrow,
  title,
  lead,
  align = 'start',
  as = 'h2',
}: SectionHeaderProps) {
  const Tag = as;
  return (
    <header className={`${styles.header} ${align === 'center' ? styles.center : ''}`}>
      {eyebrow ? (
        <p className={styles.eyebrow}>
          <span className={styles.rule} aria-hidden="true" />
          {eyebrow}
        </p>
      ) : null}
      <Tag className={styles.title}>{title}</Tag>
      {lead ? <p className={`${styles.lead} prose`}>{lead}</p> : null}
    </header>
  );
}
