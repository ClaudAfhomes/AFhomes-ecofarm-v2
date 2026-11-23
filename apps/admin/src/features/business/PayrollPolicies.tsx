import { useState } from 'react';
import { IST_POLICY_REFERENCE, IST_POLICY_TEMPLATES } from '@afhomes/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PayrollPolicy, PolicyLifecycle, PayrollRank } from '@afhomes/contracts';
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
import { formatMoney, formatRate } from './format';
import {
  ApprovePolicyDialog,
  EndPolicyDialog,
  PolicyDraftDialog,
  ReturnPolicyDialog,
} from './PayrollPolicyDialogs';
import { RANK_LABEL, errorMessage, hasPayrollPermission, q1BannerText } from './payroll-utils';
import { getPayrollPolicies, payrollKeys, submitPayrollPolicy } from './services-payroll';
import styles from './IstPayrollPage.module.css';

const TONE: Record<PolicyLifecycle, StatusTone> = {
  draft: 'neutral',
  pending_approval: 'warning',
  approved: 'info',
  active: 'success',
  superseded: 'neutral',
  expired: 'neutral',
  retired: 'neutral',
};
const LABEL: Record<PolicyLifecycle, string> = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  active: 'Active',
  superseded: 'Superseded',
  expired: 'Expired',
  retired: 'Retired',
};
const RANK_ORDER = { SM: 0, SSM: 1, SVD: 2 } as const;

type Dialog =
  | { kind: 'draft'; policy: PayrollPolicy | null; copyFrom?: PayrollPolicy }
  | { kind: 'approve' | 'return' | 'end'; policy: PayrollPolicy };

/** Controlled compensation-policy workflow. The server decides every transition. */
export function PayrollPolicies() {
  const { user } = useSession();
  const client = useQueryClient();
  const canDraft = hasPayrollPermission(user, 'finance.payroll_policy', 'canUpdate');
  const canCreate = hasPayrollPermission(user, 'finance.payroll_policy', 'canCreate');
  const canDecide = hasPayrollPermission(user, 'finance.payroll_policy_approval', 'canUpdate');
  const policies = useQuery({
    queryKey: payrollKeys.policies,
    queryFn: getPayrollPolicies,
    refetchInterval: 30000,
  });
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rankFilter, setRankFilter] = useState<PayrollRank | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const submit = useBusinessMutation({
    mutationFn: (id: string) => submitPayrollPolicy(id),
    onSuccess: () => done('Submitted for approval'),
    onError: (e) => setError(errorMessage(e)),
  });

  async function done(title: string) {
    setDialog(null);
    setError(null);
    notifySuccess({ title });
    await client.invalidateQueries({ queryKey: payrollKeys.all });
  }

  if (policies.isPending) return <Skeleton style={{ height: 160 }} />;
  if (policies.isError) return <ErrorState error={policies.error} onRetry={policies.refetch} />;

  const { data, gate } = policies.data;
  const rows = [...data].sort(
    (a, b) =>
      RANK_ORDER[a.rank] - RANK_ORDER[b.rank] ||
      (b.policyVersion ?? 0) - (a.policyVersion ?? 0) ||
      b.effectiveFrom.localeCompare(a.effectiveFrom),
  );
  const visible = rows.filter(
    (p) =>
      (!rankFilter || p.rank === rankFilter) &&
      (showHistory || !['superseded', 'expired', 'retired'].includes(p.lifecycle ?? p.status)),
  );
  const hasApproved = rows.some(
    (p) => (p.lifecycle ?? p.status) === 'active' || p.status === 'approved',
  );
  const banner = q1BannerText(gate);

  return (
    <div className={styles.form}>
      {banner ? <p className={styles.muted}>{banner}</p> : null}
      <p className={styles.muted}>
        Saving a draft does not approve it. Historical figures are reference only.
      </p>
      <div className={styles.policyRankGrid} role="group" aria-label="Compensation by rank">
        {(Object.keys(RANK_ORDER) as PayrollRank[]).map((rank) => {
          const saved =
            rows.find((p) => p.rank === rank && p.lifecycle === 'active') ??
            rows.find(
              (p) =>
                p.rank === rank &&
                !['superseded', 'expired', 'retired'].includes(p.lifecycle ?? p.status),
            );
          const figures = saved ?? IST_POLICY_TEMPLATES[rank];
          return (
            <button
              type="button"
              key={rank}
              className={styles.policyRankCard}
              aria-pressed={rankFilter === rank}
              onClick={() => setRankFilter(rank)}
            >
              <strong>
                {rank} - {RANK_LABEL[rank]}
              </strong>
              <span>
                BA {formatMoney(figures.monthlyBa)} / PA {formatMoney(figures.monthlyPa)}
              </span>
              <span>PB {formatRate(figures.pbRate)}</span>
              <small>
                {saved
                  ? `${rank}: ${LABEL[saved.lifecycle ?? saved.status]} - Policy v${saved.policyVersion ?? 'legacy'}`
                  : `Historical reference - ${IST_POLICY_REFERENCE.version}`}
              </small>
            </button>
          );
        })}
      </div>
      {!hasApproved ? (
        <p className={styles.muted}>No approved compensation policy exists yet.</p>
      ) : null}
      <div className={styles.actions}>
        <Button disabled={!canCreate} onClick={() => setDialog({ kind: 'draft', policy: null })}>
          New draft
        </Button>
        {rankFilter ? (
          <Button variant="secondary" onClick={() => setRankFilter(null)}>
            All ranks
          </Button>
        ) : null}
        {rows.length ? (
          <Button
            variant="secondary"
            aria-pressed={showHistory}
            onClick={() => setShowHistory((value) => !value)}
          >
            {showHistory ? 'Hide history' : 'View history'}
          </Button>
        ) : null}
        {!canCreate ? (
          <span className={styles.muted}>You do not have permission to draft policies.</span>
        ) : null}
      </div>
      {error && !dialog ? (
        <Alert variant="danger" title="Not done">
          {error}
        </Alert>
      ) : null}
      {rows.length === 0 ? null : (
        <div className="table-scroll">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Rank</TableHeaderCell>
                <TableHeaderCell>Version</TableHeaderCell>
                <TableHeaderCell>Effective</TableHeaderCell>
                <TableHeaderCell align="right">BA (monthly / target)</TableHeaderCell>
                <TableHeaderCell align="right">PA (monthly / target)</TableHeaderCell>
                <TableHeaderCell align="right">PB (target @ rate)</TableHeaderCell>
                <TableHeaderCell>Collection gate</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Next step</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((p) => {
                const life =
                  p.lifecycle ?? (p.status === 'pending_approval' ? 'pending_approval' : p.status);
                const approvalConflict = p.approvalConflict || p.createdBy === user?.id;
                return (
                  <TableRow key={p.id}>
                    <TableCell label="Rank">
                      {p.rank} <span className={styles.muted}>{RANK_LABEL[p.rank]}</span>
                    </TableCell>
                    <TableCell label="Version">
                      {p.policyVersion ? `v${p.policyVersion}` : '—'}
                    </TableCell>
                    <TableCell label="Effective">
                      {formatDate(p.effectiveFrom)} –{' '}
                      {p.effectiveUntil ? formatDate(p.effectiveUntil) : 'open'}
                    </TableCell>
                    <TableCell label="BA" align="right">
                      {formatMoney(p.monthlyBa)} / {formatMoney(p.baTarget)}
                    </TableCell>
                    <TableCell label="PA" align="right">
                      {formatMoney(p.monthlyPa)} / {formatMoney(p.paTarget)}
                    </TableCell>
                    <TableCell label="PB" align="right">
                      {formatMoney(p.pbTarget)} @ {formatRate(p.pbRate)}
                    </TableCell>
                    <TableCell label="Collection gate">{formatRate(p.collectionGate)}</TableCell>
                    <TableCell label="Status">
                      <StatusChip label={LABEL[life]} tone={TONE[life]} />
                    </TableCell>
                    <TableCell label="Next step">
                      <div className={styles.stack}>
                        <div className={styles.actions}>
                          {life === 'draft' ? (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={!canDraft}
                                onClick={() => setDialog({ kind: 'draft', policy: p })}
                              >
                                Edit draft
                              </Button>
                              <Button
                                size="sm"
                                disabled={!canDraft}
                                loading={submit.isPending}
                                onClick={() => {
                                  setError(null);
                                  submit.mutate(p.id);
                                }}
                              >
                                Submit for approval
                              </Button>
                            </>
                          ) : null}
                          {life === 'pending_approval' ? (
                            <>
                              <Button
                                size="sm"
                                disabled={!canDecide || approvalConflict}
                                onClick={() => setDialog({ kind: 'approve', policy: p })}
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={!canDecide}
                                onClick={() => setDialog({ kind: 'return', policy: p })}
                              >
                                Return
                              </Button>
                            </>
                          ) : null}
                          {p.status === 'approved' && canCreate ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                setDialog({ kind: 'draft', policy: null, copyFrom: p })
                              }
                            >
                              Create new version
                            </Button>
                          ) : null}
                          {life === 'approved' || life === 'active' ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={!canDecide}
                              onClick={() => setDialog({ kind: 'end', policy: p })}
                            >
                              End
                            </Button>
                          ) : null}
                        </div>
                        {life === 'draft' && !canDraft ? (
                          <span className={styles.muted}>
                            No permission to edit or submit drafts.
                          </span>
                        ) : null}
                        {life === 'pending_approval' && !canDecide ? (
                          <span className={styles.muted}>Waiting for Super Admin approval.</span>
                        ) : null}
                        {life === 'pending_approval' && canDecide && approvalConflict ? (
                          <span className={styles.muted}>
                            You prepared or submitted this policy. Another approver must decide.
                          </span>
                        ) : null}
                        {(life === 'approved' || life === 'active') && !canDecide ? (
                          <span className={styles.muted}>
                            Only the approver role can end a policy.
                          </span>
                        ) : null}
                        <details className={styles.policyDetails}>
                          <summary>Policy details</summary>
                          <p>{p.basisNote}</p>
                          <p>QP/EP: {p.qpEpRuleReference ?? 'No reference recorded'}</p>
                          <p>
                            Performance: {p.kpiCollectionPolicyReference ?? 'No reference recorded'}
                          </p>
                          <p>
                            Approved: {p.approvedAt ? formatDate(p.approvedAt) : 'Not approved'}
                          </p>
                          {p.lastFinalizedPeriod ? (
                            <p>Last finalized payroll: {p.lastFinalizedPeriod}</p>
                          ) : null}
                        </details>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {dialog?.kind === 'draft' ? (
        <PolicyDraftDialog
          policy={dialog.policy}
          copyFrom={dialog.copyFrom}
          initialRank={rankFilter ?? 'SM'}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : dialog?.kind === 'approve' ? (
        <ApprovePolicyDialog policy={dialog.policy} onClose={() => setDialog(null)} onDone={done} />
      ) : dialog?.kind === 'return' ? (
        <ReturnPolicyDialog policy={dialog.policy} onClose={() => setDialog(null)} onDone={done} />
      ) : dialog?.kind === 'end' ? (
        <EndPolicyDialog policy={dialog.policy} onClose={() => setDialog(null)} onDone={done} />
      ) : null}
    </div>
  );
}
