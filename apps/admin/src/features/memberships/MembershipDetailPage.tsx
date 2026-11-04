import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { Link, useNavigate, useParams } from 'react-router';
import {
  Alert,
  Button,
  ConfirmDialog,
  Dialog,
  ErrorState,
  Icon,
  PageHeader,
  QrCode,
  Skeleton,
  StatusChip,
  TextAreaField,
  type StatusTone,
} from '@afhomes/ui';
import type { ReissuedMembershipCard } from '@afhomes/contracts';
import { formatCountOrDash, isFeaturePathEnabled } from '@afhomes/shared';

import { ApiError, ApiNetworkError, ApiParseError } from '../../lib/api/errors';
import { useSession } from '../../lib/session';
import { formatDateTime } from '../../lib/format';
import { humanizeCode } from '../business/format';
import { membershipKeys } from '../business/queryKeys';
import { TierBadge } from '../business/TierBadge';
import { getAudit } from '../reports/services';
import { getMembershipCard, markMembershipPrinted, reissueMembershipCard } from './services';
import { MembershipActivity } from './MembershipActivity';
import styles from './MembershipDetailPage.module.css';

const STATUS_TONE: Record<string, StatusTone> = {
  active: 'success',
  expired: 'warning',
  suspended: 'warning',
  cancelled: 'danger',
};

/**
 * One membership's card operations.
 *
 * Two operations that must never be confused:
 *
 * - PRINT records that a physical card was produced. It changes no
 *   credential; reprinting the same codes later is only possible while the
 *   once-only plaintext is still on screen.
 * - REISSUE rotates the QR and fallback code. The previous pair stops working
 *   immediately and the new pair is shown exactly once for immediate printing.
 *
 * The reissue control is rendered only for staff holding the card-activation
 * update grant; the server re-checks regardless. Guards here are UX only.
 */
export function MembershipDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { user } = useSession();
  const card = useQuery({
    queryKey: membershipKeys.card(id),
    queryFn: () => getMembershipCard(id),
    // A print recorded on the print screen updates this view in place.
    placeholderData: keepPreviousData,
  });
  const [reason, setReason] = useState('');
  const [issued, setIssued] = useState<ReissuedMembershipCard | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [confirmReissue, setConfirmReissue] = useState(false);

  const canReissue =
    user?.afHomesPermissions.some(
      (p) => p.moduleKey === 'finance.card_activation' && p.canUpdate,
    ) === true;
  const canSeeAudit =
    isFeaturePathEnabled('/api/v1/reports/audit') &&
    user?.afHomesPermissions.some((p) => p.moduleKey === 'governance.audit' && p.canView) === true;
  const history = useQuery({
    queryKey: membershipKeys.history(id),
    queryFn: () => getAudit({ entityType: 'membership', entityId: id, limit: 20 }),
    enabled: canSeeAudit,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const reissue = useBusinessMutation({
    mutationFn: () => reissueMembershipCard(id, reason.trim()),
    onSuccess: (next) => {
      // Plaintext lives in state until the dialog closes: never stored,
      // never logged, never re-fetched.
      setIssued(next);
      setReason('');
      setOutcome(null);
      void client.invalidateQueries({ queryKey: membershipKeys.card(id) });
      void client.invalidateQueries({ queryKey: membershipKeys.scope });
    },
    onError: (cause) => setOutcome(cause instanceof Error ? cause.message : 'Reissue failed.'),
  });

  const markPrinted = useBusinessMutation({
    mutationFn: () => markMembershipPrinted(id),
    onSuccess: (next) => {
      setOutcome(
        next.reprint ? `Reprint recorded (print #${next.printCount}).` : 'First print recorded.',
      );
      void client.invalidateQueries({ queryKey: membershipKeys.card(id) });
      void client.invalidateQueries({ queryKey: membershipKeys.scope });
    },
    onError: (cause) =>
      setOutcome(cause instanceof Error ? cause.message : 'Print was not recorded.'),
  });

  // First load skeletonizes the whole page so no static content flashes
  // before the card it describes. Refetches keep the card visible and never
  // reach this branch. The sr-only line keeps the exact pending copy.
  if (card.isPending)
    return (
      <section className={styles.page}>
        <div className={styles.skeleton} role="status" aria-label="Loading card">
          <span className="sr-only">Loading card…</span>
          <div className={styles.skeletonHead}>
            <Skeleton style={{ height: 32, maxWidth: 280 }} />
            <Skeleton style={{ height: 16, maxWidth: 320 }} />
          </div>
          <div className={styles.layout}>
            <Skeleton style={{ height: 220 }} />
            <div className={styles.aside}>
              <Skeleton style={{ height: 260 }} />
            </div>
            <Skeleton style={{ height: 120 }} />
          </div>
        </div>
      </section>
    );
  if (card.isError)
    return (
      <section className={styles.page}>
        <PageHeader
          title="Membership Card"
          description="The requested card could not be opened."
          actions={
            <Button variant="secondary" onClick={() => navigate('/admin/memberships')}>
              Back to memberships
            </Button>
          }
        />
        <ErrorState
          error={card.error}
          title="Card could not be loaded"
          message={describeCardLoadError(card.error)}
          onRetry={() => void card.refetch()}
        />
      </section>
    );
  const data = card.data;
  const tierCode = (data.tierCode ?? '').trim().toUpperCase();

  return (
    <section className={styles.page}>
      <Link to="/admin/memberships" className={styles.backLink}>
        <Icon name="chevron-left" size={16} aria-hidden="true" />
        Back to memberships
      </Link>
      <PageHeader
        title="Membership Card"
        description={`Card ${data.membershipNumber}, ${data.tierName} tier`}
        actions={
          <Button onClick={() => navigate(`/admin/memberships/${id}/card`)}>
            Open printable card
          </Button>
        }
      />

      <div className={styles.layout}>
        <section className={`${styles.panel} ${styles.hero}`} aria-label="Membership summary">
          <div className={styles.heroHead}>
            <span className={styles.avatar} aria-hidden="true">
              {(data.memberName.trim().charAt(0) || '•').toUpperCase()}
            </span>
            <div className={styles.heroIdentity}>
              <h2 className={styles.heroName}>{data.memberName}</h2>
              <span className={styles.heroTier}>
                <TierBadge tier={tierCode || null} />
                <span>
                  {data.tierName}
                  {data.tierCode ? ` (${data.tierCode})` : ''}
                </span>
              </span>
            </div>
            <StatusChip label={humanizeCode(data.status)} tone={STATUS_TONE[data.status]} />
          </div>
          <div className={styles.summary}>
            <StatusChip
              label={`Points balance: ${formatCountOrDash(data.pointsBalance)}`}
              tone="neutral"
              icon="wallet"
            />
            <StatusChip
              label={`Yearly entitlement: ${formatCountOrDash(data.yearlyPointsAllocated)}`}
              tone="neutral"
              icon="file-text"
            />
          </div>
          <dl className={styles.facts}>
            <div>
              <dt>Category</dt>
              <dd>{data.categoryName ?? '—'}</dd>
            </div>
            <div>
              <dt>Customer account</dt>
              <dd>{data.customerStatus ? humanizeCode(data.customerStatus) : '—'}</dd>
            </div>
            <div>
              <dt>Activated</dt>
              <dd>{data.activatedAt ? formatDateTime(data.activatedAt) : '—'}</dd>
            </div>
            <div>
              <dt>Valid until</dt>
              <dd>{data.expiresAt ? formatDateTime(data.expiresAt) : '—'}</dd>
            </div>
            <div>
              <dt>Validity</dt>
              <dd>
                {data.validityYears
                  ? `Valid for ${data.validityYears} year${data.validityYears === 1 ? '' : 's'}`
                  : '—'}
              </dd>
            </div>
          </dl>
        </section>

        <aside className={styles.aside}>
          <section className={styles.panel} aria-label="Card and credentials">
            <h2 className={styles.panelTitle}>Card and credentials</h2>
            <p className={styles.panelNote}>
              Printing never changes codes. Rotating replaces both codes.
            </p>
            <dl className={`${styles.facts} ${styles.factsTight}`}>
              <div>
                <dt>Card issued</dt>
                <dd>{data.cardIssuedAt ? formatDateTime(data.cardIssuedAt) : 'Not recorded'}</dd>
              </div>
              <div>
                <dt>Issued by</dt>
                <dd>{data.issuedBy ?? '—'}</dd>
              </div>
              <div>
                <dt>Prints</dt>
                <dd>
                  {formatCountOrDash(data.printCount)}{' '}
                  <span className={styles.ddNote}>
                    {data.lastPrintedAt
                      ? `(last ${formatDateTime(data.lastPrintedAt)})`
                      : '(never printed)'}
                  </span>
                </dd>
              </div>
            </dl>
            <div className={styles.actions}>
              <Button
                variant="secondary"
                onClick={() => {
                  setOutcome(null);
                  markPrinted.mutate();
                }}
                disabled={markPrinted.isPending}
              >
                {markPrinted.isPending ? 'Recording…' : 'Record a print (no code change)'}
              </Button>
            </div>
            {outcome ? (
              <p role="status" className={styles.outcome}>
                {outcome}
              </p>
            ) : null}

            <details className={styles.security}>
              <summary>
                <Icon name="alert" size={16} aria-hidden="true" />
                Security: credential recovery
              </summary>
              {canReissue ? (
                <div className={styles.securityBody}>
                  <h3 className={styles.securityTitle}>Rotate credentials</h3>
                  <p className={styles.panelNote}>
                    Use for lost or damaged cards. Not for reprints. Old codes stop working
                    immediately. Balances stay unchanged.
                  </p>
                  <TextAreaField
                    id="membership-rotate-reason"
                    name="rotateReason"
                    label="Reason (required, min 5 characters)"
                    optional
                    value={reason}
                    onChange={setReason}
                    rows={3}
                  />
                  <Button
                    onClick={() => {
                      setOutcome(null);
                      setConfirmReissue(true);
                    }}
                    disabled={reissue.isPending || reason.trim().length < 5}
                  >
                    {reissue.isPending ? 'Rotating…' : 'Reissue credentials'}
                  </Button>
                  <ConfirmDialog
                    open={confirmReissue}
                    onCancel={() => setConfirmReissue(false)}
                    onConfirm={() => {
                      setConfirmReissue(false);
                      reissue.mutate();
                    }}
                    title="Reissue credentials?"
                    message="Rotate the credentials for this card? The previous codes stop working immediately."
                    confirmLabel="Reissue"
                    cancelLabel="Cancel"
                    confirmLoading={reissue.isPending}
                  />
                </div>
              ) : (
                <p className={`${styles.panelNote} ${styles.securityBody}`}>
                  Rotation needs card-activation update access.
                </p>
              )}
            </details>
          </section>
        </aside>

        <section className={styles.section} aria-label="Card activity">
          <h2 className={styles.sectionTitle}>Activity</h2>
          <MembershipActivity
            id={id}
            number={data.membershipNumber}
            permissions={user?.afHomesPermissions ?? []}
          />
        </section>

        {canSeeAudit ? (
          <section className={styles.panel} aria-label="Card history">
            <h2 className={styles.panelTitle}>History</h2>
            {history.isPending ? (
              <div role="status">
                <Skeleton style={{ height: 48 }} />
                <span className="sr-only">Loading history…</span>
              </div>
            ) : history.isError ? (
              <ErrorState
                error={history.error}
                title="Card history is unavailable right now"
                onRetry={() => void history.refetch()}
              />
            ) : history.data.data.length === 0 ? (
              <p className={styles.panelNote}>No card events recorded yet.</p>
            ) : (
              <ol className={styles.historyList}>
                {history.data.data.map((event) => (
                  <li key={String(event.id)}>
                    <span className={styles.historySummary}>{event.summary}</span>
                    <code className={styles.historyAction}>{event.action}</code>
                    {event.createdAt ? (
                      <time dateTime={event.createdAt} className={styles.historyTime}>
                        {formatDateTime(event.createdAt)}
                      </time>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>
        ) : null}
      </div>

      <Dialog
        open={issued !== null}
        onClose={() => setIssued(null)}
        title="New card codes — shown once"
        footer={
          <>
            <Button variant="secondary" onClick={() => setIssued(null)}>
              Close
            </Button>
            <Button
              onClick={() =>
                navigate(`/admin/memberships/${id}/card`, {
                  state: issued
                    ? { fallbackCode: issued.fallbackCode, qrToken: issued.qrToken }
                    : undefined,
                })
              }
            >
              Print with new codes
            </Button>
          </>
        }
      >
        {issued && (
          <div className={styles.qrWrap}>
            <QrCode
              value={issued.qrToken}
              alt={`Member QR for ${issued.membershipNumber}`}
              size={160}
            />
            <Alert variant="warning" title="Shown once">
              Closing this dialog without printing means requesting another rotation to print codes
              again. Previous codes stopped working immediately.
            </Alert>
            <p>
              Fallback member code: <code>{issued.fallbackCode}</code>
            </p>
          </div>
        )}
      </Dialog>
    </section>
  );
}

/**
 * Actionable card-load guidance per failure cause. Raw server internals are
 * never rendered (see `ErrorState`); each branch names the next step instead.
 * Returns `undefined` for unknown errors so the shared generic message applies.
 */
function describeCardLoadError(error: unknown): string | undefined {
  if (error instanceof ApiNetworkError)
    return 'Check your connection and try again. If this continues, contact AFhomes support.';
  if (error instanceof ApiError && error.status === 401)
    return 'Your session has expired. Sign in again, then retry.';
  if (error instanceof ApiError && error.status === 403)
    return 'Your account cannot open this card right now. Contact an administrator.';
  if (error instanceof ApiError && error.status === 404)
    return 'No card exists at this link. Check the address, or open the card from the memberships list.';
  if (error instanceof ApiParseError)
    return 'The saved record contains values this screen cannot display. Note the card number and ask an administrator to review the record.';
  return undefined;
}
