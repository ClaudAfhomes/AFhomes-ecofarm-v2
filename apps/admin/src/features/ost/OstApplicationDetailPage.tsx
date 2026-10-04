import { useState } from 'react';
import { useSession } from '../../lib/session';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { Button, ConfirmDialog, ErrorState, PageHeader, StatusChip } from '@jad/ui';
import { ostMemberSchema } from '@jad/contracts';

import { formatDateTime } from '../../lib/format';
import {
  approveOstApplication,
  getOstApplication,
  rejectOstApplication,
  requestOstApplicationChanges,
  getAccreditation,
  endorseAccreditation,
  confirmAccreditationSignatures,
  approveAccreditation,
  reviewAccreditation,
} from './services';
import {
  ACCEPTED_MIME,
  MAX_BYTES,
  getDocuments,
  putUploadBytes,
  requestUploadGrant,
} from '../documents/services';

/**
 * OST application review. Approval is an explicitly-invoked, permission-gated
 * mutation: it creates the staff identity through the invitation flow, assigns
 * the OST role, inserts the member row and the SM -> OST genealogy edge, and
 * marks the application approved. The sponsor shown here is the frozen value
 * from submission; this screen offers no way to change it.
 */
export function OstApplicationDetailPage() {
  const { user } = useSession();
  const management =
    ['admin', 'super_admin', 'senior_sales_manager', 'vice_director'].includes(
      user?.roleSlug ?? '',
    ) &&
    user?.afHomesPermissions?.some(
      (p) => p.moduleKey === 'network.ost_registrations' && p.canUpdate,
    );
  const { id = '' } = useParams();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['ost', 'application', id],
    queryFn: () => getOstApplication(id),
  });
  const [reason, setReason] = useState('');
  const [signedOn, setSignedOn] = useState('');
  const [applicantSignedOn, setApplicantSignedOn] = useState('');
  const signatures = useMutation({
    mutationFn: () => confirmAccreditationSignatures(id, applicantSignedOn, signedOn),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['ost'] });
      setOutcome('Paper signatures confirmed. Sponsoring Sales Manager endorsement is required.');
    },
  });
  const [outcome, setOutcome] = useState<string | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [startsOn, setStartsOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const records = useQuery({
    queryKey: ['ost', 'application-accreditation', id],
    queryFn: () => getAccreditation('applications', id),
  });
  const official = Boolean(records.data?.registration);
  const endorsement = useMutation({
    mutationFn: () => endorseAccreditation(id, signedOn),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['ost'] });
      setOutcome('Sales Manager endorsement recorded.');
    },
  });

  const approve = useMutation({
    mutationFn: () =>
      official ? approveAccreditation(id, startsOn, expiresOn) : approveOstApplication(id),
    onSuccess: (member) => {
      const legacy = ostMemberSchema.safeParse(member);
      setOutcome(
        legacy.success
          ? `Approved. OST member ${legacy.data.ostNumber} created under ${legacy.data.sponsorName}.`
          : 'Accreditation approved and invitation issued.',
      );
      void client.invalidateQueries({ queryKey: ['ost'] });
    },
    onError: (cause) => setOutcome(cause instanceof Error ? cause.message : 'Approval failed.'),
  });

  const reject = useMutation({
    mutationFn: () =>
      official
        ? reviewAccreditation(id, 'reject', reason.trim())
        : rejectOstApplication(id, reason.trim()),
    onSuccess: () => {
      setOutcome('Rejected.');
      setReason('');
      void client.invalidateQueries({ queryKey: ['ost'] });
    },
    onError: (cause) => setOutcome(cause instanceof Error ? cause.message : 'Rejection failed.'),
  });

  const requestChanges = useMutation({
    mutationFn: () =>
      official
        ? reviewAccreditation(id, 'request-changes', reason.trim())
        : requestOstApplicationChanges(id, reason.trim()),
    onSuccess: () => {
      setOutcome('Changes requested.');
      setReason('');
      void client.invalidateQueries({ queryKey: ['ost'] });
    },
    onError: (cause) =>
      setOutcome(cause instanceof Error ? cause.message : 'Change request failed.'),
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
          {official && (
            <>
              <h2>Official accreditation review</h2>
              <p>
                Form {records.data?.registration?.form_number}. Applicant signature:{' '}
                {records.data?.registration?.applicant_signature_status}. Referrer signature:{' '}
                {records.data?.registration?.referrer_signature_status}. Endorsement:{' '}
                {records.data?.registration?.endorsed_at ? 'Received' : 'Pending'}.
              </p>
              <label>
                Actual referrer signature date
                <input
                  type="date"
                  max={new Date().toISOString().slice(0, 10)}
                  value={signedOn}
                  onChange={(e) => setSignedOn(e.target.value)}
                />
              </label>
              <label>
                Actual applicant signature date
                <input
                  type="date"
                  max={new Date().toISOString().slice(0, 10)}
                  value={applicantSignedOn}
                  onChange={(e) => setApplicantSignedOn(e.target.value)}
                />
              </label>
              <Button
                variant="secondary"
                disabled={
                  signatures.isPending ||
                  !signedOn ||
                  !applicantSignedOn ||
                  !(
                    management ||
                    (user?.roleSlug === 'sales_manager' && user?.id === app.sponsorStaffId)
                  )
                }
                onClick={() => signatures.mutate()}
              >
                Confirm received paper signatures
              </Button>
              <Button
                variant="secondary"
                disabled={
                  endorsement.isPending ||
                  user?.roleSlug !== 'sales_manager' ||
                  user?.id !== app.sponsorStaffId
                }
                onClick={() => endorsement.mutate()}
              >
                Endorse as sponsoring Sales Manager
              </Button>
              <label>
                Management-approved start
                <input
                  type="date"
                  required
                  value={startsOn}
                  onChange={(e) => setStartsOn(e.target.value)}
                />
              </label>
              <label>
                Management-approved expiry
                <input
                  type="date"
                  required
                  min={startsOn}
                  value={expiresOn}
                  onChange={(e) => setExpiresOn(e.target.value)}
                />
              </label>
              <p>No default accreditation duration is configured. Use management-approved dates.</p>
              {endorsement.isError && <p role="alert">{endorsement.error.message}</p>}
              {signatures.isError && <p role="alert">{signatures.error.message}</p>}
            </>
          )}
          <Button
            onClick={() => {
              setOutcome(null);
              setConfirmApprove(true);
            }}
            disabled={
              (official && !management) ||
              approve.isPending ||
              reject.isPending ||
              requestChanges.isPending ||
              (official && (!startsOn || !expiresOn || !records.data?.registration?.endorsed_at))
            }
          >
            {approve.isPending ? 'Approving…' : 'Approve as OST'}
          </Button>
          <ConfirmDialog
            open={confirmApprove}
            onCancel={() => setConfirmApprove(false)}
            onConfirm={() => {
              setConfirmApprove(false);
              approve.mutate();
            }}
            title="Approve this application?"
            message={`Approve ${app.applicantName} as an OST under ${app.sponsorName}?`}
            confirmLabel="Approve"
            cancelLabel="Cancel"
            confirmLoading={approve.isPending}
          />
          <label>
            Review notes (required for rejection or requested changes, min 5 characters)
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
              requestChanges.mutate();
            }}
            disabled={
              (official && !management) ||
              requestChanges.isPending ||
              reject.isPending ||
              approve.isPending ||
              reason.trim().length < 5 ||
              app.status === 'changes_requested'
            }
          >
            {requestChanges.isPending ? 'Requesting…' : 'Request changes'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setOutcome(null);
              reject.mutate();
            }}
            disabled={
              (official && !management) ||
              reject.isPending ||
              approve.isPending ||
              requestChanges.isPending ||
              reason.trim().length < 5
            }
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

      <ApplicationDocuments applicationId={id} />
    </section>
  );
}

/**
 * Identity scans bound to this application. Uploads land in the private OST
 * bucket through a server-issued grant; review (with masked values) happens
 * on the documents screen. Nothing uploaded here finalizes anything.
 */
function ApplicationDocuments({ applicationId }: { applicationId: string }) {
  const client = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const docs = useQuery({
    queryKey: ['documents', 'ost_application', applicationId],
    queryFn: () => getDocuments({ subjectType: 'ost_application', subjectId: applicationId }),
  });

  const upload = useMutation({
    mutationFn: async () => {
      setError(null);
      if (!file) throw new Error('Choose a file first.');
      if (!ACCEPTED_MIME.includes(file.type as (typeof ACCEPTED_MIME)[number])) {
        throw new Error('Only JPEG, PNG or PDF files are accepted.');
      }
      if (file.size === 0 || file.size > MAX_BYTES) {
        throw new Error('The file must be non-empty and at most 10 MiB.');
      }
      const grant = await requestUploadGrant({
        subjectType: 'ost_application',
        subjectId: applicationId,
        mime: file.type as (typeof ACCEPTED_MIME)[number],
        sizeBytes: file.size,
        originalFilename: file.name.slice(0, 255),
      });
      await putUploadBytes(grant.uploadUrl, file);
      return grant.documentId;
    },
    onSuccess: () => {
      setFile(null);
      void client.invalidateQueries({ queryKey: ['documents', 'ost_application', applicationId] });
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Upload failed.'),
  });

  return (
    <div style={{ marginTop: 32 }}>
      <h2>Identity documents</h2>
      {docs.isPending ? (
        <p role="status">Loading documents…</p>
      ) : docs.isError ? (
        <ErrorState error={docs.error} onRetry={docs.refetch} />
      ) : (docs.data ?? []).length === 0 ? (
        <p>No identity scans are attached to this application yet.</p>
      ) : (
        <ul>
          {(docs.data ?? []).map((doc) => (
            <li key={doc.id}>
              {doc.originalFilename} — {doc.verificationStatus.replace(/_/g, ' ')} ·{' '}
              <Link to={`/admin/documents/${doc.id}`}>Review</Link>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', gap: 12, alignItems: 'end', marginTop: 12, flexWrap: 'wrap' }}>
        <label>
          Attach an ID scan (JPEG, PNG or PDF, max 10 MiB)
          <input
            type="file"
            accept={ACCEPTED_MIME.join(',')}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <Button onClick={() => upload.mutate()} disabled={upload.isPending || !file}>
          {upload.isPending ? 'Uploading…' : 'Upload scan'}
        </Button>
      </div>
      {error ? (
        <p role="alert" style={{ color: 'var(--color-danger)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
