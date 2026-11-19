import type { PayrollLine } from '@afhomes/contracts';
import {
  Button,
  StatusChip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@afhomes/ui';

import { formatDate } from '../../lib/format';
import { formatMoney } from './format';
import { performanceBlockerLabel, reviewFlagLabel } from './payroll-utils';
import styles from './IstPayrollPage.module.css';

/** "CONFIGURATION_REQUIRED: no policy" -> "No policy". The code is a developer token. */
export function plainReason(raw: string | null): string {
  if (!raw) return 'Needs configuration.';
  const [code = '', ...rest] = raw.split(':');
  const text = (rest.join(':').trim() || code.replace(/_/g, ' ').toLowerCase())
    .replace(/\b[A-Z][A-Z_]{2,}\s*\(([^()]*)\)/g, '$1')
    .replace(/\b[A-Z][A-Z_]{2,}\b/g, performanceBlockerLabel);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Exception-first: blocked lines, then lines awaiting review, then the rest (stable). */
function attentionRank(line: PayrollLine): number {
  if (line.status === 'blocked') return 0;
  if (line.reviewRequired && !line.reviewedAt) return 1;
  return 2;
}

interface Props {
  lines: PayrollLine[];
  /** Present only on an approved live batch; simulations never pass it. */
  onDisburse?: (line: PayrollLine) => void;
  /** Reason the disburse action is unavailable, shown instead of a dead button. */
  disburseBlock?: string | null;
  /** Button label; simulations use "Record simulated payout". */
  payoutLabel?: string;
  /** Present only for finance.payroll update holders on a draft live batch. */
  onReview?: (line: PayrollLine) => void;
  onReconcile?: (line: PayrollLine) => void;
  /** Opens the external-payment evidence panel for a live disbursement. */
  onEvidence?: (line: PayrollLine) => void;
  onView?: (line: PayrollLine) => void;
}

export function PayrollLinesTable({
  lines,
  onDisburse,
  disburseBlock,
  payoutLabel = 'Record disbursement',
  onReview,
  onReconcile,
  onEvidence,
  onView,
}: Props) {
  if (lines.length === 0) return <p className={styles.muted}>No staff lines in this batch.</p>;
  const showDisbursements = Boolean(
    onDisburse || onReconcile || lines.some((line) => line.disbursement),
  );
  return (
    <div className="table-scroll">
      <Table className={styles.governedTable}>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Name</TableHeaderCell>
            <TableHeaderCell>Rank</TableHeaderCell>
            <TableHeaderCell>Status</TableHeaderCell>
            <TableHeaderCell align="right">BA</TableHeaderCell>
            <TableHeaderCell align="right">PA</TableHeaderCell>
            <TableHeaderCell align="right">PB</TableHeaderCell>
            <TableHeaderCell align="right">Withheld</TableHeaderCell>
            <TableHeaderCell align="right">Net</TableHeaderCell>
            {showDisbursements ? <TableHeaderCell>Disbursement</TableHeaderCell> : null}
          </TableRow>
        </TableHead>
        <TableBody>
          {lines
            .map((line, index) => ({ line, index }))
            .sort((a, b) => attentionRank(a.line) - attentionRank(b.line) || a.index - b.index)
            .map(({ line }) => {
              const blocked = line.status === 'blocked';
              const payable = !blocked && line.net !== null && /[1-9]/.test(line.net);
              return (
                <TableRow key={line.id} data-attention={attentionRank(line) < 2 || undefined}>
                  <TableCell label="Name">
                    {onView ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onView(line)}
                        aria-label={`View payroll for ${line.staffName ?? 'staff'}`}
                      >
                        {line.staffName ?? 'Staff'}
                      </Button>
                    ) : (
                      (line.staffName ?? 'Staff')
                    )}
                  </TableCell>
                  <TableCell label="Rank">{line.rank}</TableCell>
                  <TableCell label="Status" className={styles.governedStatus}>
                    {blocked ? (
                      <div className={styles.stack}>
                        <StatusChip label="Needs configuration" tone="warning" />
                        <span className={styles.muted}>{plainReason(line.blockedReason)}</span>
                      </div>
                    ) : (
                      <div className={styles.stack}>
                        <StatusChip label="Computed" tone="success" />
                        {line.reviewRequired && !line.reviewedAt ? (
                          <>
                            <StatusChip label="Needs review" tone="warning" />
                            <span className={styles.muted}>
                              {line.reviewFlags.map(reviewFlagLabel).join('; ')}
                            </span>
                            {onReview ? (
                              <Button size="sm" variant="secondary" onClick={() => onReview(line)}>
                                Record review
                              </Button>
                            ) : null}
                          </>
                        ) : null}
                        {line.reviewRequired && line.reviewedAt ? (
                          <span className={styles.muted}>
                            Reviewed {formatDate(line.reviewedAt)}
                            {(line.reviewedByName ?? line.reviewedBy)
                              ? ` by ${line.reviewedByName ?? line.reviewedBy}`
                              : ''}
                            : {line.reviewNote}
                          </span>
                        ) : null}
                      </div>
                    )}
                  </TableCell>
                  <TableCell label="BA" align="right">
                    {formatMoney(line.ba)}
                  </TableCell>
                  <TableCell label="PA" align="right">
                    {formatMoney(line.pa)}
                  </TableCell>
                  <TableCell label="PB" align="right">
                    {formatMoney(line.pb)}
                  </TableCell>
                  <TableCell label="Withheld" align="right">
                    {formatMoney(line.withheld)}
                  </TableCell>
                  <TableCell label="Net" align="right">
                    <strong>{formatMoney(line.net)}</strong>
                  </TableCell>
                  {showDisbursements ? (
                    <TableCell label="Disbursement">
                      {line.disbursement ? (
                        <div className={styles.stack}>
                          <StatusChip
                            label={`Paid ${formatDate(line.disbursement.paidOn)}`}
                            tone="success"
                          />
                          {line.disbursement.proofReference ? (
                            <span>Note: {line.disbursement.proofReference}</span>
                          ) : null}
                          {line.disbursement.evidenceStatus === 'EVIDENCE_EXCEPTION' ? (
                            <StatusChip
                              label={
                                line.disbursement.reconciled
                                  ? 'No evidence — exception reviewed'
                                  : 'No verifiable evidence'
                              }
                              tone={line.disbursement.reconciled ? 'info' : 'warning'}
                            />
                          ) : null}
                          {line.disbursement.postingPeriod ? (
                            <span>Posted to {line.disbursement.postingPeriod}</span>
                          ) : null}
                          {onEvidence && line.disbursement.evidenceStatus ? (
                            <Button size="sm" variant="secondary" onClick={() => onEvidence(line)}>
                              Evidence
                            </Button>
                          ) : null}
                          {line.disbursement.evidenceStatus === 'EVIDENCE_EXCEPTION' &&
                          !line.disbursement.evidenceChanged &&
                          !line.disbursement.reconciled &&
                          onReconcile ? (
                            <Button size="sm" onClick={() => onReconcile(line)}>
                              Review reconciliation
                            </Button>
                          ) : null}
                          {line.disbursement.evidenceChanged ? (
                            <>
                              <StatusChip
                                label={
                                  line.disbursement.reconciled
                                    ? 'Evidence discrepancy reviewed'
                                    : 'Evidence changed after approval'
                                }
                                tone="warning"
                              />
                              {line.disbursement.reconciliationNote ? (
                                <span>{line.disbursement.reconciliationNote}</span>
                              ) : null}
                              {!line.disbursement.reconciled && onReconcile ? (
                                <Button size="sm" onClick={() => onReconcile(line)}>
                                  Review reconciliation
                                </Button>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      ) : blocked ? (
                        <span className={styles.muted}>—</span>
                      ) : !payable ? (
                        <span className={styles.muted}>Nothing to pay.</span>
                      ) : !onDisburse ? (
                        <span className={styles.muted}>Payment not recorded.</span>
                      ) : (
                        <div className={styles.stack}>
                          <Button
                            size="sm"
                            disabled={Boolean(disburseBlock)}
                            onClick={() => onDisburse?.(line)}
                          >
                            {payoutLabel}
                          </Button>
                          {disburseBlock ? (
                            <span className={styles.muted}>{disburseBlock}</span>
                          ) : null}
                        </div>
                      )}
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
        </TableBody>
      </Table>
    </div>
  );
}
