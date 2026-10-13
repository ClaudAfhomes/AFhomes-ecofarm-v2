import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { useSession } from '../../lib/session';
import { Link, useNavigate, useParams } from 'react-router';
import {
  manualOstAccreditationSchema,
  ostIdentitySchema,
  officialOstFormDefaults,
  parseOfficialOstFields,
  submitOstRenewalSchema,
} from '@afhomes/contracts';
import {
  Alert,
  Button,
  DateField,
  DetailCard,
  DetailCardTitle,
  DetailField,
  DetailFieldGrid,
  Dialog,
  EmptyState,
  ErrorState,
  FileField,
  MetricCard,
  OstOfficialFields,
  OverflowMenu,
  PageHeader,
  Pagination,
  Select,
  Skeleton,
  StatusChip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TextAreaField,
  TextField,
} from '@afhomes/ui';
import { formatCountOrDash } from '@afhomes/shared';
import {
  getOstSponsors,
  registerOfficialOst,
  getAccreditation,
  getOstMembers,
  submitRenewal,
  reviseRenewal,
  decideRenewal,
  parseOstImport,
  confirmOstImport,
  downloadOstFile,
} from './services';
import { downloadExport } from '../reports/services';
import styles from './OstAccreditationPages.module.css';

/** Query keys scoped to the OST accreditation workspace. */
const accreditationKeys = {
  sponsors: ['ost', 'sponsors'] as const,
  members: ['ost', 'members'] as const,
  record: (kind: string, id: string) => ['ost', 'accreditation', kind, id] as const,
};

const statusLabel = (status: string) =>
  status.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());

const MANUAL_FIELDS = [
  'firstName',
  'middleName',
  'lastName',
  'email',
  'phone',
  'birthDate',
  'line1',
  'city',
  'province',
  'postalCode',
] as const;

const MANUAL_OPTIONAL = new Set(['middleName', 'postalCode']);

const manualLabel = (name: string) => name.replace(/([A-Z])/g, ' $1');

export function OstManualRegistrationPage() {
  const navigate = useNavigate();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [official, setOfficial] = useState(officialOstFormDefaults);
  const [requestId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState('');
  const sponsors = useQuery({
    queryKey: accreditationKeys.sponsors,
    queryFn: getOstSponsors,
    placeholderData: keepPreviousData,
  });
  const save = useBusinessMutation({ mutationFn: registerOfficialOst });
  const submit = () => {
    const parsedForm = parseOfficialOstFields(official);
    if (!parsedForm.success) {
      setError(parsedForm.error.issues[0]?.message ?? 'Check the official form.');
      return;
    }
    const parsed = manualOstAccreditationSchema.safeParse({
      requestId,
      sponsorStaffId: fields.sponsorStaffId,
      identity: {
        firstName: fields.firstName,
        middleName: fields.middleName || undefined,
        lastName: fields.lastName,
        email: fields.email,
        phone: fields.phone,
        birthDate: fields.birthDate,
        address: {
          line1: fields.line1,
          city: fields.city,
          province: fields.province,
          postalCode: fields.postalCode || undefined,
          countryCode: 'PH',
        },
      },
      form: parsedForm.data,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Complete the applicant details.');
      return;
    }
    setError('');
    save.mutate(parsed.data);
  };

  if (sponsors.isPending) {
    return (
      <section>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading registration form"
        >
          <Skeleton style={{ height: 32, maxWidth: 300 }} />
          <Skeleton style={{ height: 16, maxWidth: 460 }} />
          <Skeleton style={{ height: 96 }} />
          <Skeleton style={{ height: 96 }} />
          <span className="sr-only">Loading registration form…</span>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <PageHeader
        title="Register OST accreditation"
        description="The official form creates a pending application. Endorsement and management approval are separate steps."
        actions={
          <Button variant="secondary" onClick={() => navigate('/admin/ost/applications')}>
            Back to applications
          </Button>
        }
      />
      <Alert variant="info" title="How registration works">
        Submitting creates a pending application only. The sponsor is frozen at submission and the
        Sales Manager endorsement plus management approval happen later.
      </Alert>
      {save.isSuccess ? (
        <Alert variant="success" title="Application saved">
          Application saved for review.{' '}
          <Link to={`/admin/ost/applications/${save.data.id}`}>View application</Link>
        </Alert>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className={styles.form}
        >
          <section className={styles.panel} aria-labelledby="manual-identity-heading">
            <h2 id="manual-identity-heading" className={styles.panelTitle}>
              Applicant identity
            </h2>
            <div className={styles.editorGrid}>
              {MANUAL_FIELDS.map((name) =>
                name === 'birthDate' ? (
                  <DateField
                    key={name}
                    id={`manual-${name}`}
                    name={name}
                    label={manualLabel(name)}
                    max={new Date().toISOString().slice(0, 10)}
                    value={fields[name] ?? ''}
                    onChange={(value) => setFields((current) => ({ ...current, [name]: value }))}
                    {...(MANUAL_OPTIONAL.has(name) ? { optional: true as const } : {})}
                  />
                ) : (
                  <TextField
                    key={name}
                    id={`manual-${name}`}
                    name={name}
                    label={manualLabel(name)}
                    type={name === 'email' ? 'email' : 'text'}
                    value={fields[name] ?? ''}
                    onChange={(value) => setFields((current) => ({ ...current, [name]: value }))}
                    {...(MANUAL_OPTIONAL.has(name) ? { optional: true as const } : {})}
                  />
                ),
              )}
              <label className={styles.filterLabel}>
                Sales Manager
                <Select
                  required
                  value={fields.sponsorStaffId ?? ''}
                  onChange={(e) =>
                    setFields((current) => ({ ...current, sponsorStaffId: e.target.value }))
                  }
                  options={[
                    { value: '', label: 'Choose an active Sales Manager' },
                    ...(sponsors.data?.map((s) => ({ value: s.id, label: s.name })) ?? []),
                  ]}
                />
              </label>
            </div>
            {sponsors.isError ? (
              <ErrorState
                error={sponsors.error}
                title="Sales Managers could not be loaded"
                onRetry={() => void sponsors.refetch()}
              />
            ) : null}
          </section>
          <section className={styles.panel} aria-labelledby="manual-official-heading">
            <h2 id="manual-official-heading" className={styles.panelTitle}>
              Official form
            </h2>
            <OstOfficialFields
              values={official}
              onChange={(name, value) => setOfficial((current) => ({ ...current, [name]: value }))}
            />
          </section>
          {error ? (
            <Alert variant="danger" title="Registration details need attention">
              {error}
            </Alert>
          ) : null}
          {save.isError ? (
            <Alert variant="danger" title="Registration could not be saved">
              {save.error.message}
            </Alert>
          ) : null}
          <div className={styles.stickyFooter}>
            <Button type="submit" disabled={save.isPending || !sponsors.data}>
              {save.isPending ? 'Saving…' : 'Submit for review'}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

export function OstAccreditationHistoryPage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const management =
    ['admin', 'super_admin', 'senior_sales_manager', 'vice_director'].includes(
      user?.roleSlug ?? '',
    ) &&
    user?.afHomesPermissions?.some(
      (p) => p.moduleKey === 'network.ost_registrations' && p.canUpdate,
    );
  const { id = '' } = useParams();
  const client = useQueryClient();
  const records = useQuery({
    queryKey: accreditationKeys.record('members', id),
    queryFn: () => getAccreditation('members', id),
    placeholderData: keepPreviousData,
  });
  const members = useQuery({
    queryKey: accreditationKeys.members,
    queryFn: () => getOstMembers(),
    placeholderData: keepPreviousData,
  });
  const sponsors = useQuery({
    queryKey: accreditationKeys.sponsors,
    queryFn: getOstSponsors,
    placeholderData: keepPreviousData,
  });
  const [dates, setDates] = useState({
    dateOfRenewal: new Date().toISOString().slice(0, 10),
    requestedStart: '',
    requestedEnd: '',
    proposedNewSponsorStaffId: '',
    reasonForReferrerChange: '',
    applicantSignatureStatus: 'pending',
    referrerSignatureStatus: 'pending',
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [detailRenewalId, setDetailRenewalId] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('');
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['ost'] });
  };
  const renewal = useBusinessMutation({
    mutationFn: () => {
      const parsed = submitOstRenewalSchema.safeParse({
        ...dates,
        requestId,
        proposedNewSponsorStaffId: dates.proposedNewSponsorStaffId || null,
      });
      if (!parsed.success)
        throw new Error(parsed.error.issues[0]?.message ?? 'Check the renewal details.');
      return editing ? reviseRenewal(editing, parsed.data) : submitRenewal(id, parsed.data);
    },
    onSuccess: () => {
      setEditing(null);
      setRequestId(crypto.randomUUID());
      setMessage(
        'Renewal submitted. The current sponsor and term remain authoritative until approval.',
      );
      refresh();
    },
  });
  const decision = useBusinessMutation({
    mutationFn: ({
      renewalId,
      action,
    }: {
      renewalId: string;
      action: 'endorse' | 'approve' | 'reject' | 'request-changes';
    }) => decideRenewal(renewalId, action, notes),
    onSuccess: refresh,
  });
  const member = members.data?.find((m) => m.id === id);
  const terms = records.data?.terms ?? [];
  const renewals = records.data?.renewals ?? [];
  const pendingRenewals = renewals.filter((r) =>
    ['submitted', 'under_review', 'changes_requested'].includes(r.status),
  ).length;
  const detailRenewal = renewals.find((r) => r.id === detailRenewalId) ?? null;

  if (records.isPending) {
    return (
      <section>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading accreditation"
        >
          <Skeleton style={{ height: 32, maxWidth: 300 }} />
          <Skeleton style={{ height: 16, maxWidth: 460 }} />
          <Skeleton style={{ height: 96 }} />
          <Skeleton style={{ height: 96 }} />
          <span className="sr-only">Loading accreditation…</span>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <PageHeader
        title="OST validity and renewal"
        description={
          member
            ? `${member.ostNumber} · ${member.fullName} · Current sponsor: ${member.sponsorName}`
            : 'Accreditation history'
        }
        actions={
          <Button variant="secondary" onClick={() => navigate('/admin/ost/members')}>
            Back to members
          </Button>
        }
      />

      <div className={styles.metrics} aria-label="Accreditation summary">
        <MetricCard
          label="Recorded terms"
          value={formatCountOrDash(terms.length)}
          description="Approved accreditation terms on file."
          icon="grid"
        />
        <MetricCard
          label="Pending renewals"
          value={formatCountOrDash(pendingRenewals)}
          description="Renewals waiting for endorsement or decision."
          icon="clock"
          chip={{ label: 'Pending', tone: 'warning' }}
        />
        <MetricCard
          label="Total renewals"
          value={formatCountOrDash(renewals.length)}
          description="Every renewal request ever filed."
          icon="check"
        />
      </div>

      {records.isError ? (
        <ErrorState
          error={records.error}
          title="Accreditation could not be loaded"
          onRetry={() => void records.refetch()}
        />
      ) : (
        <>
          <h2>Approved validity history</h2>
          {terms.length === 0 ? (
            <EmptyState
              title="No accreditation terms"
              description="No recorded accreditation term. Management must review legacy accreditation; no dates are inferred."
            />
          ) : (
            <div
              role="region"
              aria-label="Accreditation terms"
              tabIndex={0}
              className={`table-scroll ${styles.tableWrap}`}
            >
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Starts</TableHeaderCell>
                    <TableHeaderCell>Expires</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {terms.map((term) => (
                    <TableRow key={term.id}>
                      <TableCell label="Starts">{term.starts_on}</TableCell>
                      <TableCell label="Expires">{term.expires_on}</TableCell>
                      <TableCell label="Status">
                        <StatusChip label={statusLabel(term.displayStatus)} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {terms.length > 0 ? (
            <form
              className={styles.panel}
              onSubmit={(e) => {
                e.preventDefault();
                renewal.mutate();
              }}
            >
              <h2>Request renewal</h2>
              <p>
                Original accreditation: {records.data.terms[0]?.starts_on}. Last expiry:{' '}
                {records.data.terms.at(-1)?.expires_on}. Identity and program details are carried
                forward from the approved application.
              </p>
              <div className={styles.editorGrid}>
                {(['dateOfRenewal', 'requestedStart', 'requestedEnd'] as const).map((name) => (
                  <DateField
                    key={name}
                    id={`renewal-${name}`}
                    name={name}
                    label={name.replace(/([A-Z])/g, ' $1')}
                    value={dates[name]}
                    onChange={(value) => setDates((current) => ({ ...current, [name]: value }))}
                  />
                ))}
                <label className={styles.filterLabel}>
                  Proposed new referrer (optional)
                  <Select
                    value={dates.proposedNewSponsorStaffId}
                    onChange={(e) =>
                      setDates((current) => ({
                        ...current,
                        proposedNewSponsorStaffId: e.target.value,
                      }))
                    }
                    options={[
                      { value: '', label: 'Keep current Sales Manager' },
                      ...(sponsors.data
                        ?.filter((s) => s.id !== member?.sponsorStaffId)
                        .map((s) => ({ value: s.id, label: s.name })) ?? []),
                    ]}
                  />
                </label>
                <TextAreaField
                  id="renewal-referrer-reason"
                  name="reasonForReferrerChange"
                  label="Reason for referrer change"
                  optional
                  value={dates.reasonForReferrerChange}
                  onChange={(value) =>
                    setDates((current) => ({ ...current, reasonForReferrerChange: value }))
                  }
                />
                {(['applicantSignatureStatus', 'referrerSignatureStatus'] as const).map((name) => (
                  <label key={name} className={styles.filterLabel}>
                    {name.replace(/([A-Z])/g, ' $1')}
                    <Select
                      value={dates[name]}
                      onChange={(e) =>
                        setDates((current) => ({ ...current, [name]: e.target.value }))
                      }
                      options={[
                        { value: 'pending', label: 'Pending' },
                        { value: 'received', label: 'Received' },
                      ]}
                    />
                  </label>
                ))}
              </div>
              <Button disabled={renewal.isPending} type="submit">
                {editing ? 'Submit revised renewal' : 'Submit renewal'}
              </Button>
              {renewal.isError ? (
                <p role="alert" className={styles.formAlert}>
                  {renewal.error.message}
                </p>
              ) : null}
            </form>
          ) : null}
          <h2>Renewal review history</h2>
          <TextAreaField
            id="renewal-review-notes"
            name="reviewNotes"
            label="Review notes"
            optional
            value={notes}
            onChange={setNotes}
          />
          {renewals.length === 0 ? (
            <EmptyState
              title="No renewals"
              description="No renewal requests have been filed for this member."
            />
          ) : (
            <div className={styles.renewalList}>
              {renewals.map((r) => (
                <DetailCard key={r.id}>
                  <DetailCardTitle>{r.renewal_number}</DetailCardTitle>
                  <p>
                    {r.requested_start} to {r.requested_end} · {statusLabel(r.status)}
                  </p>
                  <p>
                    {r.proposed_new_sponsor_staff_id
                      ? 'Referrer change proposed'
                      : 'Current referrer retained'}
                    {r.reason_for_referrer_change ? `: ${r.reason_for_referrer_change}` : ''}
                  </p>
                  <div className={styles.actions}>
                    {['submitted', 'under_review', 'changes_requested'].includes(r.status) && (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setEditing(r.id);
                          setDates({
                            dateOfRenewal: r.date_of_renewal,
                            requestedStart: r.requested_start,
                            requestedEnd: r.requested_end,
                            proposedNewSponsorStaffId: r.proposed_new_sponsor_staff_id ?? '',
                            reasonForReferrerChange: r.reason_for_referrer_change ?? '',
                            applicantSignatureStatus: r.applicant_signature_status,
                            referrerSignatureStatus: r.referrer_signature_status,
                          });
                        }}
                      >
                        Revise pending renewal
                      </Button>
                    )}
                    {!['approved', 'rejected', 'withdrawn'].includes(r.status) &&
                      (['endorse', 'approve', 'request-changes', 'reject'] as const)
                        .filter((action) =>
                          action === 'endorse'
                            ? user?.roleSlug === 'sales_manager' &&
                              user?.id === member?.sponsorStaffId
                            : management,
                        )
                        .map((action) => (
                          <Button
                            key={action}
                            variant="secondary"
                            disabled={decision.isPending}
                            onClick={() => decision.mutate({ renewalId: r.id, action })}
                          >
                            {action.replace(/-/g, ' ')}
                          </Button>
                        ))}
                    <OverflowMenu
                      label={`More actions for ${r.renewal_number}`}
                      items={[
                        {
                          label: 'View renewal details',
                          icon: 'info',
                          onClick: () => setDetailRenewalId(r.id),
                        },
                      ]}
                    />
                  </div>
                </DetailCard>
              ))}
            </div>
          )}
        </>
      )}
      {message ? (
        <Alert variant="success" title="Renewal recorded">
          {message}
        </Alert>
      ) : null}
      {decision.isError ? (
        <Alert variant="danger" title="Renewal decision failed">
          {decision.error.message}
        </Alert>
      ) : null}

      <Dialog
        open={detailRenewal !== null}
        onClose={() => setDetailRenewalId(null)}
        title={detailRenewal ? `Renewal ${detailRenewal.renewal_number}` : 'Renewal details'}
        footer={
          <Button variant="secondary" onClick={() => setDetailRenewalId(null)}>
            Close
          </Button>
        }
      >
        {detailRenewal ? (
          <DetailFieldGrid>
            <DetailField label="Status">{statusLabel(detailRenewal.status)}</DetailField>
            <DetailField label="Renewed on">{detailRenewal.date_of_renewal}</DetailField>
            <DetailField label="Requested start">{detailRenewal.requested_start}</DetailField>
            <DetailField label="Requested end">{detailRenewal.requested_end}</DetailField>
            <DetailField label="Referrer">
              {detailRenewal.proposed_new_sponsor_staff_id
                ? 'Referrer change proposed'
                : 'Current referrer retained'}
            </DetailField>
            <DetailField label="Change reason">
              {detailRenewal.reason_for_referrer_change ?? 'No reason recorded'}
            </DetailField>
            <DetailField label="Applicant signature">
              {statusLabel(detailRenewal.applicant_signature_status)}
            </DetailField>
            <DetailField label="Referrer signature">
              {statusLabel(detailRenewal.referrer_signature_status)}
            </DetailField>
          </DetailFieldGrid>
        ) : null}
      </Dialog>
    </section>
  );
}

const IMPORT_PAGE_SIZE = 10;

export function OstImportExportPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const sponsors = useQuery({
    queryKey: accreditationKeys.sponsors,
    queryFn: getOstSponsors,
    placeholderData: keepPreviousData,
  });
  const [file, setFile] = useState<File | null>(null);
  const [sheetUrl, setSheetUrl] = useState('');
  const [message, setMessage] = useState('');
  const parse = useBusinessMutation({
    mutationFn: async () => {
      if (sheetUrl)
        return parseOstImport({
          source: 'google_sheets',
          sourceName: 'Disposable Viewer Google Sheet',
          sheetUrl,
        });
      if (!file) throw new Error('Choose a CSV/XLSX file or public Viewer Google Sheet.');
      if (file.size > 8_000_000) throw new Error('The file exceeds 8 MB.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      let text = '';
      for (const byte of bytes) text += String.fromCharCode(byte);
      const excel = file.name.toLowerCase().endsWith('.xlsx');
      return parseOstImport({
        source: excel ? 'excel' : 'csv',
        sourceName: file.name,
        mime: excel
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv',
        contentBase64: btoa(text),
      });
    },
  });
  const confirm = useBusinessMutation({
    mutationFn: () => {
      if (!parse.data) throw new Error('Preview the import first.');
      return confirmOstImport(parse.data.job.id);
    },
    onSuccess: () => {
      setMessage(
        'Valid rows created pending accreditation applications. No accounts or terms were activated.',
      );
      setPage(0);
    },
  });
  const download = useBusinessMutation({
    mutationFn: async ({
      kind,
      format = 'csv',
    }: {
      kind: 'template' | 'official-template' | 'export';
      format?: 'csv' | 'xlsx';
    }) => downloadExport(await downloadOstFile(kind, format)),
  });
  const preview = confirm.data ?? parse.data;
  const rows = preview?.rows ?? [];
  const rowTotal = rows.length;
  const rowPageCount = Math.max(1, Math.ceil(rowTotal / IMPORT_PAGE_SIZE));
  const safePage = Math.min(page, rowPageCount - 1);
  const visibleRows = rows.slice(safePage * IMPORT_PAGE_SIZE, (safePage + 1) * IMPORT_PAGE_SIZE);
  const validRows = preview?.job.valid_rows ?? 0;
  const invalidRows = preview?.job.invalid_rows ?? 0;

  return (
    <section className={styles.page}>
      <PageHeader
        title="OST import and export"
        description="Validate and preview every row before creating pending applications. Import never activates an account."
        actions={
          <Button variant="secondary" onClick={() => navigate('/admin/ost/applications')}>
            Back to applications
          </Button>
        }
      />
      <Alert variant="info" title="Import is preview first">
        Every row is validated and previewed before anything is created, and confirming only creates
        pending applications.
      </Alert>
      <section className={styles.panel} aria-labelledby="ost-export-heading">
        <h2 id="ost-export-heading" className={styles.panelTitle}>
          Templates and export
        </h2>
        <div className={styles.actions}>
          <Button
            variant="secondary"
            onClick={() => download.mutate({ kind: 'official-template' })}
          >
            Download OST accreditation form
          </Button>
          {(['csv', 'xlsx'] as const).map((format) => (
            <span key={format} className={styles.actions}>
              <Button
                variant="secondary"
                onClick={() => download.mutate({ kind: 'template', format })}
              >
                Download OST import template ({format.toUpperCase()})
              </Button>
              <Button
                variant="secondary"
                onClick={() => download.mutate({ kind: 'export', format })}
              >
                Export OST ({format.toUpperCase()})
              </Button>
            </span>
          ))}
        </div>
        {download.isError ? (
          <Alert variant="danger" title="Download failed">
            {download.error.message}
          </Alert>
        ) : null}
      </section>
      <section className={styles.panel} aria-labelledby="ost-import-heading">
        <h2 id="ost-import-heading" className={styles.panelTitle}>
          Validate and preview
        </h2>
        <FileField
          id="ost-import-file"
          name="importFile"
          label="CSV or XLSX"
          optional
          accept=".csv,.xlsx"
          status={file ? <p className={styles.fileName}>Selected: {file.name}</p> : null}
          onSelect={(selected) => {
            setFile(selected);
            parse.reset();
            confirm.reset();
          }}
        />
        <label className={styles.filterLabel}>
          Public Viewer Google Sheet
          <input
            type="url"
            value={sheetUrl}
            onChange={(e) => {
              setSheetUrl(e.target.value);
              parse.reset();
              confirm.reset();
            }}
          />
        </label>
        <div className={styles.actions}>
          <Button disabled={parse.isPending || confirm.isPending} onClick={() => parse.mutate()}>
            {parse.isPending ? 'Validating…' : 'Validate and preview'}
          </Button>
        </div>
        {parse.isError ? (
          <Alert variant="danger" title="Import could not be validated">
            {parse.error.message}
          </Alert>
        ) : null}
      </section>
      {preview && (
        <section className={styles.panel} aria-labelledby="ost-preview-heading">
          <h2 id="ost-preview-heading" className={styles.panelTitle}>
            Preview
          </h2>
          <div className={styles.metrics} aria-label="Import summary">
            <MetricCard
              label="Valid rows"
              value={formatCountOrDash(validRows)}
              description="Rows ready for pending applications."
              icon="check"
              chip={{ label: 'Valid', tone: 'success' }}
            />
            <MetricCard
              label="Invalid rows"
              value={formatCountOrDash(invalidRows)}
              description="Rows that need correction in the source."
              icon="alert"
              chip={{ label: 'Invalid', tone: 'danger' }}
            />
          </div>
          <p>
            {formatCountOrDash(validRows)} valid · {formatCountOrDash(invalidRows)} invalid ·{' '}
            {statusLabel(preview.job.status)}
          </p>
          <div
            role="region"
            aria-label="Import preview rows"
            tabIndex={0}
            className={`table-scroll ${styles.tableWrap}`}
          >
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Row</TableHeaderCell>
                  <TableHeaderCell>Applicant</TableHeaderCell>
                  <TableHeaderCell>Sales Manager</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Validation</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleRows.map((r) => (
                  <TableRow key={r.row_number}>
                    <TableCell label="Row">{formatCountOrDash(r.row_number)}</TableCell>
                    <TableCell label="Applicant">
                      {(() => {
                        const identity = ostIdentitySchema.safeParse(r.normalized.identity);
                        return identity.success
                          ? `${identity.data.firstName} ${identity.data.lastName} · ${identity.data.email} · ${identity.data.phone}`
                          : 'Correct the source row';
                      })()}
                    </TableCell>
                    <TableCell label="Sales Manager">
                      {sponsors.data?.find((s) => s.id === r.sponsor_staff_id)?.name ??
                        'Review sponsor'}
                    </TableCell>
                    <TableCell label="Status">
                      <StatusChip label={statusLabel(r.status)} />
                    </TableCell>
                    <TableCell label="Validation">
                      {r.errors.join('; ') || 'Ready for pending application'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {rowTotal > IMPORT_PAGE_SIZE ? (
            <div className={styles.pagination}>
              <Pagination
                page={safePage + 1}
                pageCount={rowPageCount}
                onChange={(next) => setPage(next - 1)}
                label="Import preview pagination"
              />
              <span role="status" aria-label="Preview row range" className={styles.range}>
                Showing {safePage * IMPORT_PAGE_SIZE + 1} to{' '}
                {Math.min(rowTotal, (safePage + 1) * IMPORT_PAGE_SIZE)} of {rowTotal}
              </span>
            </div>
          ) : null}
          <div className={styles.actions}>
            <Button
              disabled={
                !preview.job.valid_rows || preview.job.status !== 'ready' || confirm.isPending
              }
              onClick={() => confirm.mutate()}
            >
              {confirm.isPending ? 'Confirming…' : 'Confirm valid rows'}
            </Button>
          </div>
          {confirm.isError ? (
            <Alert variant="danger" title="Import could not be confirmed">
              {confirm.error.message}
            </Alert>
          ) : null}
        </section>
      )}
      {message ? (
        <Alert variant="success" title="Import confirmed">
          {message}
        </Alert>
      ) : null}
    </section>
  );
}
