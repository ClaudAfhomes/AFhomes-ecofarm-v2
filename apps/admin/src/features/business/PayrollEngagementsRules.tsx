import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IstEngagement, IstPerformanceRule } from '@afhomes/contracts';
import { qualifyingPeriodEnd } from '@afhomes/shared';
import {
  Alert,
  Button,
  ErrorState,
  Skeleton,
  StatusChip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  notifySuccess,
} from '@afhomes/ui';
import type { StatusTone } from '@afhomes/ui';

import { formatDate } from '../../lib/format';
import { useSession } from '../../lib/session';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import {
  EngagementDraftDialog,
  EngagementEndDialog,
  GovernedApproveDialog,
  GovernedReturnDialog,
  RuleDraftDialog,
  RuleEndDialog,
} from './PayrollGovernedDialogs';
import {
  ATTRIBUTION_LABEL,
  COUNT_DATE_LABEL,
  RANK_LABEL,
  errorMessage,
  hasPayrollPermission,
} from './payroll-utils';
import {
  getIstEngagements,
  getIstPerformanceRules,
  payrollKeys,
  submitGoverned,
  type GovernedKind,
} from './services-payroll';
import styles from './IstPayrollPage.module.css';

type GovernedStatus = IstEngagement['status'];

const TONE: Record<GovernedStatus, StatusTone> = {
  draft: 'neutral',
  pending_approval: 'warning',
  approved: 'success',
};
const LABEL: Record<GovernedStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  approved: 'Approved',
};

const POLL_MS = 30_000;
const NOT_DECIDED = 'Not decided';

type Dialog =
  { kind: 'draft'; id: string | null } | { kind: 'approve' | 'return' | 'end'; id: string };

/** Shared permission and mutation plumbing for both governed lists. */
function useGoverned(kind: GovernedKind) {
  const { user } = useSession();
  const client = useQueryClient();
  const canCreate = hasPayrollPermission(user, 'finance.payroll_policy', 'canCreate');
  const canDraft = hasPayrollPermission(user, 'finance.payroll_policy', 'canUpdate');
  const canDecide = hasPayrollPermission(user, 'finance.payroll_policy_approval', 'canUpdate');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function done(title: string) {
    setDialog(null);
    setError(null);
    notifySuccess({ title });
    await client.invalidateQueries({ queryKey: payrollKeys.all });
  }
  const submit = useBusinessMutation({
    mutationFn: (id: string) => submitGoverned(kind, id),
    onSuccess: () => done('Submitted for approval'),
    onError: (e) => setError(errorMessage(e)),
  });
  return { canCreate, canDraft, canDecide, dialog, setDialog, error, setError, done, submit };
}

interface ActionsProps {
  status: GovernedStatus;
  returnReason: string | null;
  canDraft: boolean;
  canDecide: boolean;
  submitting: boolean;
  /** Disables End with a reason (for example when everything is already set). */
  endBlock?: string | null;
  onEdit: () => void;
  onSubmit: () => void;
  onApprove: () => void;
  onReturn: () => void;
  onEnd: () => void;
}

function RowActions(p: ActionsProps) {
  return (
    <div className={styles.stack}>
      <div className={styles.actions}>
        {p.status === 'draft' ? (
          <>
            <Button size="sm" variant="secondary" disabled={!p.canDraft} onClick={p.onEdit}>
              Edit draft
            </Button>
            <Button size="sm" disabled={!p.canDraft} loading={p.submitting} onClick={p.onSubmit}>
              Submit for approval
            </Button>
          </>
        ) : null}
        {p.status === 'pending_approval' ? (
          <>
            <Button size="sm" disabled={!p.canDecide} onClick={p.onApprove}>
              Approve
            </Button>
            <Button size="sm" variant="secondary" disabled={!p.canDecide} onClick={p.onReturn}>
              Return
            </Button>
          </>
        ) : null}
        {p.status === 'approved' ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={!p.canDecide || Boolean(p.endBlock)}
            onClick={p.onEnd}
          >
            End
          </Button>
        ) : null}
      </div>
      {p.status === 'draft' && p.returnReason ? (
        <span className={styles.muted}>Returned: {p.returnReason}</span>
      ) : null}
      {p.status === 'draft' && !p.canDraft ? (
        <span className={styles.muted}>No permission to edit or submit drafts.</span>
      ) : null}
      {p.status === 'pending_approval' && !p.canDecide ? (
        <span className={styles.muted}>Waiting for Super Admin approval.</span>
      ) : null}
      {p.status === 'approved' && !p.canDecide ? (
        <span className={styles.muted}>Only the approver role can end this.</span>
      ) : p.status === 'approved' && p.endBlock ? (
        <span className={styles.muted}>{p.endBlock}</span>
      ) : null}
    </div>
  );
}

/** IST engagements: who is engaged at which rank, from which contract date. */
export function PayrollEngagements() {
  const g = useGoverned('engagements');
  const list = useQuery({
    queryKey: payrollKeys.engagements,
    queryFn: getIstEngagements,
    refetchInterval: POLL_MS,
  });

  if (list.isPending) return <Skeleton style={{ height: 120 }} />;
  if (list.isError) return <ErrorState error={list.error} onRetry={list.refetch} />;
  const rows = list.data;
  const target = g.dialog && 'id' in g.dialog ? rows.find((r) => r.id === g.dialog!.id) : undefined;

  return (
    <div className={styles.form}>
      <h2 className={styles.heading}>IST engagements</h2>
      <p className={styles.muted}>
        An engagement sets a staff member&apos;s rank and contract dates. Only approved engagements
        count toward performance.
      </p>
      <div className={styles.actions}>
        <Button disabled={!g.canCreate} onClick={() => g.setDialog({ kind: 'draft', id: null })}>
          New engagement
        </Button>
        {!g.canCreate ? (
          <span className={styles.muted}>You do not have permission to draft engagements.</span>
        ) : null}
      </div>
      {g.error && !g.dialog ? (
        <Alert variant="danger" title="Not done">
          {g.error}
        </Alert>
      ) : null}
      {rows.length === 0 ? (
        <p className={styles.muted}>No engagements yet.</p>
      ) : (
        <div className="table-scroll">
          <Table className={styles.governedTable}>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Staff</TableHeaderCell>
                <TableHeaderCell>Rank</TableHeaderCell>
                <TableHeaderCell>Contract start</TableHeaderCell>
                <TableHeaderCell>Contract end</TableHeaderCell>
                <TableHeaderCell>Suspended from</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Approved by</TableHeaderCell>
                <TableHeaderCell>Next step</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell label="Staff">{e.staffName ?? '—'}</TableCell>
                  <TableCell label="Rank">
                    {e.rank} <span className={styles.muted}>{RANK_LABEL[e.rank]}</span>
                  </TableCell>
                  <TableCell label="Contract start">
                    <div className={styles.stack}>
                      <span>{formatDate(e.contractStart)}</span>
                      <span>QP ends {formatDate(qualifyingPeriodEnd(e.contractStart))}</span>
                      <span>
                        EP starts{' '}
                        {formatDate(
                          new Date(
                            Date.parse(`${qualifyingPeriodEnd(e.contractStart)}T00:00:00Z`) +
                              86_400_000,
                          )
                            .toISOString()
                            .slice(0, 10),
                        )}
                      </span>
                      <span>
                        QP BA{' '}
                        {e.qpBaApproved == null
                          ? 'awaiting an authorized decision'
                          : e.qpBaApproved
                            ? 'qualified'
                            : 'not qualified'}
                      </span>
                      {e.qpDecisionReference ? <span>{e.qpDecisionReference}</span> : null}
                    </div>
                  </TableCell>
                  <TableCell label="Contract end">
                    {e.contractEnd ? formatDate(e.contractEnd) : '—'}
                  </TableCell>
                  <TableCell label="Suspended from">
                    {e.suspendedFrom ? formatDate(e.suspendedFrom) : '—'}
                  </TableCell>
                  <TableCell label="Status" className={styles.governedStatus}>
                    <StatusChip label={LABEL[e.status]} tone={TONE[e.status]} />
                  </TableCell>
                  <TableCell label="Approved by">{e.approvedByName ?? '—'}</TableCell>
                  <TableCell label="Next step">
                    <RowActions
                      status={e.status}
                      returnReason={e.returnReason}
                      canDraft={g.canDraft}
                      canDecide={g.canDecide}
                      submitting={g.submit.isPending}
                      endBlock={
                        e.contractEnd && e.suspendedFrom
                          ? 'The end and suspension dates are already set.'
                          : null
                      }
                      onEdit={() => g.setDialog({ kind: 'draft', id: e.id })}
                      onSubmit={() => {
                        g.setError(null);
                        g.submit.mutate(e.id);
                      }}
                      onApprove={() => g.setDialog({ kind: 'approve', id: e.id })}
                      onReturn={() => g.setDialog({ kind: 'return', id: e.id })}
                      onEnd={() => g.setDialog({ kind: 'end', id: e.id })}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {g.dialog?.kind === 'draft' ? (
        <EngagementDraftDialog
          engagement={target ?? null}
          onClose={() => g.setDialog(null)}
          onDone={g.done}
        />
      ) : g.dialog?.kind === 'approve' && target ? (
        <GovernedApproveDialog
          kind="engagements"
          id={target.id}
          subject="engagement"
          onClose={() => g.setDialog(null)}
          onDone={g.done}
        />
      ) : g.dialog?.kind === 'return' && target ? (
        <GovernedReturnDialog
          kind="engagements"
          id={target.id}
          subject="engagement"
          onClose={() => g.setDialog(null)}
          onDone={g.done}
        />
      ) : g.dialog?.kind === 'end' && target ? (
        <EngagementEndDialog
          engagement={target}
          onClose={() => g.setDialog(null)}
          onDone={g.done}
        />
      ) : null}
    </div>
  );
}

const pct = (v: string | null) => (v === null ? NOT_DECIDED : `${v}%`);

/** IST performance rules. No value is pre-filled and none is approved by saving. */
export function PayrollPerformanceRules() {
  const g = useGoverned('performance-rules');
  const list = useQuery({
    queryKey: payrollKeys.rules,
    queryFn: getIstPerformanceRules,
    refetchInterval: POLL_MS,
  });

  if (list.isPending) return <Skeleton style={{ height: 120 }} />;
  if (list.isError) return <ErrorState error={list.error} onRetry={list.refetch} />;
  const rows: IstPerformanceRule[] = list.data;
  const target = g.dialog && 'id' in g.dialog ? rows.find((r) => r.id === g.dialog!.id) : undefined;
  const anyApproved = rows.some((r) => r.status === 'approved');

  return (
    <div className={styles.form}>
      <h2 className={styles.heading}>Performance rules</h2>
      <Alert variant="info" title="Drafts are not approvals">
        No rule is approved. Values must come from an approved Presidential decision; saving or
        submitting never approves.
      </Alert>
      {!anyApproved && rows.length > 0 ? (
        <p className={styles.muted}>No performance rule is approved yet.</p>
      ) : null}
      <div className={styles.actions}>
        <Button disabled={!g.canCreate} onClick={() => g.setDialog({ kind: 'draft', id: null })}>
          New rule
        </Button>
        {!g.canCreate ? (
          <span className={styles.muted}>You do not have permission to draft rules.</span>
        ) : null}
      </div>
      {g.error && !g.dialog ? (
        <Alert variant="danger" title="Not done">
          {g.error}
        </Alert>
      ) : null}
      {rows.length === 0 ? (
        <p className={styles.muted}>No performance rules yet.</p>
      ) : (
        <div className="table-scroll">
          <Table className={styles.governedTable}>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Version</TableHeaderCell>
                <TableHeaderCell>Effective</TableHeaderCell>
                <TableHeaderCell>Attribution</TableHeaderCell>
                <TableHeaderCell align="right">Closed-deal threshold</TableHeaderCell>
                <TableHeaderCell>Count date</TableHeaderCell>
                <TableHeaderCell align="right">Assumed credit</TableHeaderCell>
                <TableHeaderCell>Adjustments</TableHeaderCell>
                <TableHeaderCell>Source</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Approved by</TableHeaderCell>
                <TableHeaderCell>Next step</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell label="Version">v{r.ruleVersion}</TableCell>
                  <TableCell label="Effective">
                    {formatDate(r.effectiveFrom)} –{' '}
                    {r.effectiveUntil ? formatDate(r.effectiveUntil) : 'open'}
                  </TableCell>
                  <TableCell label="Attribution">
                    {r.attributionBasis ? ATTRIBUTION_LABEL[r.attributionBasis] : NOT_DECIDED}
                  </TableCell>
                  <TableCell label="Closed-deal threshold" align="right">
                    {pct(r.closedDealThresholdPct)}
                  </TableCell>
                  <TableCell label="Count date">
                    {r.countDateBasis ? COUNT_DATE_LABEL[r.countDateBasis] : NOT_DECIDED}
                  </TableCell>
                  <TableCell label="Assumed credit" align="right">
                    {r.assumedCreditRate ?? NOT_DECIDED}
                  </TableCell>
                  <TableCell label="Adjustments">
                    {r.adjustmentTreatment === 'report_only' ? 'Report only' : NOT_DECIDED}
                  </TableCell>
                  <TableCell label="Source">{r.sourceReference}</TableCell>
                  <TableCell label="Status" className={styles.governedStatus}>
                    <StatusChip label={LABEL[r.status]} tone={TONE[r.status]} />
                  </TableCell>
                  <TableCell label="Approved by">{r.approvedByName ?? '—'}</TableCell>
                  <TableCell label="Next step">
                    <RowActions
                      status={r.status}
                      returnReason={r.returnReason}
                      canDraft={g.canDraft}
                      canDecide={g.canDecide}
                      submitting={g.submit.isPending}
                      onEdit={() => g.setDialog({ kind: 'draft', id: r.id })}
                      onSubmit={() => {
                        g.setError(null);
                        g.submit.mutate(r.id);
                      }}
                      onApprove={() => g.setDialog({ kind: 'approve', id: r.id })}
                      onReturn={() => g.setDialog({ kind: 'return', id: r.id })}
                      onEnd={() => g.setDialog({ kind: 'end', id: r.id })}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {g.dialog?.kind === 'draft' ? (
        <RuleDraftDialog rule={target ?? null} onClose={() => g.setDialog(null)} onDone={g.done} />
      ) : g.dialog?.kind === 'approve' && target ? (
        <GovernedApproveDialog
          kind="performance-rules"
          id={target.id}
          subject="rule"
          onClose={() => g.setDialog(null)}
          onDone={g.done}
        />
      ) : g.dialog?.kind === 'return' && target ? (
        <GovernedReturnDialog
          kind="performance-rules"
          id={target.id}
          subject="rule"
          onClose={() => g.setDialog(null)}
          onDone={g.done}
        />
      ) : g.dialog?.kind === 'end' && target ? (
        <RuleEndDialog rule={target} onClose={() => g.setDialog(null)} onDone={g.done} />
      ) : null}
    </div>
  );
}

/** The "Engagements & rules" tab. */
export function PayrollEngagementsRules() {
  return (
    <div className={styles.form}>
      <PayrollEngagements />
      <PayrollPerformanceRules />
    </div>
  );
}
