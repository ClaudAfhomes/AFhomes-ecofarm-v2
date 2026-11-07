import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { useSession } from '../../lib/session';
import { Link, useNavigate, useParams } from 'react-router';
import {
  Alert,
  Button,
  ConfirmDialog,
  DateField,
  DetailCard,
  DetailCardTitle,
  DetailField,
  DetailFieldGrid,
  Dialog,
  EmptyState,
  ErrorState,
  FileField,
  PageHeader,
  PasswordField,
  ProfilePhotoEditor,
  Skeleton,
  StatusChip,
  TextAreaField,
} from '@afhomes/ui';
import { ostMemberSchema } from '@afhomes/contracts';

import { formatDateTime } from '../../lib/format';
import styles from './OstApplicationDetailPage.module.css';
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

/** Query keys scoped to the OST application detail. */
const ostDetailKeys = {
  detail: (id: string) => ['ost', 'application', id] as const,
  accreditation: (id: string) => ['ost', 'application-accreditation', id] as const,
};

const statusLabel = (status: string) =>
  status.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());

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
  const navigate = useNavigate();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ostDetailKeys.detail(id),
    queryFn: () => getOstApplication(id),
    placeholderData: keepPreviousData,
  });
  const [reason, setReason] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState({ applicationId: '', data: '' });
  const profilePhotoBase64 = selectedPhoto.applicationId === id ? selectedPhoto.data : '';
  const [signedOn, setSignedOn] = useState('');
  const [applicantSignedOn, setApplicantSignedOn] = useState('');
  const [recordOpen, setRecordOpen] = useState(false);
  const signatures = useBusinessMutation({
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
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const records = useQuery({
    queryKey: ostDetailKeys.accreditation(id),
    queryFn: () => getAccreditation('applications', id),
    placeholderData: keepPreviousData,
  });
  const official = Boolean(records.data?.registration);
  const endorsement = useBusinessMutation({
    mutationFn: () => endorseAccreditation(id, signedOn),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['ost'] });
      setOutcome('Sales Manager endorsement recorded.');
    },
  });

  const approve = useBusinessMutation({
    mutationFn: () =>
      official
        ? approveAccreditation(id, startsOn, expiresOn, temporaryPassword, profilePhotoBase64)
        : approveOstApplication(id, temporaryPassword, profilePhotoBase64),
    onSuccess: (member) => {
      setTemporaryPassword('');
      setConfirmPassword('');
      const legacy = ostMemberSchema.safeParse(member);
      setOutcome(
        legacy.success
          ? `Approved. OST member ${legacy.data.ostNumber} created under ${legacy.data.sponsorName}.`
          : 'Accreditation approved. Provide the temporary password to the OST for first sign-in.',
      );
      void client.invalidateQueries({ queryKey: ['ost'] });
    },
    onError: (cause) => setOutcome(cause instanceof Error ? cause.message : 'Approval failed.'),
  });

  const reject = useBusinessMutation({
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

  const requestChanges = useBusinessMutation({
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

  if (query.isPending) {
    return (
      <section>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading application"
        >
          <Skeleton style={{ height: 32, maxWidth: 280 }} />
          <Skeleton style={{ height: 16, maxWidth: 460 }} />
          <Skeleton style={{ height: 120 }} />
          <Skeleton style={{ height: 96 }} />
          <span className="sr-only">Loading application…</span>
        </div>
      </section>
    );
  }
  if (query.isError) {
    return (
      <section className={styles.page}>
        <PageHeader
          title="OST Application"
          description="The requested application could not be opened."
          actions={
            <Button variant="secondary" onClick={() => navigate('/admin/ost/applications')}>
              Back to applications
            </Button>
          }
        />
        <ErrorState
          error={query.error}
          title="OST application could not be loaded"
          onRetry={() => void query.refetch()}
        />
      </section>
    );
  }
  const app = query.data;
  const reviewable = ['submitted', 'under_review', 'changes_requested'].includes(app.status);

  return (
    <section className={styles.page}>
      <PageHeader
        title="OST Application"
        description={`Review for ${statusLabel(app.status)} applications. Approval creates the OST member.`}
        actions={
          <Button variant="secondary" onClick={() => setRecordOpen(true)}>
            View accreditation record
          </Button>
        }
      />
      <p className={styles.backRow}>
        <Link to="/admin/ost/applications">Back to applications</Link>
      </p>

      <DetailCard>
        <DetailCardTitle>{app.applicantName}</DetailCardTitle>
        <DetailFieldGrid>
          <DetailField label="Email">{app.email}</DetailField>
          <DetailField label="Phone">{app.phone}</DetailField>
          <DetailField label="Date of birth">{app.birthDate}</DetailField>
          <DetailField label="Sponsor (frozen)">{app.sponsorName}</DetailField>
          <DetailField label="Referral code">{app.referralCodeHint}</DetailField>
          <DetailField label="Submitted">{formatDateTime(app.submittedAt)}</DetailField>
          <DetailField label="Status">
            <StatusChip
              label={statusLabel(app.status)}
              tone={app.status === 'approved' ? 'success' : 'neutral'}
            />
          </DetailField>
          {app.reviewNotes ? (
            <DetailField label="Review notes">{app.reviewNotes}</DetailField>
          ) : null}
          {app.reviewedAt ? (
            <DetailField label="Reviewed">{formatDateTime(app.reviewedAt)}</DetailField>
          ) : null}
        </DetailFieldGrid>
      </DetailCard>

      {reviewable ? (
        <div className={styles.reviewSection}>
          {official && (
            <>
              <h2>Official accreditation review</h2>
              <p>
                Form {records.data?.registration?.form_number}. Applicant signature:{' '}
                {records.data?.registration?.applicant_signature_status}. Referrer signature:{' '}
                {records.data?.registration?.referrer_signature_status}. Endorsement:{' '}
                {records.data?.registration?.endorsed_at ? 'Received' : 'Pending'}.
              </p>
              <DateField
                id="signatures-referrer-date"
                name="referrerSignedOn"
                label="Actual referrer signature date"
                optional
                max={new Date().toISOString().slice(0, 10)}
                value={signedOn}
                onChange={setSignedOn}
              />
              <DateField
                id="signatures-applicant-date"
                name="applicantSignedOn"
                label="Actual applicant signature date"
                optional
                max={new Date().toISOString().slice(0, 10)}
                value={applicantSignedOn}
                onChange={setApplicantSignedOn}
              />
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
              <DateField
                id="term-starts-on"
                name="startsOn"
                label="Management-approved start"
                value={startsOn}
                onChange={setStartsOn}
              />
              <DateField
                id="term-expires-on"
                name="expiresOn"
                label="Management-approved expiry"
                min={startsOn}
                value={expiresOn}
                onChange={setExpiresOn}
              />
              <p>No default accreditation duration is configured. Use management-approved dates.</p>
              {endorsement.isError ? (
                <Alert variant="danger" title="Endorsement failed">
                  {endorsement.error.message}
                </Alert>
              ) : null}
              {signatures.isError ? (
                <Alert variant="danger" title="Signature confirmation failed">
                  {signatures.error.message}
                </Alert>
              ) : null}
            </>
          )}
          <PasswordField
            id="ost-temporary-password"
            label="Temporary password"
            value={temporaryPassword}
            onChange={setTemporaryPassword}
            autoComplete="new-password"
          />
          <PasswordField
            id="ost-confirm-temporary-password"
            label="Confirm temporary password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            error={
              confirmPassword && confirmPassword !== temporaryPassword
                ? 'Passwords do not match.'
                : undefined
            }
          />
          <p>
            Use at least 8 characters. Share this password securely with the OST; they must change
            it at first sign-in.
          </p>
          <ProfilePhotoEditor
            key={id}
            staged
            photo={{
              url: profilePhotoBase64 ? `data:image/jpeg;base64,${profilePhotoBase64}` : null,
              expiresAt: null,
              canUpload: !approve.isPending,
              notice: null,
            }}
            loading={false}
            onRefresh={() => {}}
            onUpload={async (value) => {
              setSelectedPhoto({ applicationId: id, data: value });
            }}
          />
          <Button
            onClick={() => {
              setOutcome(null);
              setConfirmApprove(true);
            }}
            disabled={
              (official && !management) ||
              !profilePhotoBase64 ||
              temporaryPassword.length < 8 ||
              temporaryPassword !== confirmPassword ||
              approve.isPending ||
              reject.isPending ||
              requestChanges.isPending ||
              (official &&
                (!startsOn ||
                  !expiresOn ||
                  !records.data?.registration?.endorsed_at ||
                  temporaryPassword.length < 8 ||
                  temporaryPassword !== confirmPassword))
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
          <TextAreaField
            id="application-review-notes"
            name="reviewNotes"
            label="Review notes (required for rejection or requested changes, min 5 characters)"
            optional
            value={reason}
            onChange={setReason}
            rows={3}
          />
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
        <Alert variant="info" title="Review closed">
          This application is {statusLabel(app.status)} and can no longer be reviewed.
        </Alert>
      )}
      {outcome ? (
        <Alert
          variant={outcome === 'Rejected.' || /failed/i.test(outcome) ? 'danger' : 'success'}
          title="Review outcome"
        >
          {outcome}
        </Alert>
      ) : null}

      <Dialog
        open={recordOpen}
        onClose={() => setRecordOpen(false)}
        title="Accreditation record"
        footer={
          <Button variant="secondary" onClick={() => setRecordOpen(false)}>
            Close
          </Button>
        }
      >
        <DetailFieldGrid>
          <DetailField label="Applicant">{app.applicantName}</DetailField>
          <DetailField label="Sponsor (frozen)">{app.sponsorName}</DetailField>
          <DetailField label="Referral code">{app.referralCodeHint}</DetailField>
          <DetailField label="Status">{statusLabel(app.status)}</DetailField>
          <DetailField label="Submitted">{formatDateTime(app.submittedAt)}</DetailField>
          <DetailField label="Reviewed">
            {app.reviewedAt ? formatDateTime(app.reviewedAt) : 'Not reviewed yet'}
          </DetailField>
          <DetailField label="Review notes">
            {app.reviewNotes ?? 'No review notes recorded'}
          </DetailField>
          {records.data?.registration ? (
            <>
              <DetailField label="Form number">{records.data.registration.form_number}</DetailField>
              <DetailField label="Applicant signature">
                {records.data.registration.applicant_signature_status}
              </DetailField>
              <DetailField label="Referrer signature">
                {records.data.registration.referrer_signature_status}
              </DetailField>
              <DetailField label="Endorsement">
                {records.data.registration.endorsed_at ? 'Received' : 'Pending'}
              </DetailField>
            </>
          ) : (
            <DetailField label="Official form">
              No official accreditation record attached
            </DetailField>
          )}
        </DetailFieldGrid>
      </Dialog>

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
    placeholderData: keepPreviousData,
  });

  const upload = useBusinessMutation({
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
    <div className={styles.documentsSection}>
      <h2>Identity documents</h2>
      {docs.isPending ? (
        <div role="status" aria-label="Loading documents">
          <Skeleton style={{ height: 48 }} />
          <span className="sr-only">Loading documents…</span>
        </div>
      ) : docs.isError ? (
        <ErrorState
          error={docs.error}
          title="Identity documents could not be loaded"
          onRetry={() => void docs.refetch()}
        />
      ) : (docs.data ?? []).length === 0 ? (
        <EmptyState
          title="No identity documents"
          description="No identity scans are attached to this application yet."
        />
      ) : (
        <ul>
          {(docs.data ?? []).map((doc) => (
            <li key={doc.id}>
              {doc.originalFilename} - {statusLabel(doc.verificationStatus)} ·{' '}
              <Link to={`/admin/documents/${doc.id}`}>Review</Link>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.uploadRow}>
        <FileField
          id="application-id-scan"
          name="idScan"
          label="Attach an ID scan (JPEG, PNG or PDF, max 10 MiB)"
          optional
          accept={ACCEPTED_MIME.join(',')}
          status={file ? <p className={styles.fileName}>Selected: {file.name}</p> : null}
          onSelect={(file) => setFile(file)}
        />
        <Button onClick={() => upload.mutate()} disabled={upload.isPending || !file}>
          {upload.isPending ? 'Uploading…' : 'Upload scan'}
        </Button>
      </div>
      {error ? (
        <Alert variant="danger" title="Upload failed">
          {error}
        </Alert>
      ) : null}
    </div>
  );
}
