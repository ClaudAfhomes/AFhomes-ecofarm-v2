import { useState } from 'react';
import { IST_POLICY_REFERENCE, IST_POLICY_TEMPLATES } from '@afhomes/shared';
import { useQueryClient } from '@tanstack/react-query';
import type {
  PayrollBatchDetail,
  PayrollLine,
  PayrollRank,
  PayrollRosterEntry,
  SimulatePayrollRequest,
  SimulationLineInput,
  SimulationPolicySnapshot,
} from '@afhomes/contracts';
import { Alert, Button, DateField, Select, StatusChip, TextField } from '@afhomes/ui';

import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { PayrollSimulationRun } from './PayrollSimulationRun';
import { PayrollStaffPicker } from './PayrollStaffPicker';
import { percentToRate, rateToPercent } from './format';
import { errorMessage, payrollMonthLabel } from './payroll-utils';
import { payrollKeys, simulatePayroll } from './services-payroll';
import styles from './IstPayrollPage.module.css';

const RANKS: PayrollRank[] = ['SM', 'SSM', 'SVD'];

const POLICY_FIELDS: { key: Exclude<keyof SimulationPolicySnapshot, 'version'>; label: string }[] =
  [
    { key: 'monthlyBa', label: 'Monthly BA' },
    { key: 'baTarget', label: 'BA target' },
    { key: 'monthlyPa', label: 'Monthly PA' },
    { key: 'paTarget', label: 'PA target' },
    { key: 'pbTarget', label: 'PB target' },
    { key: 'pbRate', label: 'PB rate (%)' },
    { key: 'collectionGate', label: 'Collection gate (%)' },
  ];

type PolicyForm = Record<'version' | (typeof POLICY_FIELDS)[number]['key'], string>;
const emptyPolicy = (): PolicyForm => ({
  version: '',
  monthlyBa: '',
  baTarget: '',
  monthlyPa: '',
  paTarget: '',
  pbTarget: '',
  pbRate: '',
  collectionGate: '',
});

interface StaffForm {
  contractStart: string;
  qpKpi: string;
  qpCollection: string;
  epKpi: string;
  epCollection: string;
  qpBaApproved: 'unknown' | 'yes' | 'no';
  authorizedAdjustments: string;
}
const emptyStaff = (): StaffForm => ({
  contractStart: '',
  qpKpi: '',
  qpCollection: '',
  epKpi: '',
  epCollection: '',
  qpBaApproved: 'unknown',
  authorizedAdjustments: '',
});

interface Props {
  period: string;
  months: string[];
  onPeriodChange: (period: string) => void;
  canRun: boolean;
  /** Staff already known from this month's live batch; pre-fills the staff rows. */
  liveLines: PayrollLine[];
  userId: string | undefined;
  canSubmit: boolean;
  canApprove: boolean;
  canClose: boolean;
}

/**
 * Labelled simulation. It carries explicitly supplied reference figures and
 * rehearses submit, approve, payout and close in isolated simulation records
 * (`PayrollSimulationRun`); nothing here reaches real finance totals.
 */
export function PayrollSimulation({
  period,
  months,
  onPeriodChange,
  canRun,
  liveLines,
  userId,
  canSubmit,
  canApprove,
  canClose,
}: Props) {
  const client = useQueryClient();
  const [basis, setBasis] = useState('');
  const [policies, setPolicies] = useState<Record<PayrollRank, PolicyForm>>({
    SM: emptyPolicy(),
    SSM: emptyPolicy(),
    SVD: emptyPolicy(),
  });
  const [staff, setStaff] = useState<Record<string, StaffForm>>({});
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [dropped, setDropped] = useState<string[]>([]);
  const [result, setResult] = useState<PayrollBatchDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const known = new Map<string, string>(
    liveLines.map((l) => [l.staffId, `${l.staffName ?? 'Staff'} (${l.rank})`]),
  );
  for (const [id, label] of Object.entries(picked)) known.set(id, label);
  for (const id of dropped) known.delete(id);
  const staffIds = [...known.keys()];
  const selectedIds = new Set(staffIds);

  const addStaff = (e: PayrollRosterEntry) => {
    if (selectedIds.has(e.id)) return;
    setPicked((p) => ({ ...p, [e.id]: `${e.name ?? 'Staff'} (${e.rank})` }));
    setDropped((d) => d.filter((id) => id !== e.id));
  };
  const removeStaff = (id: string) => {
    setPicked((p) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== id)));
    setDropped((d) => (d.includes(id) ? d : [...d, id]));
  };

  const setPolicy = (rank: PayrollRank, key: keyof PolicyForm, value: string) =>
    setPolicies((p) => ({ ...p, [rank]: { ...p[rank], [key]: value } }));
  const setStaffField = (id: string, key: keyof StaffForm, value: string) =>
    setStaff((s) => ({ ...s, [id]: { ...(s[id] ?? emptyStaff()), [key]: value } }));

  const run = useBusinessMutation({
    mutationFn: () => {
      const policySnapshot: SimulatePayrollRequest['policySnapshot'] = {};
      for (const rank of RANKS) {
        const f = policies[rank];
        if (f.version.trim()) {
          policySnapshot[rank] = {
            ...f,
            version: f.version.trim(),
            pbRate: percentToRate(f.pbRate) ?? '',
            collectionGate: percentToRate(f.collectionGate) ?? '',
          } as SimulationPolicySnapshot;
        }
      }
      const lines: SimulationLineInput[] = staffIds.flatMap((id) => {
        const f = staff[id];
        if (!f?.contractStart) return [];
        return [
          {
            staffId: id,
            contractStart: f.contractStart,
            qp: { kpi: f.qpKpi || '0.00', collection: f.qpCollection || '0.00' },
            ep: { kpi: f.epKpi || '0.00', collection: f.epCollection || '0.00' },
            qpBaApproved: f.qpBaApproved === 'unknown' ? null : f.qpBaApproved === 'yes',
            ...(f.authorizedAdjustments ? { authorizedAdjustments: f.authorizedAdjustments } : {}),
          },
        ];
      });
      return simulatePayroll({ period, simulationBasis: basis.trim(), policySnapshot, lines });
    },
    onSuccess: async (data) => {
      setResult(data);
      setError(null);
      await client.invalidateQueries({ queryKey: payrollKeys.all });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const anyPolicy = RANKS.some((r) => policies[r].version.trim());
  const runBlock = !canRun
    ? 'You do not have permission to run simulations.'
    : basis.trim().length < 10
      ? 'Describe the source of the figures (at least 10 characters).'
      : !anyPolicy
        ? 'Enter a reference policy for at least one rank.'
        : null;

  return (
    <div className={styles.form}>
      <div className={styles.badge}>
        <StatusChip label="SIMULATION — not payable" tone="warning" />
      </div>
      <p className={styles.muted}>
        Rehearse the full workflow with reference figures you supply. Simulations use isolated
        records and never affect real finance totals. Figures are never saved as policy.
      </p>

      <label className={styles.field}>
        Month
        <Select
          aria-label="Simulation month"
          value={period}
          onChange={(event) => onPeriodChange(event.target.value)}
          options={months.map((m) => ({ value: m, label: payrollMonthLabel(m) }))}
        />
      </label>

      <TextField
        id="sim-basis"
        name="simulationBasis"
        label="Simulation basis note"
        value={basis}
        onChange={setBasis}
        hint="Where these figures come from (at least 10 characters)."
      />

      {RANKS.map((rank) => (
        <fieldset key={rank} className={styles.fieldset}>
          <legend>{rank} reference policy</legend>
          <Button
            variant="secondary"
            size="sm"
            disabled={!canRun}
            onClick={() => {
              const { rank: templateRank, ...reference } = IST_POLICY_TEMPLATES[rank];
              setPolicies((previous) => ({
                ...previous,
                [templateRank]: {
                  ...reference,
                  pbRate: rateToPercent(reference.pbRate),
                  collectionGate: rateToPercent(reference.collectionGate),
                },
              }));
              if (!basis.trim())
                setBasis(`${IST_POLICY_REFERENCE.version}: historical reference simulation only`);
            }}
          >
            Load {rank} historical reference
          </Button>
          <TextField
            id={`sim-${rank}-version`}
            name={`${rank}-version`}
            label="Policy version / source"
            value={policies[rank].version}
            onChange={(v) => setPolicy(rank, 'version', v)}
            hint="Leave blank to skip this rank."
          />
          <div className={styles.grid}>
            {POLICY_FIELDS.map((field) => (
              <TextField
                key={field.key}
                id={`sim-${rank}-${field.key}`}
                name={`${rank}-${field.key}`}
                label={field.label}
                value={policies[rank][field.key]}
                onChange={(v) => setPolicy(rank, field.key, v)}
                inputMode="decimal"
              />
            ))}
          </div>
        </fieldset>
      ))}

      <h3 className={styles.heading}>Staff inputs</h3>
      <PayrollStaffPicker selectedIds={selectedIds} onSelect={addStaff} />
      {staffIds.length === 0 ? (
        <p className={styles.muted}>Search above to add staff to this simulation.</p>
      ) : (
        <ul className={styles.chips} aria-label="Selected staff">
          {staffIds.map((id) => (
            <li key={id} className={styles.chip}>
              {known.get(id)}
              <Button
                variant="secondary"
                size="sm"
                aria-label={`Remove ${known.get(id)}`}
                onClick={() => removeStaff(id)}
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      )}
      {staffIds.map((id) => {
        const f = staff[id] ?? emptyStaff();
        return (
          <fieldset key={id} className={styles.fieldset}>
            <legend>{known.get(id)}</legend>
            <div className={styles.grid}>
              <DateField
                id={`sim-${id}-start`}
                name="contractStart"
                label="Contract start"
                value={f.contractStart}
                onChange={(v) => setStaffField(id, 'contractStart', v)}
              />
              <TextField
                id={`sim-${id}-qpk`}
                name="qpKpi"
                label="QP KPI"
                value={f.qpKpi}
                onChange={(v) => setStaffField(id, 'qpKpi', v)}
                inputMode="decimal"
              />
              <TextField
                id={`sim-${id}-qpc`}
                name="qpCollection"
                label="QP collection"
                value={f.qpCollection}
                onChange={(v) => setStaffField(id, 'qpCollection', v)}
                inputMode="decimal"
              />
              <TextField
                id={`sim-${id}-epk`}
                name="epKpi"
                label="EP KPI"
                value={f.epKpi}
                onChange={(v) => setStaffField(id, 'epKpi', v)}
                inputMode="decimal"
              />
              <TextField
                id={`sim-${id}-epc`}
                name="epCollection"
                label="EP collection"
                value={f.epCollection}
                onChange={(v) => setStaffField(id, 'epCollection', v)}
                inputMode="decimal"
              />
              <TextField
                id={`sim-${id}-adj`}
                name="authorizedAdjustments"
                label="Authorized adjustments"
                value={f.authorizedAdjustments}
                onChange={(v) => setStaffField(id, 'authorizedAdjustments', v)}
                inputMode="decimal"
                optional
              />
              <label className={styles.field}>
                QP BA approved
                <Select
                  aria-label={`QP BA approved ${id}`}
                  value={f.qpBaApproved}
                  onChange={(e) => setStaffField(id, 'qpBaApproved', e.target.value)}
                  options={[
                    { value: 'unknown', label: 'Not decided' },
                    { value: 'yes', label: 'Approved' },
                    { value: 'no', label: 'Not approved' },
                  ]}
                />
              </label>
            </div>
          </fieldset>
        );
      })}
      <div className={styles.actions}>
        <Button loading={run.isPending} disabled={runBlock !== null} onClick={() => run.mutate()}>
          Run simulation
        </Button>
        {runBlock ? <span className={styles.muted}>{runBlock}</span> : null}
      </div>

      {error ? (
        <Alert variant="danger" title="Not done">
          {error}
        </Alert>
      ) : null}

      {result ? (
        <PayrollSimulationRun
          batchId={result.id}
          userId={userId}
          canSubmit={canSubmit}
          canApprove={canApprove}
          canClose={canClose}
          canPay={canSubmit}
        />
      ) : null}
    </div>
  );
}
