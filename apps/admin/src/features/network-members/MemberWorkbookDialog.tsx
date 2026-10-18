import { useRef, useState } from 'react';
import {
  createMemberSchema,
  createOstMemberSchema,
  memberWorkbookInput,
  type MemberWorkbookKind,
  type MemberWorkbookPreview,
} from '@afhomes/contracts';
import { Alert, Button, Dialog, Select } from '@afhomes/ui';
import { downloadFile } from '../../lib/download';
import {
  createMember,
  createOstMember,
  downloadMemberWorkbook,
  previewMemberWorkbook,
} from './services';
import styles from './MemberWorkbookDialog.module.css';

type Result = { row: number; email: string; password: string; message: string };
const password = () =>
  'Aa1!' +
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
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
  const running = useRef(false);
  const errors = preview?.rows.reduce((n, r) => n + r.errors.length, 0) ?? 0;
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
      if (!preview || !approved || errors || finished) return;
      // Consume once: never blindly retry a row after an ambiguous response.
      setFinished(true);
      let attempted = false;
      try {
        for (const row of preview.rows) {
          const temporaryPassword = password();
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
            disabled={busy || !preview || !!errors || !approved || finished}
            onClick={() => void confirm()}
          >
            {busy ? 'Working…' : `Create ${preview?.rows.length ?? 0} ${kind} accounts`}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <p>New accounts only. Renewals, updates and team moves use their separate workflows.</p>
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
          Read the README. Keep matching rows across all four entry tabs. Heads must already exist:
          VD → SSM → SM → OST.
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
              setPreview(await previewMemberWorkbook(kind, await base64(file)));
            })
          }
        >
          Validate and preview
        </Button>
        {error ? <Alert variant="danger">{error}</Alert> : null}
        {preview ? (
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
                        {[r.fields.first_name, r.fields.last_name].filter(Boolean).join(' ')}
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
            <label className={styles.approval}>
              <input
                type="checkbox"
                checked={approved}
                disabled={busy || !!errors || finished}
                onChange={(e) => setApproved(e.target.checked)}
              />
              I reviewed every row and authorize creation. For OST, I verified both signed forms and
              approve the stated annual start dates.
            </label>
            <p className={styles.hint}>
              Individual temporary passwords appear once below. Completed rows remain if a later row
              fails. No automatic retry.
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
