import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { Button, ErrorState, PageHeader, StatusChip } from '@jad/ui';

import { formatDateTime } from '../../lib/format';
import { approveOstApplication, getOstApplication, rejectOstApplication } from './services';

/**
 * OST application review. Approval is an explicitly-invoked, permission-gated
 * mutation: it creates the staff identity through the invitation flow, assigns
 * the OST role, inserts the member row and the SM -> OST genealogy edge, and
 * marks the application approved. The sponsor shown here is the frozen value
 * from submission; this screen offers no way to change it.
 */
export function OstApplicationDetailPage() {
  const { id = '' } = useParams();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['ost', 'application', id],
    queryFn: () => getOstApplication(id),
  });
  const [reason, setReason] = useState('');
  const [outcome, setOutcome] = useState<string | null>(null);

  const approve = useMutation({
    mutationFn: () => approveOstApplication(id),
    onSuccess: (member) => {
      setOutcome(`Approved. OST member ${member.ostNumber} created under ${member.sponsorName}.`);
      void client.invalidateQueries({ queryKey: ['ost'] });
    },
    onError: (cause) => setOutcome(cause instanceof Error ? cause.message : 'Approval failed.'),
  });

  const reject = useMutation({
    mutationFn: () => rejectOstApplication(id, reason.trim()),
    onSuccess: () => {
      setOutcome('Rejected.');
      setReason('');
      void client.invalidateQueries({ queryKey: ['ost'] });
    },
    onError: (cause) => setOutcome(cause instanceof Error ? cause.message : 'Rejection failed.'),
  });

  if (query.isPending) return <p role="status">Loading application…</p>;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;
  const app = query.data;
  const reviewable = ['submitted', 'under_review', 'changes_requested'].includes(app.status);

  return (
    <section>
      <PageHeader
        title={app.applicantName}
        description={`OST application · ${app.status.replace(/_/g, ' ')}`}
      />
      <p>
        <Link to="/admin/ost/applications">← Back to applications</Link>
      </p>
      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
        }}
      >
        <div>
          <dt>Email</dt>
          <dd>{app.email}</dd>
        </div>
        <div>
          <dt>Phone</dt>
          <dd>{app.phone}</dd>
        </div>
        <div>
          <dt>Date of birth</dt>
          <dd>{app.birthDate}</dd>
        </div>
        <div>
          <dt>Sponsor (frozen)</dt>
          <dd>{app.sponsorName}</dd>
        </div>
        <div>
          <dt>Referral code</dt>
          <dd>{app.referralCodeHint}</dd>
        </div>
        <div>
          <dt>Submitted</dt>
          <dd>{formatDateTime(app.submittedAt)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            <StatusChip
              label={app.status.replace(/_/g, ' ')}
              tone={app.status === 'approved' ? 'success' : 'neutral'}
            />
          </dd>
        </div>
        {app.reviewNotes ? (
          <div>
            <dt>Review notes</dt>
            <dd>{app.reviewNotes}</dd>
          </div>
        ) : null}
        {app.reviewedAt ? (
          <div>
            <dt>Reviewed</dt>
            <dd>{formatDateTime(app.reviewedAt)}</dd>
          </div>
        ) : null}
      </dl>

      {reviewable ? (
        <div style={{ marginTop: 24, display: 'grid', gap: 12, maxWidth: 560 }}>
          <Button
            onClick={() => {
              setOutcome(null);
              if (
                window.confirm(`Approve ${app.applicantName} as an OST under ${app.sponsorName}?`)
              )
                approve.mutate();
            }}
            disabled={approve.isPending || reject.isPending}
          >
            {approve.isPending ? 'Approving…' : 'Approve as OST'}
          </Button>
          <label>
            Rejection reason (required, min 5 characters)
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              style={{ width: '100%' }}
            />
          </label>
          <Button
            variant="secondary"
            onClick={() => {
              setOutcome(null);
              reject.mutate();
            }}
            disabled={reject.isPending || approve.isPending || reason.trim().length < 5}
          >
            {reject.isPending ? 'Rejecting…' : 'Reject application'}
          </Button>
        </div>
      ) : (
        <p style={{ marginTop: 24 }}>
          This application is {app.status.replace(/_/g, ' ')} and can no longer be reviewed.
        </p>
      )}
      {outcome ? (
        <p role="status" style={{ marginTop: 16 }}>
          {outcome}
        </p>
      ) : null}
    </section>
  );
}
