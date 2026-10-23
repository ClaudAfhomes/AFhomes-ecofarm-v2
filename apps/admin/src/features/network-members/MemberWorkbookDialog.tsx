import { useRef, useState } from 'react';
import {
  createMemberSchema,
  createOstMemberSchema,
  memberWorkbookInput,
  type MemberWorkbookKind,
  type MemberWorkbookPreview,
  type MemberWorkbookJob,
  memberWorkbookDisplayName,
} from '@afhomes/contracts';
import { Alert, Button, Dialog, Select, TextField } from '@afhomes/ui';
import { downloadFile } from '../../lib/download';
import {
  createMember,
  createOstMember,
  downloadMemberWorkbook,
  previewMemberWorkbook,
  getMemberWorkbookJobs,
  confirmMemberWorkbookRow,
} from './services';
import styles from './MemberWorkbookDialog.module.css';

type Result = { row: number; email: string; password: string; message: string };
function base64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Unable to read file.'));
    reader.readAsDataURL(file);
  });
}
export function MemberWorkbookDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [kind, setKind] = useState<MemberWorkbookKind>('IST');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<MemberWorkbookPreview | null>(null);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [finished, setFinished] = useState(false);
  const [job, setJob] = useState<MemberWorkbookJob | null>(null);
  const [history, setHistory] = useState<MemberWorkbookJob[]>([]);
  const [batchPassword, setBatchPassword] = useState('');
  const running = useRef(false);
  const errors = job
    ? job.rows.reduce((n, r) => n + r.errors.length, 0)
    : (preview?.rows.reduce((n, r) => n + r.errors.length, 0) ?? 0);
  const run = async (task: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to complete this action.');
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const confirm = () =>
    run(async () => {
      if (!createMemberSchema.shape.temporaryPassword.safeParse(batchPassword).success) {
        setError('Enter a temporary password (8-128 characters) for this batch.');
        return;
      }
      if (job) {
        if (!approved || errors) return;
        const rank: Record<string, number> = {
          vice_director: 0,
          senior_sales_manager: 1,
          sales_manager: 2,
          ost: 3,
        };
        try {
          for (const row of [...job.rows].sort(
            (a, b) => (rank[a.position] ?? 9) - (rank[b.position] ?? 9),
          )) {
            if (row.state === 'completed') continue;
            const updated = await confirmMemberWorkbookRow(job.id, row.id, approved, batchPassword);
            setJob(updated[0] ?? null);
          }
        } finally {
          try {
            const updated = await getMemberWorkbookJobs(job.id);
            if (updated[0]) setJob(updated[0]);
          } finally {
            onCreated();
          }
        }
        return;
      }
      if (preview?.jobId || preview?.rows.some((r) => r.fields.source_layout === 'company-v2'))
        throw new Error('Load the durable job before confirming this company workbook.');
      if (!preview || !approved || errors || finished) return;
      // Consume once: never blindly retry a row after an ambiguous response.
      setFinished(true);
      let attempted = false;
      try {
        for (const row of preview.rows) {
          const temporaryPassword = batchPassword;
          try {
            const checked = memberWorkbookInput(
              preview.kind,
              row.fields,
              preview.departmentId,
              temporaryPassword,
            );
            if (!checked.success) throw new Error('Invalid row; upload and preview again.');
            attempted = true;
            if (preview.kind === 'IST') await createMember(createMemberSchema.parse(checked.data));
            else await createOstMember(createOstMemberSchema.parse(checked.data));
            setResults((old) => [
              ...old,
              {
                row: row.rowNumber,
                email: row.fields.email ?? '',
                password: temporaryPassword,
                message: 'Created; password change required.',
              },
            ]);
          } catch (e) {
            setResults((old) => [
              ...old,
              {
                row: row.rowNumber,
                email: row.fields.email ?? '',
                password: temporaryPassword,
                message:
                  'Stopped. Verify member/application before retrying; the response may be incomplete.',
              },
            ]);
            throw e;
          }
        }
      } finally {
        if (attempted) onCreated();
      }
    });
  return (
    <Dialog
      open
      onClose={() => {
        if (!running.current) onClose();
      }}
      title="Import / export IST and OST"
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Close
          </Button>
          <Button
            disabled={
              busy ||
              (!preview && !job) ||
              (!!preview?.jobId && !job) ||
              !!errors ||
              !approved ||
              finished ||
              !!job?.rows.every((r) => r.state === 'completed')
            }
            onClick={() => void confirm()}
          >
            {busy
              ? 'Working…'
              : job
                ? 'Confirm / resume reviewed import'
                : `Create ${preview?.rows.length ?? 0} ${kind} accounts`}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <p>
          Import company records with their existing AAI/AAO identities. Imports never renew
          accreditation or transfer teams.
        </p>
        <label htmlFor="member-workbook-kind">Workbook type</label>
        <Select
          id="member-workbook-kind"
          name="member-workbook-kind"
          value={kind}
          disabled={busy || finished}
          onChange={(e) => {
            setKind(e.target.value as MemberWorkbookKind);
            setFile(null);
            setPreview(null);
            setJob(null);
            setApproved(false);
            setError('');
          }}
          options={[
            { value: 'IST', label: 'IST — VD / SSM / SM' },
            { value: 'OST', label: 'OST — sponsored by an active SM' },
          ]}
        />
        <div className={styles.actions}>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void run(async () => setHistory(await getMemberWorkbookJobs()))}
          >
            Import job history
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                downloadFile(await downloadMemberWorkbook(kind, 'template'));
              })
            }
          >
            Download {kind} template
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                downloadFile(await downloadMemberWorkbook(kind, 'export'));
              })
            }
          >
            Export {kind} roster
          </Button>
        </div>
        <p>
          Read the README. Keep matching rows across Identity, Team and Details; OST also uses
          Accreditation. IST can include VD → SSM → SM in one workbook. OST requires an existing
          active SM team.
        </p>
        <label htmlFor="member-workbook-file">Excel workbook (.xlsx)</label>
        <input
          id="member-workbook-file"
          type="file"
          accept=".xlsx"
          disabled={busy || finished}
          key={kind}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setPreview(null);
            setJob(null);
            setApproved(false);
            setError('');
          }}
        />
        <p className={styles.hint}>
          Google Sheets: keep it private, then download as Microsoft Excel (.xlsx). Maximum 8 MB /
          500 members.
        </p>
        <Button
          variant="secondary"
          disabled={busy || !file || finished}
          onClick={() =>
            void run(async () => {
              if (!file || !file.name.toLowerCase().endsWith('.xlsx') || file.size > 8_000_000)
                throw new Error('Choose an XLSX file no larger than 8 MB.');
              setPreview(null);
              setApproved(false);
              const result = await previewMemberWorkbook(kind, await base64(file));
              const savedJob = result.jobId ? (await getMemberWorkbookJobs(result.jobId))[0] : null;
              if (result.jobId && !savedJob)
                throw new Error(
                  'The staged job could not be read. Use job history to resume; no accounts were requested.',
                );
              if (result.rows.some((r) => r.fields.source_layout === 'company-v2') && !savedJob)
                throw new Error('Company import requires durable job storage.');
              setJob(savedJob ?? null);
              setPreview(result);
            })
          }
        >
          Validate and preview
        </Button>
        {error ? <Alert variant="danger">{error}</Alert> : null}
        {history.length ? (
          <section aria-label="Import history">
            <h3>Recent import jobs</h3>
            {history.map((item) => (
              <Button
                key={item.id}
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setJob(item);
                  setKind(item.kind);
                  setPreview(null);
                  setApproved(false);
                  setFinished(false);
                }}
              >
                {item.kind} · {item.createdAt} ·{' '}
                {item.rows.filter((r) => r.state === 'completed').length}/{item.rows.length}{' '}
                complete
              </Button>
            ))}
          </section>
        ) : null}
        {job ? (
          <section aria-label="Durable import job">
            <p role="status">
              Job {job.id}: {job.rows.filter((r) => r.state === 'completed').length}/
              {job.rows.length} complete · {errors} validation issues ·{' '}
              {job.rows.filter((r) => r.lastError).length} interrupted / held rows
            </p>
            <div
              className={styles.tableWrap}
              tabIndex={0}
              role="region"
              aria-label="Import job rows"
            >
              <table>
                <thead>
                  <tr>
                    <th>Row / name</th>
                    <th>Identity / head</th>
                    <th>Decision / progress</th>
                    <th>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {job.rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {row.rowNumber} · {row.name}
                        <br />
                        {row.email}
                        <br />
                        {row.mobile}
                      </td>
                      <td>
                        {row.aaNumber || 'Allocate on creation'}
                        <br />
                        {row.head || 'No head'}
                      </td>
                      <td>
                        {row.decision} · {row.state}
                        <br />
                        {row.lastError?.replaceAll('_', ' ')}
                      </td>
                      <td>
                        {row.errors.join(' ') || 'Validated'}
                        <details>
                          <summary>Review profile and recorded claims</summary>
                          <dl>
                            {Object.entries(row.details).map(([key, value]) => (
                              <div key={key}>
                                <dt>{key.replaceAll('_', ' ')}</dt>
                                <dd>{value || 'Not supplied'}</dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label className={styles.approval}>
              <input
                type="checkbox"
                checked={approved}
                disabled={busy || !!errors}
                onChange={(e) => setApproved(e.target.checked)}
              />
              I reviewed these records and authorize import. For OST CREATE rows I independently
              verified both signatures and approve the annual dates. IST has no accreditation term.
            </label>
            <TextField
              id="batch-temporary-password"
              name="batchTemporaryPassword"
              label="Batch temporary password (shared for all CREATE rows)"
              type="password"
              value={batchPassword}
              onChange={setBatchPassword}
              disabled={busy}
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              hint="One password for all new accounts in this batch. Each user must change it at first login. Not stored after dialog closes."
              data-testid="batch-temporary-password"
            />
            <p>
              New accounts can sign in with their own email and this batch password, then must
              choose a new password. Existing matched accounts keep their passwords. No invitation
              is sent. Resume an interrupted import here using the same job ID and batch password.
            </p>
            <p className={styles.hint}>
              Row linkage cannot detect an independently sorted tab whose formulas were
              recalculated. Verify every applicant's team and profile before approval.
            </p>
          </section>
        ) : null}
        {preview && !job ? (
          <>
            <p role="status">
              {preview.rows.length} rows · {errors} validation errors. Preview creates no accounts.
            </p>
            <div
              className={styles.tableWrap}
              tabIndex={0}
              role="region"
              aria-label="Import preview"
            >
              <table>
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Name / email</th>
                    <th>Position / head</th>
                    <th>Validation</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.rowNumber}>
                      <td>{r.rowNumber}</td>
                      <td>
                        {memberWorkbookDisplayName(
                          [r.fields.first_name, r.fields.last_name].filter(Boolean).join(' '),
                        )}
                        <br />
                        {r.fields.email}
                      </td>
                      <td>
                        {r.fields.position}
                        <br />
                        {r.fields.head_member || 'No head'}
                      </td>
                      <td>
                        {r.errors.length ? (
                          <ul>
                            {r.errors.map((e, i) => (
                              <li key={i}>{e}</li>
                            ))}
                          </ul>
                        ) : (
                          'Ready'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TextField
              id="batch-temporary-password"
              name="batchTemporaryPassword"
              label="Batch temporary password (shared for all CREATE rows)"
              type="password"
              value={batchPassword}
              onChange={setBatchPassword}
              disabled={busy || finished}
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              hint="One password for all new accounts in this batch. Each user must change it at first login. Not stored after dialog closes."
              data-testid="batch-temporary-password"
            />
            <label className={styles.approval}>
              <input
                type="checkbox"
                checked={approved}
                disabled={
                  busy || !!errors || finished || !batchPassword || batchPassword.length < 8
                }
                onChange={(e) => setApproved(e.target.checked)}
              />
              I reviewed every row and authorize creation. For OST, I verified both signed forms and
              approve the stated annual start dates.
            </label>
            <p className={styles.hint}>
              Shared temporary password for this batch. Completed rows remain if a later row fails.
              No automatic retry.
            </p>
          </>
        ) : null}
        {results.length ? (
          <section aria-label="Account creation results">
            <h3>One-time credentials — save securely before closing</h3>
            <p>
              Passwords exist only in this dialog. For a stopped row, verify whether the account
              exists before using its password or retrying.
            </p>
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Row / email</th>
                    <th>Temporary password</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.row}>
                      <td>
                        {r.row}
                        <br />
                        {r.email}
                      </td>
                      <td>
                        <code>{r.password}</code>
                      </td>
                      <td>{r.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </Dialog>
  );
}
