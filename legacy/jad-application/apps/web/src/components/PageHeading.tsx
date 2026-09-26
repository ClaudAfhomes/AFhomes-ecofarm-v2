import type { ReactNode } from 'react';

import styles from './PageHeading.module.css';

export interface PageHeadingProps {
  eyebrow?: string;
  title: string;
  lead?: ReactNode;
}

/** Page header - semantic `h1` with optional eyebrow and lead paragraph. */
export function PageHeading({ eyebrow, title, lead }: PageHeadingProps) {
  return (
    <div className={styles.heading}>
      {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
      <h1>{title}</h1>
      {lead ? <p className={`${styles.lead} prose`}>{lead}</p> : null}
    </div>
  );
}
