import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, Dialog, ErrorState, PageHeader, QrCode, StatusChip } from '@jad/ui';
import type { ReissuedMembershipCard } from '@jad/contracts';

import { useSession } from '../../lib/session';
import { formatDateTime } from '../../lib/format';
import { getMembershipCard, markMembershipPrinted, reissueMembershipCard } from './services';

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

  const canReissue =
    user?.afHomesPermissions.some(
      (p) => p.moduleKey === 'finance.card_activation' && p.canUpdate,
    ) === true;

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

      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
        }}
      >
        <div>
          <dt>Tier</dt>
          <dd>
            {data.tierName} ({data.tierCode || '—'})
          </dd>
        </div>
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
          <dt>Activated</dt>
          <dd>{data.activatedAt ? formatDateTime(data.activatedAt) : '—'}</dd>
        </div>
        <div>
          <dt>Card issued</dt>
          <dd>{data.cardIssuedAt ? formatDateTime(data.cardIssuedAt) : 'Not recorded'}</dd>
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

      {canReissue ? (
        <div style={{ marginTop: 24, display: 'grid', gap: 12, maxWidth: 560 }}>
          <h2>Rotate credentials</h2>
          <p>
            Issues a new QR and fallback code and invalidates the previous pair immediately.
            Balances and identity are unchanged. Do this for a lost, damaged or compromised card —
            not for a reprint.
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
              if (
                window.confirm(
                  'Rotate the credentials for this card? The previous codes stop working immediately.',
                )
              ) {
                reissue.mutate();
              }
            }}
            disabled={reissue.isPending || reason.trim().length < 5}
          >
            {reissue.isPending ? 'Rotating…' : 'Reissue credentials'}
          </Button>
        </div>
      ) : (
        <p style={{ marginTop: 24 }}>
          Credential rotation requires the card-activation update permission, which this account
          does not hold.
        </p>
      )}
      {outcome ? (
        <p role="status" style={{ marginTop: 16 }}>
          {outcome}
        </p>
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
