import { useState } from 'react';
import { useParams } from 'react-router';

import { ErrorState, NotFound, PageHeader, Skeleton } from '@jad/ui';

import { ButtonLink } from '@/components/ButtonLink';
import { usePolicies } from '../../../hooks/usePolicies';
import { PolicyProgramsList } from '../../public/components/PolicyPrograms';
import { findPolicy, splitProgramsToken } from '../../public/content/policies';
import { formatDate } from '../lib/presentation';
import styles from './PolicyDetailPage.module.css';

/**
 * Policy detail (SCR-MEM-023, FR-ADM-004). There is no `GET /policies/:id`
 * endpoint (API-SPECIFICATION #69 only), so the detail is resolved from the
 * server-authoritative policy list. Content is rendered as PLAIN TEXT
 * (whitespace preserved) - no raw HTML is ever injected (SECURITY.md; any
 * raw-content rendering REQUIRES APPROVAL).
 */
export function PolicyDetailPage() {
  const { policyId = '' } = useParams();
  const policiesQuery = usePolicies();
  const [copied, setCopied] = useState(false);

  const sorted = [...(policiesQuery.data ?? [])].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  const idx = sorted.findIndex((p) => p.slug === policyId || p.id === policyId);
  const prev = idx > 0 ? sorted[idx - 1] : undefined;
  const next = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : undefined;
  const policy = findPolicy(policiesQuery.data ?? [], policyId);

  if (policiesQuery.isLoading) {
    return (
      <section>
        <PageHeader title="Policy" />

        <div className={styles.loading} role="status" aria-live="polite" aria-busy="true">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      </section>
    );
  }

  if (policiesQuery.isError) {
    return (
      <section>
        <PageHeader title="Policy" />

        <ErrorState
          error={policiesQuery.error}
          title="Could not load policy"
          onRetry={() => void policiesQuery.refetch()}
        />
      </section>
    );
  }

  if (!policy) {
    return (
      <section>
        <PageHeader title="Policy not found" />

        <NotFound
          title="Policy not found"
          action={
            <ButtonLink to="/member/policies" variant="secondary">
              All policies
            </ButtonLink>
          }
        />
      </section>
    );
  }

  return (
    <section>
      <PageHeader
        title={policy.title}
        description={`${policy.type} · updated ${formatDate(policy.updatedAt)}`}
        actions={
          <ButtonLink to="/member/policies" variant="ghost">
            All policies
          </ButtonLink>
        }
      />

      <div className={styles.bodyCard}>
        <div className={styles.body}>
          {splitProgramsToken(policy.content ?? '').map((block, index) =>
            block.kind === 'programs' ? (
              <PolicyProgramsList key={`programs-${index}`} />
            ) : (
              <span key={`text-${index}`}>{block.text}</span>
            ),
          )}
        </div>
      </div>
      {policy.documentUrl ? (
        <div className={styles.bodyCard}>
          <a
            href={policy.documentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.pdfLink}
          >
            View PDF
          </a>
        </div>
      ) : null}
      <div className={styles.footerNav} role="navigation" aria-label="Policy navigation">
        <div className={styles.navGroup}>
          {prev ? (
            <ButtonLink to={`/member/policies/${prev.slug}`} variant="secondary">
              Previous
            </ButtonLink>
          ) : (
            <span className={styles.navDisabled} aria-disabled="true">
              Previous
            </span>
          )}
          {next ? (
            <ButtonLink to={`/member/policies/${next.slug}`} variant="secondary">
              Next
            </ButtonLink>
          ) : (
            <span className={styles.navDisabled} aria-disabled="true">
              Next
            </span>
          )}
        </div>
        <div className={styles.navGroup}>
          <button type="button" className={styles.actionButton} onClick={() => window.print()}>
            Print
          </button>
          <button
            type="button"
            className={styles.actionButton}
            aria-live="polite"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(policy.content ?? '');
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </section>
  );
}
