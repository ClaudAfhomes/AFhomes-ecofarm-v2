import styles from './TierBadge.module.css';

/**
 * VIP tier badge: the tier name in its metal color.
 *
 * A dedicated treatment instead of StatusChip because chip tones are
 * semantic (success/warning/danger) while tiers are metallic identity -
 * Gold reading as "warning" with a clock icon would say the wrong thing.
 * Meaning always rides on the text, never on color alone.
 */
export function TierBadge({ tier }: { tier: string | null | undefined }) {
  if (!tier) return <span className={`${styles.badge} ${styles.none}`}>No tier</span>;
  const tone =
    tier === 'GOLD'
      ? styles.gold
      : tier === 'SILVER'
        ? styles.silver
        : tier === 'BRONZE'
          ? styles.bronze
          : styles.none;
  return (
    <span className={`${styles.badge} ${tone}`}>
      <span className={styles.dot} aria-hidden="true" />
      {tier}
    </span>
  );
}
