import { Link } from 'react-router';

import { Skeleton } from '../../../components/Skeleton';
import { usePolicies } from '../../../hooks/usePolicies';
import { Hero } from '../components/Hero';
import { ABOUT_IMAGES } from '../content';
import { POLICY_FALLBACK, policyPath } from '../content/policies';
import styles from './PoliciesPage.module.css';

function formatUpdatedAt(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return updatedAt;
  return date.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Public Policies page - API-driven; static fallback on error/empty (Q6). */
export function PoliciesPage() {
  const { data, isPending } = usePolicies();
  const items = (data?.length ?? 0) > 0 ? data! : POLICY_FALLBACK;

  return (
    <div className={styles.page}>
      <Hero
        variant="page"
        eyebrow="Legal"
        title="Policies"
        lead="JA&D policies, program guidelines, and terms and conditions - read the documents that govern your membership."
        image={ABOUT_IMAGES.trust}
      />

      <section className={styles.section}>
        <div className="container">
          {isPending ? (
            <div role="status" aria-live="polite" aria-label="Loading policies">
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </div>
          ) : (
            <ul className={styles.list}>
              {items.map((policy) => (
                <li key={policy.id}>
                  <Link className={styles.card} to={policyPath(policy.slug)}>
                    <span className={styles.kind}>{policy.type}</span>
                    <span className={styles.title}>{policy.title}</span>
                    <span className={styles.meta}>Updated {formatUpdatedAt(policy.updatedAt)}</span>
                    <span className={styles.view}>View</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
