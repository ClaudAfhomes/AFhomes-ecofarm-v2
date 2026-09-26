import styles from './Skeleton.module.css';

/** Structured loading placeholder (UI-UX §10 "Loading"). Pure presentational. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={`${styles.skeleton} ${className ?? ''}`} aria-hidden="true" />;
}
