import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import type { CommissionRule } from '@afhomes/contracts';
import {
  Alert,
  Button,
  DateField,
  Dialog,
  EmptyState,
  ErrorState,
  FilterBar,
  MetricCard,
  PageHeader,
  SearchField,
  Select,
  Skeleton,
  StatusChip,
  TextField,
} from '@afhomes/ui';

import { formatRate } from './format';
import { formatCountOrDash } from '@afhomes/shared';
import {
  createCommissionRule,
  getCommissionRuleHistory,
  getCommissionRules,
  updateCommissionRule,
} from './services';
import { sharedScopes } from './queryKeys';
import { useSession } from '../../lib/session';
import styles from './CommissionSettingsPage.module.css';

const initialForm = () => ({
  targetType: 'role' as 'role' | 'staff' | 'ost',
  targetId: '',
  rate: '0',
  effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveUntil: '',
  accreditedOnOrAfter: '',
});

export function CommissionSettingsPage() {
  const client = useQueryClient();
  const { user } = useSession();
  const mayManage =
    user?.afHomesPermissions.some(
      (permission) => permission.moduleKey === 'network.commissions' && permission.canUpdate,
    ) === true;
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all');
  const rules = useQuery({
    queryKey: sharedScopes.commissionRules,
    queryFn: getCommissionRules,
    enabled: mayManage,
    // Keep the previous list on screen while a mutation refresh lands: the
    // skeleton only ever appears on first load.
    placeholderData: keepPreviousData,
  });
  const refresh = () => client.invalidateQueries({ queryKey: sharedScopes.commissionRules });
  const create = useBusinessMutation({
    mutationFn: () =>
      editingId
        ? updateCommissionRule(editingId, {
            rate: form.rate,
            effectiveFrom: form.effectiveFrom,
            effectiveUntil: form.effectiveUntil || null,
            accreditedOnOrAfter: form.accreditedOnOrAfter || null,
          })
        : createCommissionRule({
            targetType: form.targetType,
            targetId: form.targetId,
            rate: form.rate,
            effectiveFrom: form.effectiveFrom,
            ...(form.effectiveUntil ? { effectiveUntil: form.effectiveUntil } : {}),
            ...(form.accreditedOnOrAfter ? { accreditedOnOrAfter: form.accreditedOnOrAfter } : {}),
          }),
    onSuccess: async () => {
      setForm(initialForm());
      setEditingId(null);
      await refresh();
    },
  });
  const toggle = useBusinessMutation({
    mutationFn: (rule: CommissionRule) =>
      updateCommissionRule(rule.id, { isActive: !rule.isActive }),
    onSuccess: refresh,
  });
  const valid =
    /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(form.targetId) &&
    /^\d+(\.\d{1,4})?$/.test(form.rate) &&
    Number(form.rate) >= 0 &&
    Number(form.rate) <= 1;
  const history = useQuery({
    queryKey: sharedScopes.commissionRuleHistory(historyId),
    queryFn: () => getCommissionRuleHistory(historyId!),
    enabled: Boolean(historyId),
  });

  const allRules = useMemo(() => rules.data ?? [], [rules.data]);
  // Headline counts from the loaded rules.
  const summary = useMemo(() => {
    const active = allRules.filter((rule) => rule.isActive).length;
    return { total: allRules.length, active, disabled: allRules.length - active };
  }, [allRules]);
  // Client-side search and status filter over the loaded rules.
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allRules.filter((rule) => {
      if (statusFilter === 'active' && !rule.isActive) return false;
      if (statusFilter === 'disabled' && rule.isActive) return false;
      if (!term) return true;
      return [rule.targetType, rule.targetName ?? '', rule.targetId].some((value) =>
        value.toLowerCase().includes(term),
      );
    });
  }, [allRules, search, statusFilter]);

  if (!mayManage)
    return (
      <section className={styles.page}>
        <PageHeader
          title="Commission Settings"
          description="Direct seller commission rate rules."
        />
        <p role="alert">You do not have permission to manage commission rules.</p>
      </section>
    );

  // First load skeletonizes the whole page: header, form, filters and table.
  // Refetches keep the previous list visible via placeholderData and never
  // reach this branch.
  if (rules.isPending)
    return (
      <section className={styles.page}>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading commission rules"
        >
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 280 }} />
            <Skeleton style={{ height: 16, maxWidth: 420 }} />
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
          </div>
        </div>
      </section>
    );

  return (
    <section className={styles.page}>
      <PageHeader title="Commission Settings" description="Direct seller commission rate rules." />
      <Alert variant="warning" title="Rules apply to future sales only">
        Account rules override role rules, rules never stack, and no matching rule means 0%.
        Existing commissions keep the rate frozen when they were created.
      </Alert>

      {rules.isError ? (
        <ErrorState error={rules.error} onRetry={rules.refetch} />
      ) : (
        <>
          <ul className={styles.summary} aria-label="Commission rule summary">
            <li>
              <MetricCard
                label="Active rules"
                value={formatCountOrDash(summary.active)}
                icon="check"
                description="Rates resolving for new sales"
              />
            </li>
            <li>
              <MetricCard
                label="Disabled rules"
                value={formatCountOrDash(summary.disabled)}
                icon="close"
                description="Kept for history, resolving nothing"
              />
            </li>
            <li>
              <MetricCard
                label="Total rules"
                value={formatCountOrDash(summary.total)}
                icon="file-text"
                description="Every rate row on record"
              />
            </li>
          </ul>

          <section className={styles.panel} aria-label={editingId ? 'Edit rule' : 'Add rule'}>
            <h2 className={styles.panelTitle}>{editingId ? 'Edit rule' : 'Add rule'}</h2>
            <p className={styles.panelNote}>
              One direct-seller rate per rule. Saving edits the rate and dates only: the target
              never changes, and past commissions are never rewritten.
            </p>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                Target type
                <Select
                  aria-label="Target type"
                  value={form.targetType}
                  onChange={(event) =>
                    setForm({ ...form, targetType: event.target.value as 'role' | 'staff' | 'ost' })
                  }
                  disabled={editingId !== null}
                  options={[
                    { value: 'role', label: 'Role default' },
                    { value: 'staff', label: 'Staff account' },
                    { value: 'ost', label: 'OST account' },
                  ]}
                />
              </label>
              <TextField
                id="commission-target-id"
                name="targetId"
                label="Role/account ID"
                optional
                value={form.targetId}
                onChange={(value) => setForm({ ...form, targetId: value })}
                placeholder="UUID from Roles or Staff"
                disabled={editingId !== null}
              />
              <TextField
                id="commission-rate"
                name="rate"
                label="Rate (0.15 = 15%)"
                optional
                inputMode="decimal"
                value={form.rate}
                onChange={(value) => setForm({ ...form, rate: value })}
              />
              <DateField
                id="rule-effective-from"
                name="effectiveFrom"
                label="Effective from"
                optional
                value={form.effectiveFrom}
                onChange={(value) => setForm({ ...form, effectiveFrom: value })}
              />
              <DateField
                id="rule-effective-until"
                name="effectiveUntil"
                label="Effective until"
                optional
                value={form.effectiveUntil}
                onChange={(value) => setForm({ ...form, effectiveUntil: value })}
              />
              <DateField
                id="rule-accredited-after"
                name="accreditedOnOrAfter"
                label="Accredited on/after"
                optional
                value={form.accreditedOnOrAfter}
                onChange={(value) => setForm({ ...form, accreditedOnOrAfter: value })}
              />
              <div className={styles.formActions}>
                <Button disabled={!valid || create.isPending} onClick={() => create.mutate()}>
                  {editingId ? 'Save changes' : 'Add rule'}
                </Button>
                {editingId ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setForm(initialForm());
                      setEditingId(null);
                    }}
                  >
                    Cancel edit
                  </Button>
                ) : null}
              </div>
              {create.error ? (
                <p role="alert" className={styles.formAlert}>
                  {create.error.message}
                </p>
              ) : null}
            </div>
          </section>

          <FilterBar
            filtersToggleLabel="Expand Filters"
            search={
              <SearchField
                label="Search commission rules"
                placeholder="Target name, type, or ID"
                value={search}
                onChange={setSearch}
                busy={rules.isFetching}
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
            actions={
              <p className={styles.resultCount}>
                {search.trim() || statusFilter !== 'all'
                  ? `${formatCountOrDash(visible.length)} of ${formatCountOrDash(summary.total)} rules`
                  : `${formatCountOrDash(visible.length)} rules`}
              </p>
            }
          />

          {visible.length === 0 ? (
            <EmptyState
              title={
                search.trim() || statusFilter !== 'all'
                  ? 'No matching records.'
                  : 'No commission rules'
              }
              description="All direct sellers currently resolve to the 0% default."
            />
          ) : (
            <div
              role="region"
              aria-label="Scrollable records"
              tabIndex={0}
              className={`table-scroll ${styles.tableWrap} ${styles.queueCard}`}
            >
              <table className={styles.queueTable}>
                <thead>
                  <tr>
                    <th>Target</th>
                    <th>Rate</th>
                    <th>Effective</th>
                    <th>Accreditation</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((rule) => (
                    <tr key={rule.id}>
                      <td data-label="Target">
                        {rule.targetType}: {rule.targetName ?? rule.targetId}
                      </td>
                      <td data-label="Rate" className={styles.numeric}>
                        {formatRate(rule.rate)}
                      </td>
                      <td data-label="Effective">
                        {rule.effectiveFrom} to {rule.effectiveUntil ?? 'open'}
                      </td>
                      <td data-label="Accreditation">{rule.accreditedOnOrAfter ?? 'Any'}</td>
                      <td data-label="Status">
                        <StatusChip
                          label={rule.isActive ? 'Active' : 'Disabled'}
                          tone={rule.isActive ? 'success' : 'neutral'}
                        />
                      </td>
                      <td data-label="Actions">
                        <span className={styles.actionGroup}>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingId(rule.id);
                              setForm({
                                targetType: rule.targetType,
                                targetId: rule.targetId,
                                rate: rule.rate,
                                effectiveFrom: rule.effectiveFrom,
                                effectiveUntil: rule.effectiveUntil ?? '',
                                accreditedOnOrAfter: rule.accreditedOnOrAfter ?? '',
                              });
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={toggle.isPending}
                            onClick={() => toggle.mutate(rule)}
                          >
                            {rule.isActive ? 'Disable' : 'Activate'}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setHistoryId(rule.id)}
                          >
                            History
                          </Button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {toggle.isError ? (
            <p role="alert" className={styles.formAlert}>
              {toggle.error.message}
            </p>
          ) : null}
        </>
      )}
      <Dialog
        open={historyId !== null}
        onClose={() => setHistoryId(null)}
        title="Rule history"
        footer={
          <Button variant="secondary" onClick={() => setHistoryId(null)}>
            Close history
          </Button>
        }
      >
        {history.isPending ? (
          <p role="status">Loading history…</p>
        ) : history.isError ? (
          <ErrorState error={history.error} onRetry={history.refetch} />
        ) : history.data?.length ? (
          <div
            role="region"
            aria-label="Scrollable records"
            tabIndex={0}
            className={`table-scroll ${styles.tableWrap}`}
          >
            <table className={styles.queueTable}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Before</th>
                  <th>After</th>
                </tr>
              </thead>
              <tbody>
                {history.data.map((event) => (
                  <tr key={event.id}>
                    <td data-label="When">{event.createdAt}</td>
                    <td data-label="Action">{event.action}</td>
                    <td data-label="Actor">{event.actorId ?? 'System'}</td>
                    <td data-label="Before">
                      <code className={styles.code}>{JSON.stringify(event.before)}</code>
                    </td>
                    <td data-label="After">
                      <code className={styles.code}>{JSON.stringify(event.after)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No history" description="No audit events exist for this rule." />
        )}
      </Dialog>
    </section>
  );
}
