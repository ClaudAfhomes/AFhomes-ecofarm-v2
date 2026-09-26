import type { HTMLAttributes } from 'react';

import styles from './Card.module.css';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Semantic element; default `article` for standalone cards. */
  as?: 'article' | 'section' | 'div';
}

/** Shared card primitive (DESIGN-SYSTEM §6.3). */
export function Card({ as = 'article', className, ...rest }: CardProps) {
  const Tag = as;
  return <Tag className={`${styles.card} ${className ?? ''}`} {...rest} />;
}
