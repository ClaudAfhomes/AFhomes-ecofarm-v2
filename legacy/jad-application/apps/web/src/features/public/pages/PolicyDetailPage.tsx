import { Link, useParams } from 'react-router';

import { ButtonLink } from '../../../components/ButtonLink';
import { Skeleton } from '../../../components/Skeleton';
import { usePolicies } from '../../../hooks/usePolicies';
import { Hero } from '../components/Hero';
import { PolicyProgramsList } from '../components/PolicyPrograms';
import { ABOUT_IMAGES } from '../content';
import {
  POLICIES_PATH,
  POLICY_FALLBACK,
  findPolicy,
  splitProgramsToken,
} from '../content/policies';
import styles from './PolicyDetailPage.module.css';

/**
 * Public policy detail - renders the API policy when present, otherwise the
 * static fallback (Q6). Content renders as plain text (SECURITY.md); the
 * uploaded PDF is preferred when attached.
 */
export function PolicyDetailPage() {
  const { policyId = '' } = useParams();
  const { data, isPending } = usePolicies();
  const items = (data?.length ?? 0) > 0 ? data! : POLICY_FALLBACK;
  const policy = findPolicy(items, policyId);

  if (isPending) {
    return (
      <div className={styles.page}>
        <section className={styles.section}>
          <div className="container">
            <div role="status" aria-live="polite" aria-label="Loading policy">
              <Skeleton />
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (!policy) {
    return (
      <div className={styles.page}>
        <section className={styles.section}>
          <div className="container">
            <h1 className={styles.title}>Policy not found</h1>
            <p className={styles.lead}>
              The policy you are looking for does not exist or is no longer published.
            </p>
            <ButtonLink to={POLICIES_PATH} variant="secondary">
              All policies
            </ButtonLink>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Hero
        variant="page"
        eyebrow={policy.type}
        title={policy.title}
        lead={`Official JA&D ${policy.type} document.`}
        image={ABOUT_IMAGES.trust}
      />

      <section className={styles.section}>
        <div className={`container ${styles.narrow}`}>
          {policy.documentUrl ? (
            <div className={styles.actions}>
              <ButtonLink
                href={policy.documentUrl}
                variant="primary"
                target="_blank"
                rel="noopener noreferrer"
              >
                View PDF
              </ButtonLink>
              <Link className={styles.backLink} to={POLICIES_PATH}>
                All policies
              </Link>
            </div>
          ) : (
            <Link className={styles.backLink} to={POLICIES_PATH}>
              All policies
            </Link>
          )}
          {policy.content?.trim()
            ? (() => {
                const blocks = splitProgramsToken(policy.content);
                const hasToken = blocks.some((block) => block.kind === 'programs');
                return hasToken ? (
                  <div className={`${styles.prose} prose`}>
                    {blocks.map((block, index) =>
                      block.kind === 'programs' ? (
                        <PolicyProgramsList key={`programs-${index}`} />
                      ) : (
                        <p key={`text-${index}`} className={styles.proseBlock}>
                          {block.text}
                        </p>
                      ),
                    )}
                  </div>
                ) : (
                  <div className={`${styles.prose} prose`}>{policy.content}</div>
                );
              })()
            : null}
        </div>
      </section>
    </div>
  );
}
