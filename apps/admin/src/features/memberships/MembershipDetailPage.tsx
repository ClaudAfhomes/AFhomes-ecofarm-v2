import styles from '../business/WorkflowCards.module.css';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, ConfirmDialog, Dialog, ErrorState, PageHeader, QrCode, StatusChip } from '@afhomes/ui';
import type { ReissuedMembershipCard } from '@afhomes/contracts';

import { useSession } from '../../lib/session';
import { formatDateTime } from '../../lib/format';
import { getAudit } from '../reports/services';
import { getMembershipCard, markMembershipPrinted, reissueMembershipCard } from './services';
import { MembershipActivity } from './MembershipActivity';

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
 * update grant; the server re-checks regardless.
 */
export function MembershipDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { user } = useSession();
  const card = useQuery({
    queryKey: ['memberships', id, 'card'],
    queryFn: () => getMembershipCard(id),
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
    queryKey: ['memberships', id, 'history'],
    queryFn: () => getAudit({ entityType: 'membership', entityId: id, limit: 20 }),
    enabled: canSeeAudit,
    retry: false,
  });

  const reissue = useMutation({
    mutationFn: () => reissueMembershipCard(id, reason.trim()),
    onSuccess: (next) => {
      // Plaintext lives in state until the dialog closes: never stored,
      // never logged, never re-fetched.
      setIssued(next);
      setReason('');
      setOutcome(null);
      void client.invalidateQueries({ queryKey: ['memberships', id] });
    },
    onError: (cause) => setOutcome(cause instanceof Error ? cause.message : 'Reissue failed.'),
  });

  const markPrinted = useMutation({
    mutationFn: () => markMembershipPrinted(id),
    onSuccess: (next) => {
      setOutcome(
        next.reprint ? `Reprint recorded (print #${next.printCount}).` : 'First print recorded.',
      );
      void client.invalidateQueries({ queryKey: ['memberships', id] });
    },
    onError: (cause) =>
      setOutcome(cause instanceof Error ? cause.message : 'Print was not recorded.'),
  });

  if (card.isPending) return <p role="status">Loading card…</p>;
  if (card.isError) return <ErrorState error={card.error} onRetry={card.refetch} />;
  const data = card.data;

  return (
    <section>
      <PageHeader
        title={data.memberName}
        description={`Card ${data.membershipNumber} · ${data.tierName}`}
      />
      <p>
        <Link to="/admin/memberships">← Back to memberships</Link>
      </p>

      <section className={styles.card} aria-label="Membership summary">
        <dl className={styles.facts}>
          {' '}
          <div>
            <dt>Status</dt>
            <dd>
              <StatusChip
                label={data.status}
                tone={data.status === 'active' ? 'success' : 'neutral'}
              />
            </dd>
          </div>
          <div>
            <dt>Points balance</dt>
            <dd>{data.pointsBalance.toLocaleString('en-PH')}</dd>
          </div>
          <div>
            <dt>Valid until</dt>
            <dd>{data.expiresAt ? formatDateTime(data.expiresAt) : '—'}</dd>
          </div>
        </dl>
      </section>
      <section className={styles.card}>
        <h2>Overview</h2>
        <dl className={styles.facts}>
          <div>
            <dt>Tier</dt>
            <dd>
              {data.tierName} ({data.tierCode || '—'})
            </dd>
          </div>
          <div>
            <dt>Category</dt>
            <dd>{data.categoryName ?? '—'}</dd>
          </div>
          <div>
            <dt>Customer account</dt>
            <dd>{data.customerStatus ?? '—'}</dd>
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
      <section className={styles.card}>
        <h2>Points entitlement</h2>
        <dl className={styles.facts}>
          {' '}
          <div>
            <dt>Yearly entitlement</dt>
            <dd>{data.yearlyPointsAllocated.toLocaleString('en-PH')}</dd>
          </div>
        </dl>
      </section>
      <MembershipActivity
        id={id}
        number={data.membershipNumber}
        permissions={user?.afHomesPermissions ?? []}
      />
      <section className={styles.card}>
        <h2>Card / Credentials</h2>
        <dl className={styles.facts}>
          {' '}
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
              {data.printCount}{' '}
              {data.lastPrintedAt
                ? `(last ${formatDateTime(data.lastPrintedAt)})`
                : '(never printed)'}
            </dd>
          </div>
        </dl>
        <div style={{ marginTop: 24, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
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
              <label>
                Reason (required, min 5 characters)
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  style={{ width: '100%' }}
                />
              </label>
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
        <div style={{ marginTop: 24 }}>
          <h2>History</h2>
          {history.isPending ? (
            <p role="status">Loading history…</p>
          ) : history.isError ? (
            <p role="alert">Card history is unavailable right now.</p>
          ) : history.data.data.length === 0 ? (
            <p>No card events recorded yet.</p>
          ) : (
            <ul>
              {history.data.data.map((event) => (
                <li key={String(event.id)}>
                  {event.action} · {event.summary} ·{' '}
                  {event.createdAt ? formatDateTime(event.createdAt) : '—'}
                </li>
              ))}
            </ul>
          )}
        </div>
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
          <div>
            <QrCode
              value={issued.qrToken}
              alt={`Member QR for ${issued.membershipNumber}`}
              size={160}
            />
            <p role="alert">
              <strong>Shown once.</strong> Closing this dialog without printing means requesting
              another rotation to print codes again. Previous codes stopped working immediately.
            </p>
            <p>
              Fallback member code: <code>{issued.fallbackCode}</code>
            </p>
          </div>
        )}
      </Dialog>
    </section>
  );
}
