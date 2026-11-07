import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  Button,
  DetailCard,
  DetailCardTitle,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusChip,
  buttonClassName,
} from '@afhomes/ui';
import type { StatusTone } from '@afhomes/ui';
import { formatCountOrDash, formatMoneyOrDash, formatStatedMoney } from '@afhomes/shared';
import type { CustomerImportContinuation } from '@afhomes/contracts';
import { useSession } from '../../lib/session';
import { canViewImportContinuations } from './import-continuation-access';
import { getImportContinuations } from './import-workflow-services';
import styles from './OfficialFormsPages.module.css';

const PAGE_SIZE = 25;

const STAGE_LABELS: Record<CustomerImportContinuation['stage'], string> = {
  application: 'Application',
  reservation: 'Reservation',
  finance: 'Finance',
  activation: 'Activation',
  active: 'Active VIP',
  inactive: 'Historical inactive VIP',
  complete: 'Complete',
  review: 'Needs review',
};

const STAGE_TONES: Record<CustomerImportContinuation['stage'], StatusTone> = {
  application: 'neutral',
  reservation: 'info',
  finance: 'warning',
  activation: 'info',
  active: 'success',
  inactive: 'neutral',
  complete: 'success',
  review: 'warning',
};

const STAGE_ACTION_LABELS: Record<CustomerImportContinuation['stage'], string> = {
  application: 'Complete application',
  reservation: 'Complete reservation',
  finance: 'Review payments',
  activation: 'Continue activation',
  active: 'View customer',
  inactive: 'View customer',
  complete: 'View customer',
  review: 'Review record',
};

const MAX_NOTE_WORDS = 6;

/** Keep every visible action label to two words. */
function continuationActionLabel(source: CustomerImportContinuation): string {
  const label = source.nextAction?.label.trim();
  if (label && label.split(/\s+/).length <= 2) return label;
  return STAGE_ACTION_LABELS[source.stage];
}

/** Long server notes are summarized so the card stays scannable. */
function shortNote(note: string): string {
  const words = note.trim().split(/\s+/);
  if (words.length <= MAX_NOTE_WORDS) return note;
  return `${words.slice(0, MAX_NOTE_WORDS).join(' ')}…`;
}

function ImportedPurchaseCard({
  source,
  canOpen,
}: {
  source: CustomerImportContinuation;
  canOpen: boolean;
}) {
  const statement = source.purchaseStatement;
  const verified = source.externallyVerified ? source.externalSummary : undefined;
  return (
    <article className={styles.purchaseCard}>
      <header className={styles.purchaseHeader}>
        <div className={styles.purchaseIdentity}>
          <h3 className={styles.purchaseName}>
            {source.customerName || 'Imported customer'}
          </h3>
          <p className={styles.purchaseReference}>
            {source.purchaseReference || 'Reference needs review'}
          </p>
        </div>
        <StatusChip label={STAGE_LABELS[source.stage]} tone={STAGE_TONES[source.stage]} />
      </header>
      {statement ? (
        <dl className={styles.purchaseFacts}>
          <div>
            <dt>Plan</dt>
            <dd>{statement.tier || 'Not stated'}</dd>
          </div>
          <div>
            <dt>Contract total</dt>
            <dd>{formatStatedMoney(statement.total)}</dd>
          </div>
          <div>
            <dt>Reservation fee</dt>
            <dd>{formatStatedMoney(statement.reservationFee)}</dd>
          </div>
        </dl>
      ) : null}
      <div
        className={
          verified
            ? styles.purchasePayment
            : `${styles.purchasePayment} ${styles.purchasePaymentReview}`
        }
      >
        {verified ? (
          <>
            <span className={styles.purchasePaymentLead}>External payments accepted</span>
            <span>Paid {formatMoneyOrDash(verified.paid)}</span>
            <span>Balance {formatMoneyOrDash(verified.balance)}</span>
          </>
        ) : (
          <>
            <span className={styles.purchasePaymentLead}>
              {formatCountOrDash(source.claimCount)} imported{' '}
              {source.claimCount === 1 ? 'claim' : 'claims'}
            </span>
            <span>Finance review and verification required.</span>
          </>
        )}
      </div>
      {source.missingRequirements.length ? (
        <section className={styles.purchaseNotice} aria-label="Missing requirements">
          <h4 className={styles.purchaseNoticeTitle}>Missing requirements</h4>
          <ul className={styles.purchaseList}>
            {source.missingRequirements.map((item) => (
              <li key={item}>{shortNote(item)}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {source.conflicts.length ? (
        <section
          className={`${styles.purchaseNotice} ${styles.purchaseConflict}`}
          aria-label="Conflicts"
        >
          <h4 className={styles.purchaseNoticeTitle}>Conflicts</h4>
          <ul className={styles.purchaseList}>
            {source.conflicts.map((item) => (
              <li key={item.field}>{shortNote(item.message)}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {source.nextAction && canOpen ? (
        <footer className={styles.purchaseFooter}>
          <Link className={buttonClassName('secondary', 'sm')} to={source.nextAction.path}>
            {continuationActionLabel(source)}
          </Link>
        </footer>
      ) : null}
    </article>
  );
}

function ImportedPurchasesLoading() {
  return (
    <div className={styles.purchaseGrid} role="status" aria-label="Loading imported purchases">
      {[0, 1, 2].map((key) => (
        <Skeleton key={key} style={{ height: 240 }} />
      ))}
    </div>
  );
}

export function ImportContinuationPanel({
  customerId,
  variant = 'compact',
}: {
  customerId?: string;
  variant?: 'compact' | 'page';
}) {
  const [offset, setOffset] = useState(0);
  const headingId = useId();
  const { user } = useSession();
  const allowed = canViewImportContinuations(user);
  const grant = (
    moduleKey: string,
    action: 'canView' | 'canCreate' | 'canUpdate',
  ): boolean =>
    user?.roleSlug === 'super_admin' ||
    user?.afHomesPermissions.some((p) => p.moduleKey === moduleKey && p[action]) === true;
  const canOpen = (source: CustomerImportContinuation) => {
    if (source.stage === 'review' || source.stage === 'complete') return true;
    if (source.stage === 'application')
      return (
        Boolean(source.applicationId) ||
        (grant('sales.customers', 'canCreate') && grant('governance.customer_import', 'canUpdate'))
      );
    if (source.stage === 'reservation') return grant('sales.card_sales', 'canView');
    return grant(
      source.stage === 'activation' ? 'finance.card_activation' : 'finance.payment_verification',
      'canView',
    );
  };
  const query = useQuery({
    queryKey: ['customer-import-continuations', customerId, offset],
    queryFn: () => getImportContinuations(customerId, offset),
    enabled: allowed,
  });
  if (!allowed) return null;
  if (variant === 'page') {
    return (
      <section className={styles.importsView} aria-labelledby={headingId}>
        <header className={styles.importsHeader}>
          <div>
            <h2 className={styles.importsTitle} id={headingId}>
              Imported purchases
            </h2>
            <p className={styles.importsDescription}>Workbook purchases awaiting completion.</p>
          </div>
          {query.data?.length ? (
            <span className={styles.importsPageCount}>
              {formatCountOrDash(query.data.length)} on this page
            </span>
          ) : null}
        </header>
        {query.isPending ? <ImportedPurchasesLoading /> : null}
        {query.error ? (
          <ErrorState
            title="Imported purchases could not be loaded"
            message="Please try again."
            onRetry={() => void query.refetch()}
          />
        ) : null}
        {!query.isPending && !query.error && query.data?.length ? (
          <div className={styles.purchaseGrid}>
            {query.data.map((source) => (
              <ImportedPurchaseCard
                key={source.rowId}
                source={source}
                canOpen={canOpen(source)}
              />
            ))}
          </div>
        ) : null}
        {!query.isPending && !query.error && !query.data?.length ? (
          <EmptyState
            title="No imported purchases"
            description="Nothing waiting from the workbook."
          />
        ) : null}
        {!query.isPending &&
        !query.error &&
        (offset > 0 || query.data?.length === PAGE_SIZE) ? (
          <div className={styles.purchasePaging}>
            {offset > 0 ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setOffset((n) => Math.max(0, n - PAGE_SIZE))}
              >
                Previous
              </Button>
            ) : null}
            {query.data?.length === PAGE_SIZE ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setOffset((n) => n + PAGE_SIZE)}
              >
                More
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  }
  if (offset === 0 && !query.isPending && !query.error && !query.data?.length) return null;
  return (
    <DetailCard>
      <DetailCardTitle>Imported purchases</DetailCardTitle>
      {query.isPending ? <p>Loading continuation…</p> : null}
      {query.error ? (
        <ErrorState
          title="Could not load imported purchases"
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {query.data?.map((source) => (
        <div key={source.rowId}>
          <h3>
            {source.customerName || 'Imported customer'} ·{' '}
            {source.purchaseReference || 'Purchase reference needs review'}
          </h3>
          {source.purchaseStatement ? (
            <p>
              Workbook claim: {source.purchaseStatement.tier || 'Plan not stated'} · Contract total{' '}
              {source.purchaseStatement.total || 'not stated'} · Included reservation fee{' '}
              {source.purchaseStatement.reservationFee || 'not stated'}.
            </p>
          ) : null}
          <p>
            Next stage: {source.stage}.{' '}
            {source.externallyVerified && source.externalSummary
              ? `External history accepted. Verified payments: ${source.externalSummary.paid}. Remaining balance: ${source.externalSummary.balance}.`
              : `Imported payment claims: ${source.claimCount}. Claims require Finance review and separate payment verification.`}
          </p>
          {source.missingRequirements.length ? (
            <ul>
              {source.missingRequirements.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          {source.conflicts.length ? (
            <ul>
              {source.conflicts.map((item) => (
                <li key={item.field}>
                  {item.field}: {item.message}
                </li>
              ))}
            </ul>
          ) : null}
          {source.nextAction && canOpen(source) ? (
            <Link to={source.nextAction.path}>{continuationActionLabel(source)}</Link>
          ) : null}
        </div>
      ))}
      {offset > 0 ? (
        <Button variant="secondary" onClick={() => setOffset((n) => Math.max(0, n - PAGE_SIZE))}>
          Previous
        </Button>
      ) : null}
      {query.data?.length === PAGE_SIZE ? (
        <Button variant="secondary" onClick={() => setOffset((n) => n + PAGE_SIZE)}>
          More
        </Button>
      ) : null}
    </DetailCard>
  );
}
