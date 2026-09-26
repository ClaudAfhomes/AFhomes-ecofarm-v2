import { ErrorState } from '../../../components/ErrorState';
import { Skeleton } from '../../../components/Skeleton';
import { usePublicConfig } from '../hooks/usePublicConfig';
import styles from './EligibilitySection.module.css';

/**
 * Live public config - `GET /config/public` (PUBLIC, FEAT-005 / FR-ADM-001).
 * Renders the minimum-age parameter the public site legitimately consumes.
 * Config values are never hard-coded (BR-CFG-001, BR-REG-011).
 */
export function EligibilitySection() {
  const { data, isPending, isError, error, refetch } = usePublicConfig();

  let content;
  if (isPending) {
    content = <Skeleton className={styles.skeleton} />;
  } else if (isError) {
    content = <ErrorState error={error} onRetry={() => void refetch()} />;
  } else if (data) {
    content = (
      <p>
        Minimum age to join: <strong>{data.minimumAge}</strong>
      </p>
    );
  } else {
    content = <p>Eligibility details are not available yet.</p>;
  }

  return (
    <section aria-labelledby="eligibility-heading">
      <h2 id="eligibility-heading" className={styles.sectionTitle}>
        Eligibility preview
      </h2>
      {content}
    </section>
  );
}
