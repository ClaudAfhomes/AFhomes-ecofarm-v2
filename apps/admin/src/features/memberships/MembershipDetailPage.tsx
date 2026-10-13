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
  MetricCard,
  PageHeader,
  QrCode,
  Skeleton,
  StatusChip,
  TextAreaField,
} from '@afhomes/ui';
import type { ReissuedMembershipCard } from '@afhomes/contracts';
import { formatCountOrDash } from '@afhomes/shared';

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
      <section>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading card"
        >
          <span className="sr-only">Loading card…</span>
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 280 }} />
            <Skeleton style={{ height: 16, maxWidth: 420 }} />
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Skeleton style={{ height: 120 }} />
            <Skeleton style={{ height: 120 }} />
            <Skeleton style={{ height: 200 }} />
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
      <PageHeader
        title="Membership Card"
        description={`Card ${data.membershipNumber} · ${data.tierName}`}
        actions={
          <Button variant="secondary" onClick={() => navigate(`/admin/memberships/${id}/card`)}>
            Open printable card
          </Button>
        }
      />
      <p className={styles.backRow}>
        <Link to="/admin/memberships">← Back to memberships</Link>
      </p>

      <section className={styles.panel} aria-label="Membership summary">
        <h2 className={styles.panelTitle}>{data.memberName}</h2>
        <div className={styles.summary}>
          <MetricCard label="Points balance" value={formatCountOrDash(data.pointsBalance)} />
          <MetricCard
            label="Yearly entitlement"
            value={formatCountOrDash(data.yearlyPointsAllocated)}
          />
          <MetricCard label="Status" value={<StatusChip label={humanizeCode(data.status)} />} />
        </div>
        <dl className={styles.facts}>
          <div>
            <dt>Tier</dt>
            <dd>
              <TierBadge tier={tierCode || null} /> {data.tierName}
              {data.tierCode ? ` (${data.tierCode})` : ''}
            </dd>
          </div>
          <div>
            <dt>Category</dt>
            <dd>{data.categoryName ?? '—'}</dd>
          </div>
          <div>
            <dt>Customer account</dt>
            <dd>{data.customerStatus ? humanizeCode(data.customerStatus) : '—'}</dd>
          </div>
          <div>
            <dt>Valid until</dt>
            <dd>{data.expiresAt ? formatDateTime(data.expiresAt) : '—'}</dd>
          </div>
          <div>
            <dt>Activated</dt>
            <dd>{data.activatedAt ? formatDateTime(data.activatedAt) : '—'}</dd>
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

      <MembershipActivity
        id={id}
        number={data.membershipNumber}
        permissions={user?.afHomesPermissions ?? []}
      />

      <section className={styles.panel} aria-label="Card and credentials">
        <h2 className={styles.panelTitle}>Card / Credentials</h2>
        <p className={styles.panelNote}>
          Recording a print changes no credential. Rotating issues a new QR and fallback code and
          invalidates the previous pair immediately.
        </p>
        <dl className={styles.facts}>
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
              {data.lastPrintedAt
                ? `(last ${formatDateTime(data.lastPrintedAt)})`
                : '(never printed)'}
            </dd>
          </div>
        </dl>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => navigate(`/admin/memberships/${id}/card`)}>
            Open printable card
          </Button>
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

        <details>
          <summary>Security: credential recovery</summary>
          {canReissue ? (
            <div style={{ marginTop: 24, display: 'grid', gap: 12, maxWidth: 560 }}>
              <h3>Rotate credentials</h3>
              <p>
                Issues a new QR and fallback code and invalidates the previous pair immediately.
                Balances and identity are unchanged. Do this for a lost, damaged or compromised card
                — not for a reprint.
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
            <p style={{ marginTop: 24 }}>
              Credential rotation requires the card-activation update permission, which this account
              does not hold.
            </p>
          )}
        </details>
      </section>
      {outcome ? (
        <p role="status" style={{ marginTop: 16 }}>
          {outcome}
        </p>
      ) : null}

      {canSeeAudit ? (
        <section className={styles.panel} aria-label="Card history">
          <h2 className={styles.panelTitle}>History</h2>
          {history.isPending ? (
            <p role="status">
              <Skeleton style={{ height: 48 }} />
              <span className="sr-only">Loading history…</span>
            </p>
          ) : history.isError ? (
            <ErrorState
              error={history.error}
              title="Card history is unavailable right now"
              onRetry={() => void history.refetch()}
            />
          ) : history.data.data.length === 0 ? (
            <p className={styles.panelNote}>No card events recorded yet.</p>
          ) : (
            <ul className={styles.historyList}>
              {history.data.data.map((event) => (
                <li key={String(event.id)}>
                  {event.action} · {event.summary} ·{' '}
                  {event.createdAt ? formatDateTime(event.createdAt) : '—'}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

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
    return 'Check your connection and try again. If this continues, contact AF Homes support.';
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
