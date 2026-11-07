import styles from './VerifiedBadge.module.css';

/** Blue verified-accreditation badge (Facebook-style seal + check). Decorative only. */
export function VerifiedBadge() {
  return (
    <svg className={styles.badge} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 1.5l2.6 2.1 3.3-.3 1 3.2 2.9 1.7-.9 3.2.9 3.2-2.9 1.7-1 3.2-3.3-.3L12 22.5l-2.6-2.1-3.3.3-1-3.2-2.9-1.7.9-3.2-.9-3.2 2.9-1.7 1-3.2 3.3.3z"
      />
      <path
        d="M7.5 12.4l3 3 6-6.2"
        fill="none"
        stroke="white"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
