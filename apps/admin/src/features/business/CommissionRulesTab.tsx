import { useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CommissionRule } from '@afhomes/contracts';
import {
  Button,
  DateField,
  EmptyState,
  ErrorState,
  FilterBar,
  SearchField,
  Select,
  StatusChip,
  TextField,
  notifyConfirm,
  notifyError,
  notifySuccess,
} from '@afhomes/ui';
import { formatCount } from '@afhomes/shared';

import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { CommissionRuleHistoryDialog } from './CommissionRuleHistoryDialog';
import { CommissionTableSkeleton } from './CommissionSkeletons';
import { formatRate, percentToRate, rateToPercent } from './format';
import { sharedScopes } from './queryKeys';
import { getCommissionRules, updateCommissionRule } from './services';
import styles from './CommissionSettingsPage.module.css';

const TARGET_LABEL: Record<CommissionRule['targetType'], string> = {
  role: 'Position default',
  staff: 'Personal rate',
  ost: 'OST account',
};

const today = () => new Date().toISOString().slice(0, 10);
const emptyEdit = () => ({
  rate: '',
  effectiveFrom: today(),
  effectiveUntil: '',
  accreditedOnOrAfter: '',
});

/** Every rule with edit, enable/disable and audit history. */
export function CommissionRulesTab() {
  const client = useQueryClient();
  const [edit, setEdit] = useState(emptyEdit);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all');
  const editRef = useRef<HTMLElement>(null);

  const rules = useQuery({
    queryKey: sharedScopes.commissionRules,
    queryFn: getCommissionRules,
    placeholderData: keepPreviousData,
  });
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: sharedScopes.commissionRules }),
      client.invalidateQueries({ queryKey: sharedScopes.commissionRoster }),
    ]);

  const cancelEdit = () => {
    setEdit(emptyEdit());
    setEditingId(null);
  };
  const saveEdit = useBusinessMutation({
    mutationFn: () =>
      updateCommissionRule(editingId!, {
        rate: percentToRate(edit.rate)!,
        effectiveFrom: edit.effectiveFrom,
        effectiveUntil: edit.effectiveUntil || null,
        accreditedOnOrAfter: edit.accreditedOnOrAfter || null,
      }),
    onSuccess: async () => {
      cancelEdit();
      await refresh();
      notifySuccess({ title: 'Rule saved', message: 'Changes apply to future sales.' });
    },
    onError: (error) => notifyError({ title: 'Rule not saved', message: error.message }),
  });
  const toggle = useBusinessMutation({
    mutationFn: (rule: CommissionRule) => updateCommissionRule(rule.id, { isActive: !rule.isActive }),
    onSuccess: async (_saved, rule) => {
      await refresh();
      notifySuccess({
        title: rule.isActive ? 'Rule disabled' : 'Rule activated',
        message: rule.isActive ? 'Sellers fall back to other rates.' : 'It applies to future sales.',
      });
    },
    onError: (error) => notifyError({ title: 'Rule not changed', message: error.message }),
  });
  const onToggle = async (rule: CommissionRule) => {
    if (rule.isActive) {
      const confirmed = await notifyConfirm({
        title: 'Disable this rule?',
        message: 'Sellers fall back to other rates.',
        confirmButtonText: 'Disable',
      });
      if (!confirmed) return;
    }
    toggle.mutate(rule);
  };
  const startEdit = (rule: CommissionRule) => {
    setEditingId(rule.id);
    setEdit({
      rate: rateToPercent(rule.rate),
      effectiveFrom: rule.effectiveFrom,
      effectiveUntil: rule.effectiveUntil ?? '',
      accreditedOnOrAfter: rule.accreditedOnOrAfter ?? '',
    });
    // The editor sits above a possibly long list: bring it into view.
    editRef.current?.scrollIntoView?.({ block: 'start' });
    document.getElementById('commission-rate')?.focus({ preventScroll: true });
  };
  const editRate = percentToRate(edit.rate);
  const editValid = editRate !== null && Boolean(edit.effectiveFrom);

  const allRules = useMemo(() => rules.data ?? [], [rules.data]);
  const editingRule = allRules.find((rule) => rule.id === editingId) ?? null;
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allRules.filter((rule) => {
      if (statusFilter === 'active' && !rule.isActive) return false;
      if (statusFilter === 'disabled' && rule.isActive) return false;
      if (!needle) return true;
      return [rule.targetType, rule.targetName ?? '', rule.targetId].some((value) =>
        value.toLowerCase().includes(needle),
      );
    });
  }, [allRules, search, statusFilter]);

  if (rules.isPending) return <CommissionTableSkeleton label="Loading rules" />;
  if (rules.isError) return <ErrorState error={rules.error} onRetry={rules.refetch} />;

  const filtered = Boolean(search.trim()) || statusFilter !== 'all';
  const refetching = rules.isFetching;

  return (
    <div className={styles.tabBody}>
      {editingId ? (
        <section ref={editRef} className={styles.panel} data-editing aria-label="Edit rule">
          <header className={styles.panelHead}>
            <div>
              <h2 className={styles.panelTitle}>Edit rule</h2>
              <p className={styles.panelNote}>
                Only rate and dates can change. Past commissions stay the same.
              </p>
            </div>
            {editingRule ? (
              <StatusChip
                label={`Editing ${editingRule.targetName ?? TARGET_LABEL[editingRule.targetType]}`}
                tone="info"
                icon="pencil"
              />
            ) : null}
          </header>
          <div className={styles.formGrid}>
            <TextField
              id="commission-rate"
              name="rate"
              label="Rate (%)"
              inputMode="decimal"
              value={edit.rate}
              onChange={(value) => setEdit({ ...edit, rate: value })}
              disabled={saveEdit.isPending}
              error={edit.rate && editRate === null ? 'Use 0 to 100.' : undefined}
            />
            <DateField
              id="rule-effective-from"
              name="effectiveFrom"
              label="Effective from"
              value={edit.effectiveFrom}
              onChange={(value) => setEdit({ ...edit, effectiveFrom: value })}
              disabled={saveEdit.isPending}
            />
            <DateField
              id="rule-effective-until"
              name="effectiveUntil"
              label="Effective until"
              optional
              value={edit.effectiveUntil}
              onChange={(value) => setEdit({ ...edit, effectiveUntil: value })}
              disabled={saveEdit.isPending}
            />
            <DateField
              id="rule-accredited-after"
              name="accreditedOnOrAfter"
              label="Accredited on/after"
              optional
              value={edit.accreditedOnOrAfter}
              onChange={(value) => setEdit({ ...edit, accreditedOnOrAfter: value })}
              disabled={saveEdit.isPending}
            />
          </div>
          <div className={styles.formActions}>
            <Button variant="secondary" disabled={saveEdit.isPending} onClick={cancelEdit}>
              Cancel edit
            </Button>
            <Button
              loading={saveEdit.isPending}
              loadingLabel="Saving…"
              disabled={!editValid}
              onClick={() => saveEdit.mutate()}
            >
              Save changes
            </Button>
          </div>
        </section>
      ) : null}

      <FilterBar
        filtersToggleLabel="Expand Filters"
        search={
          <SearchField
            label="Search commission rules"
            placeholder="Target name or type"
            value={search}
            onChange={setSearch}
            busy={refetching}
          />
        }
        filters={
          <label className={styles.field}>
            Status
            <Select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              options={[
                { value: 'all', label: 'All statuses' },
                { value: 'active', label: 'Active' },
                { value: 'disabled', label: 'Disabled' },
              ]}
            />
          </label>
        }
      />
      <h3 className={styles.resultsTitle} aria-live="polite">
        {formatCount(visible.length)} {visible.length === 1 ? 'rule' : 'rules'}
        {filtered ? ` of ${formatCount(allRules.length)}` : ''}
      </h3>

      {visible.length === 0 ? (
        <EmptyState
          title={filtered ? 'No matching records.' : 'No commission rules'}
          description="Sellers without a rate earn 0%."
        />
      ) : (
        <div
          role="region"
          aria-label="Scrollable rules"
          aria-busy={refetching || undefined}
          data-busy={refetching || undefined}
          tabIndex={0}
          className={`table-scroll ${styles.tableWrap} ${styles.queueCard}`}
        >
          <table className={styles.queueTable}>
            <thead>
              <tr>
                <th scope="col">Target</th>
                <th scope="col" className={styles.numeric}>
                  Rate
                </th>
                <th scope="col">Applies</th>
                <th scope="col">Status</th>
                <th scope="col" className={styles.actionHead}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((rule) => {
                const toggling = toggle.isPending && toggle.variables?.id === rule.id;
                return (
                  <tr
                    key={rule.id}
                    data-editing={rule.id === editingId || undefined}
                    data-disabled={!rule.isActive || undefined}
                  >
                    <td data-label="Target" className={styles.targetCell}>
                      <span className={styles.primary}>
                        {rule.targetName ?? <code className={styles.code}>{rule.targetId}</code>}
                      </span>
                      <span className={styles.secondary}>{TARGET_LABEL[rule.targetType]}</span>
                    </td>
                    <td data-label="Rate" className={`${styles.numeric} ${styles.rateCell}`}>
                      {formatRate(rule.rate)}
                    </td>
                    <td data-label="Applies" className={styles.appliesCell}>
                      <dl className={styles.terms}>
                        <div>
                          <dt>From</dt>
                          <dd>{rule.effectiveFrom}</dd>
                        </div>
                        <div>
                          <dt>Until</dt>
                          <dd>{rule.effectiveUntil ?? 'No end date'}</dd>
                        </div>
                        <div>
                          <dt>Accredited</dt>
                          <dd>
                            {rule.accreditedOnOrAfter
                              ? `On/after ${rule.accreditedOnOrAfter}`
                              : 'Any date'}
                          </dd>
                        </div>
                      </dl>
                    </td>
                    <td data-label="Status" className={styles.statusCell}>
                      <StatusChip
                        label={rule.isActive ? 'Active' : 'Disabled'}
                        tone={rule.isActive ? 'success' : 'neutral'}
                      />
                    </td>
                    <td data-label="Actions" className={styles.actionCell}>
                      <span className={styles.actionGroup}>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={toggling}
                          onClick={() => startEdit(rule)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={toggling}
                          loadingLabel={rule.isActive ? 'Disabling…' : 'Activating…'}
                          onClick={() => onToggle(rule)}
                        >
                          {rule.isActive ? 'Disable' : 'Activate'}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={toggling}
                          onClick={() => setHistoryId(rule.id)}
                        >
                          History
                        </Button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <CommissionRuleHistoryDialog ruleId={historyId} onClose={() => setHistoryId(null)} />
    </div>
  );
}
