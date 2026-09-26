import { ErrorState } from '../../../components/ErrorState';
import { Card } from '../../../components/Card';
import { EmptyState } from '../../../components/EmptyState';
import { Skeleton } from '../../../components/Skeleton';
import { usePrograms } from '../hooks/usePrograms';
import styles from './ProgramsSection.module.css';

/**
 * Live programs list - `GET /programs` (PUBLIC, FEAT-068 / FR-PRG-001).
 * Renders the required UI states (UI-UX §10): loading / empty / error / data.
 */
export function ProgramsSection() {
  const { data, isPending, isError, error, refetch } = usePrograms();

  let content;
  if (isPending) {
    content = (
      <div className={styles.grid}>
        <Skeleton className={styles.skeletonCard} />
        <Skeleton className={styles.skeletonCard} />
      </div>
    );
  } else if (isError) {
    content = <ErrorState error={error} onRetry={() => void refetch()} />;
  } else if (!data || data.length === 0) {
    content = <EmptyState title="No programs are available yet." />;
  } else {
    content = (
      <div className={styles.grid}>
        {data.map((program) => (
          <Card key={program.id}>
            <h3 className={styles.programName}>{program.name}</h3>
            <p className={styles.programCode}>Code: {program.code}</p>
            {program.description ? (
              <p className={styles.programDesc}>{program.description}</p>
            ) : null}
          </Card>
        ))}
      </div>
    );
  }

  return (
    <section aria-labelledby="programs-heading">
      <h2 id="programs-heading" className={styles.sectionTitle}>
        Programs
      </h2>
      {content}
    </section>
  );
}
