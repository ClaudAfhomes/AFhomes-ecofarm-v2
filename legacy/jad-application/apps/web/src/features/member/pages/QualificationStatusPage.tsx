import { Link, useSearchParams } from 'react-router';
import { useEffect } from 'react';

import { EmptyState, ErrorState, PageHeader, Skeleton, StatusChip } from '@jad/ui';

import { Alert } from '../../../components/Alert';
import { ButtonLink } from '../../../components/ButtonLink';
import { useQualification } from '../hooks/useMember';
import { memberStatusLabel } from '../lib/presentation';
import styles from './QualificationStatusPage.module.css';

function requirementAction(key: string, met: boolean): { label: string; to: string } | null {
  if (met) return null;
  switch (key) {
    case 'EMAIL_VERIFIED':
      return { label: 'Verify email', to: '/register/verify-email' };
    case 'QUALIFICATION':
      return { label: 'View guidance', to: '/member/policies' };
    case 'MIN_AGE':
      return { label: 'Contact support', to: '/contact' };
    case 'ID_VERIFIED':
    case 'ADMIN_APPROVAL':
      return { label: 'Contact support', to: '/contact' };
    default:
      return null;
  }
}

/**
 * Qualification status (SCR-MEM-004, FR-REG-008, BR-QUAL-001). Renders the
 * server-authoritative requirement checklist from `GET /me/qualification` -
 * the UI never derives Active + Qualified client-side. A REJECTED member is
 * directed to resubmit (SCR-AUTH-005).
 */
export function QualificationStatusPage() {
  const qualificationQuery = useQualification();
  const [searchParams] = useSearchParams();
  const highlightKey = searchParams.get('highlight');

  // Deep-link highlight from guard: ?highlight=QUALIFICATION or ?highlight=unmet
  useEffect(() => {
    const data = qualificationQuery.data;
    if (!highlightKey || !data) return;
    const targetKey =
      highlightKey === 'unmet' ? data.requirements.find((r) => !r.met)?.key : highlightKey;
    if (!targetKey) return;
    const el = document.getElementById(`req-${targetKey}`);
    if (el) {
      el.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      (el as HTMLElement).setAttribute('tabindex', '-1');
      (el as HTMLElement).focus({ preventScroll: true });
      window.setTimeout(() => (el as HTMLElement).removeAttribute('tabindex'), 2000);
    }
  }, [highlightKey, qualificationQuery.data]);

  if (qualificationQuery.isLoading) {
    return (
      <section>
        <PageHeader title="Qualification status" />
        <div className={styles.loading} role="status" aria-live="polite" aria-busy="true">
          <div className={styles.panel}>
            <Skeleton style={{ height: 24, width: '40%' }} />
            <Skeleton style={{ height: 12, width: '100%' }} />
            <Skeleton style={{ height: 12, width: '85%' }} />
            <Skeleton style={{ height: 24 }} />
            <Skeleton style={{ height: 24 }} />
            <Skeleton style={{ height: 24 }} />
            <Skeleton style={{ height: 24 }} />
            <Skeleton style={{ height: 24 }} />
          </div>
        </div>
      </section>
    );
  }

  if (qualificationQuery.isError || !qualificationQuery.data) {
    return (
      <section>
        <PageHeader title="Qualification status" />
        <ErrorState
          error={qualificationQuery.error}
          title="Could not load your qualification status"
          onRetry={() => void qualificationQuery.refetch()}
        />
      </section>
    );
  }

  const summary = qualificationQuery.data;
  const total = summary.requirements.length;
  const metCount = summary.requirements.filter((r) => r.met).length;
  const progressPercent = total > 0 ? Math.round((metCount / total) * 100) : 0;

  return (
    <section className={styles.page}>
      <PageHeader
        title="Qualification status"
        description={`Membership status: ${memberStatusLabel(summary.status)}`}
      />

      <div className={styles.stack}>
        {summary.status === 'REJECTED' ? (
          <Alert variant="danger" title="Your application was not approved">
            {summary.rejectionReason ?? 'Your application was not approved.'}{' '}
            <Link className={styles.alertLink} to="/member/resubmit">
              Resubmit your application
            </Link>
          </Alert>
        ) : null}

        {summary.status === 'PENDING' ? (
          <Alert variant="info" title="Application pending">
            Your application is under review. JA&amp;D Admin will verify your ID and approve your
            account. Complete the remaining requirements below to move forward.
          </Alert>
        ) : null}

        {summary.status === 'APPROVED_ACTIVE' && !summary.isQualified ? (
          <Alert variant="warning" title="Active but not yet qualified">
            You’re Active - complete the remaining requirements below to unlock sales and referrals.
            See{' '}
            <Link className={styles.alertLink} to="/member/policies">
              Policies
            </Link>{' '}
            for guidance (qualification questions TBD OD-002).
          </Alert>
        ) : null}

        <div className={styles.panel}>
          <div className={styles.header}>
            <h2 className={styles.title}>Eligibility</h2>
            <StatusChip
              label={summary.isQualified ? 'Qualified' : 'Not qualified'}
              tone={summary.isQualified ? 'success' : 'warning'}
            />
          </div>

          <div className={styles.progressRow} aria-live="polite">
            <div className={styles.progressMeta}>
              <span className={styles.progressText}>
                {metCount} of {total} requirements met
              </span>
              <span className={styles.progressPercent} aria-hidden="true">
                {progressPercent}%
              </span>
            </div>
            <div
              className={styles.progressTrack}
              role="progressbar"
              aria-valuenow={metCount}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-label={`${metCount} of ${total} requirements met`}
            >
              <div className={styles.progressFill} style={{ width: `${progressPercent}%` }} />
            </div>
          </div>

          <ul className={styles.requirements} role="list" aria-label="Qualification requirements">
            {summary.requirements.map((requirement) => {
              const action = requirementAction(requirement.key, requirement.met);
              const isHighlighted =
                highlightKey !== null &&
                (highlightKey === requirement.key ||
                  (highlightKey === 'unmet' &&
                    requirement.key === summary.requirements.find((r) => !r.met)?.key));
              return (
                <li
                  key={requirement.key}
                  id={`req-${requirement.key}`}
                  className={`${styles.requirement} ${requirement.met ? styles.requirementMet : styles.requirementUnmet} ${isHighlighted ? styles.highlighted : ''}`}
                  aria-label={`${requirement.met ? 'Completed' : 'Not completed'}: ${requirement.label}`}
                >
                  <span
                    className={`${styles.marker} ${requirement.met ? styles.markerMet : styles.markerUnmet}`}
                    aria-hidden="true"
                  >
                    {requirement.met ? '✓' : '○'}
                  </span>
                  <span className={styles.requirementText}>
                    <span className={styles.requirementLabel}>{requirement.label}</span>
                    {requirement.detail ? (
                      <span className={styles.requirementDetail}>{requirement.detail}</span>
                    ) : null}
                    {action ? (
                      <Link className={styles.requirementAction} to={action.to}>
                        {action.label} →
                      </Link>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>

          {summary.isQualified ? (
            <EmptyState
              title="You are Active + Qualified"
              description="You can submit qualifying sales and refer new members."
              action={
                <div className={styles.ctaRow}>
                  <ButtonLink to="/member/sales/new">Submit a sale</ButtonLink>
                  <ButtonLink variant="secondary" to="/member/referrals">
                    View referral code
                  </ButtonLink>
                </div>
              }
            />
          ) : (
            <p className={styles.helpNote}>
              Need help? See <Link to="/member/policies">Policies</Link> or{' '}
              <Link to="/contact">contact JA&amp;D</Link> for guidance.
            </p>
          )}

          <p className={styles.meta}>
            Last checked{' '}
            {qualificationQuery.dataUpdatedAt
              ? new Date(qualificationQuery.dataUpdatedAt).toLocaleString('en-PH', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })
              : 'just now'}{' '}
            • <Link to="/member/policies">Policies</Link> • <Link to="/contact">Contact</Link>
          </p>
        </div>
      </div>
    </section>
  );
}
