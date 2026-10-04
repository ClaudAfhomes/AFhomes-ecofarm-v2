import { useState } from 'react';
import { useSession } from '../../lib/session';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  manualOstAccreditationSchema,
  ostIdentitySchema,
  officialOstFormDefaults,
  parseOfficialOstFields,
  submitOstRenewalSchema,
} from '@jad/contracts';
import { Button, ErrorState, OstOfficialFields, PageHeader, StatusChip } from '@jad/ui';
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

export function OstManualRegistrationPage() {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [official, setOfficial] = useState(officialOstFormDefaults);
  const [requestId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState('');
  const sponsors = useQuery({ queryKey: ['ost', 'sponsors'], queryFn: getOstSponsors });
  const save = useMutation({ mutationFn: registerOfficialOst });
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
  return (
    <section>
      <PageHeader
        title="Register OST accreditation"
        description="The official form creates a pending application. Endorsement and management approval are separate steps."
      />
      <Link to="/admin/ost/applications">Back to applications</Link>
      {save.isSuccess ? (
        <p role="status">
          Application saved for review.{' '}
          <Link to={`/admin/ost/applications/${save.data.id}`}>View application</Link>
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {[
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
          ].map((name) => (
            <label key={name}>
              {name.replace(/([A-Z])/g, ' $1')}
              <input
                aria-label={name}
                type={name === 'birthDate' ? 'date' : name === 'email' ? 'email' : 'text'}
                value={fields[name] ?? ''}
                onChange={(e) => setFields((current) => ({ ...current, [name]: e.target.value }))}
                max={name === 'birthDate' ? new Date().toISOString().slice(0, 10) : undefined}
                required={!['middleName', 'postalCode'].includes(name)}
              />
            </label>
          ))}
          <label>
            Sales Manager
            <select
              required
              value={fields.sponsorStaffId ?? ''}
              onChange={(e) =>
                setFields((current) => ({ ...current, sponsorStaffId: e.target.value }))
              }
            >
              <option value="">Choose an active Sales Manager</option>
              {sponsors.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {sponsors.isError && <ErrorState error={sponsors.error} onRetry={sponsors.refetch} />}
          <OstOfficialFields
            values={official}
            onChange={(name, value) => setOfficial((current) => ({ ...current, [name]: value }))}
          />
          {error && <p role="alert">{error}</p>}
          {save.isError && <p role="alert">{save.error.message}</p>}
          <Button type="submit" disabled={save.isPending || !sponsors.data}>
            {save.isPending ? 'Saving…' : 'Submit for review'}
          </Button>
        </form>
      )}
    </section>
  );
}

export function OstAccreditationHistoryPage() {
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
  const records = useQuery({
    queryKey: ['ost', 'accreditation', id],
    queryFn: () => getAccreditation('members', id),
  });
  const members = useQuery({ queryKey: ['ost', 'members'], queryFn: () => getOstMembers() });
  const sponsors = useQuery({ queryKey: ['ost', 'sponsors'], queryFn: getOstSponsors });
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
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('');
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['ost'] });
  };
  const renewal = useMutation({
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
  const decision = useMutation({
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
  return (
    <section>
      <PageHeader
        title="OST validity and renewal"
        description={
          member
            ? `${member.ostNumber} · ${member.fullName} · Current sponsor: ${member.sponsorName}`
            : 'Accreditation history'
        }
      />
      <Link to="/admin/ost/members">Back to members</Link>
      {records.isPending ? (
        <p role="status">Loading accreditation…</p>
      ) : records.isError ? (
        <ErrorState error={records.error} onRetry={records.refetch} />
      ) : (
        <>
          <h2>Approved validity history</h2>
          {!records.data.terms.length && (
            <p>
              No recorded accreditation term. Management must review legacy accreditation; no dates
              are inferred.
            </p>
          )}
          <ul>
            {records.data.terms.map((term) => (
              <li key={term.id}>
                {term.starts_on} to {term.expires_on} <StatusChip label={term.displayStatus} />
              </li>
            ))}
          </ul>
          {!!records.data.terms.length && (
            <form
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
              {(['dateOfRenewal', 'requestedStart', 'requestedEnd'] as const).map((name) => (
                <label key={name}>
                  {name.replace(/([A-Z])/g, ' $1')}
                  <input
                    type="date"
                    required
                    value={dates[name]}
                    onChange={(e) =>
                      setDates((current) => ({ ...current, [name]: e.target.value }))
                    }
                  />
                </label>
              ))}
              <label>
                Proposed new referrer (optional)
                <select
                  value={dates.proposedNewSponsorStaffId}
                  onChange={(e) =>
                    setDates((current) => ({
                      ...current,
                      proposedNewSponsorStaffId: e.target.value,
                    }))
                  }
                >
                  <option value="">Keep current Sales Manager</option>
                  {sponsors.data
                    ?.filter((s) => s.id !== member?.sponsorStaffId)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Reason for referrer change
                <textarea
                  value={dates.reasonForReferrerChange}
                  onChange={(e) =>
                    setDates((current) => ({ ...current, reasonForReferrerChange: e.target.value }))
                  }
                />
              </label>
              {(['applicantSignatureStatus', 'referrerSignatureStatus'] as const).map((name) => (
                <label key={name}>
                  {name.replace(/([A-Z])/g, ' $1')}
                  <select
                    value={dates[name]}
                    onChange={(e) =>
                      setDates((current) => ({ ...current, [name]: e.target.value }))
                    }
                  >
                    <option value="pending">Pending</option>
                    <option value="received">Received</option>
                  </select>
                </label>
              ))}
              <Button disabled={renewal.isPending} type="submit">
                {editing ? 'Submit revised renewal' : 'Submit renewal'}
              </Button>
            </form>
          )}
          <h2>Renewal review history</h2>
          <label>
            Review notes
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          {records.data.renewals.map((r) => (
            <article key={r.id}>
              <h3>{r.renewal_number}</h3>
              <p>
                {r.requested_start} to {r.requested_end} · {r.status.replace(/_/g, ' ')}
              </p>
              <p>
                {r.proposed_new_sponsor_staff_id
                  ? 'Referrer change proposed'
                  : 'Current referrer retained'}
                {r.reason_for_referrer_change ? `: ${r.reason_for_referrer_change}` : ''}
              </p>
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
                      ? user?.roleSlug === 'sales_manager' && user?.id === member?.sponsorStaffId
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
            </article>
          ))}
        </>
      )}
      {message && <p role="status">{message}</p>}
      {renewal.isError && <p role="alert">{renewal.error.message}</p>}
      {decision.isError && <p role="alert">{decision.error.message}</p>}
    </section>
  );
}

export function OstImportExportPage() {
  const sponsors = useQuery({ queryKey: ['ost', 'sponsors'], queryFn: getOstSponsors });
  const [file, setFile] = useState<File | null>(null);
  const [sheetUrl, setSheetUrl] = useState('');
  const [message, setMessage] = useState('');
  const parse = useMutation({
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
  const confirm = useMutation({
    mutationFn: () => {
      if (!parse.data) throw new Error('Preview the import first.');
      return confirmOstImport(parse.data.job.id);
    },
    onSuccess: () =>
      setMessage(
        'Valid rows created pending accreditation applications. No accounts or terms were activated.',
      ),
  });
  const download = useMutation({
    mutationFn: async ({
      kind,
      format = 'csv',
    }: {
      kind: 'template' | 'official-template' | 'export';
      format?: 'csv' | 'xlsx';
    }) => downloadExport(await downloadOstFile(kind, format)),
  });
  const preview = confirm.data ?? parse.data;
  return (
    <section>
      <PageHeader
        title="OST import and export"
        description="Validate and preview every row before creating pending applications. Import never activates an account."
      />
      <Button variant="secondary" onClick={() => download.mutate({ kind: 'official-template' })}>
        Download OST accreditation form
      </Button>
      {(['csv', 'xlsx'] as const).map((format) => (
        <span key={format}>
          <Button variant="secondary" onClick={() => download.mutate({ kind: 'template', format })}>
            Download OST import template ({format.toUpperCase()})
          </Button>
          <Button variant="secondary" onClick={() => download.mutate({ kind: 'export', format })}>
            Export OST ({format.toUpperCase()})
          </Button>
        </span>
      ))}
      <label>
        CSV or XLSX
        <input
          type="file"
          accept=".csv,.xlsx"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            parse.reset();
            confirm.reset();
          }}
        />
      </label>
      <label>
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
      <Button disabled={parse.isPending || confirm.isPending} onClick={() => parse.mutate()}>
        Validate and preview
      </Button>
      {preview && (
        <>
          <p>
            {preview.job.valid_rows} valid · {preview.job.invalid_rows} invalid ·{' '}
            {preview.job.status}
          </p>
          <table>
            <thead>
              <tr>
                <th>Row</th>
                <th>Applicant</th>
                <th>Sales Manager</th>
                <th>Status</th>
                <th>Validation</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((r) => (
                <tr key={r.row_number}>
                  <td>{r.row_number}</td>
                  <td>
                    {(() => {
                      const identity = ostIdentitySchema.safeParse(r.normalized.identity);
                      return identity.success
                        ? `${identity.data.firstName} ${identity.data.lastName} · ${identity.data.email} · ${identity.data.phone}`
                        : 'Correct the source row';
                    })()}
                  </td>
                  <td>
                    {sponsors.data?.find((s) => s.id === r.sponsor_staff_id)?.name ??
                      'Review sponsor'}
                  </td>
                  <td>{r.status}</td>
                  <td>{r.errors.join('; ') || 'Ready for pending application'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button
            disabled={
              !preview.job.valid_rows || preview.job.status !== 'ready' || confirm.isPending
            }
            onClick={() => confirm.mutate()}
          >
            Confirm valid rows
          </Button>
        </>
      )}
      {[parse.error, confirm.error, download.error].filter(Boolean).map((e, i) => (
        <p role="alert" key={i}>
          {e?.message}
        </p>
      ))}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
