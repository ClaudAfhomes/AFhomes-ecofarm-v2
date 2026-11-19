import type { HTMLAttributes, ReactNode } from 'react';

import styles from './DetailCard.module.css';

export function DetailGrid({ children, className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`${styles.grid} ${className ?? ''}`} {...rest}>
      {children}
    </div>
  );
}

export function DetailCard({ children, className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`${styles.card} ${className ?? ''}`} {...rest}>
      {children}
    </div>
  );
}

export function DetailCardTitle({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2 className={`${styles.cardTitle} ${className ?? ''}`} {...rest}>
      {children}
    </h2>
  );
}

export function DetailFieldGrid({ children, className, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <dl className={`${styles.fieldGrid} ${className ?? ''}`} {...rest}>
      {children}
    </dl>
  );
}

export function DetailField({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`${styles.field} ${className ?? ''}`.trim()}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function DetailMono({ children, className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={`${styles.mono} ${className ?? ''}`} {...rest}>
      {children}
    </span>
  );
}

export function DetailMockNote({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={`${styles.mockNote} ${className ?? ''}`} {...rest}>
      {children}
    </p>
  );
}
