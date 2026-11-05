import { useMemo, useRef, useState } from 'react';
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
  PageHeader,
  SearchField,
  Select,
  Skeleton,
  StatusChip,
  TextField,
} from '@afhomes/ui';

import { formatRate } from './format';
import { formatCount, formatCountOrDash } from '@afhomes/shared';
import {
  createCommissionRule,
  getCommissionRuleHistory,
  getCommissionRules,
  updateCommissionRule,
  type CommissionRuleHistory,
} from './services';
import { sharedScopes } from './queryKeys';
import { formatDateTime } from '../../lib/format';
import { useSession } from '../../lib/session';
import styles from './CommissionSettingsPage.module.css';

const TARGET_LABEL: Record<CommissionRule['targetType'], string> = {
  role: 'Role default',
  staff: 'Staff account',
  ost: 'OST account',
};

const show = (value: unknown) =>
  value === null || value === undefined || value === ''
    ? '—'
    : typeof value === 'string'
      ? value
      : JSON.stringify(value);

/** Fields an audit event changed, so history reads as a diff instead of raw JSON. */
function ruleChanges(event: Pick<CommissionRuleHistory, 'before' | 'after'>) {
  const before = event.before ?? {};
  const after = event.after ?? {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => ({
      field: key,
      before: event.before && key in before ? show(before[key]) : null,
      after: event.after && key in after ? show(after[key]) : null,
    }));
}

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
  const idValid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(form.targetId);
  const rateValid =
    /^\d+(\.\d{1,4})?$/.test(form.rate) && Number(form.rate) >= 0 && Number(form.rate) <= 1;
  const valid = idValid && rateValid;
  const formRef = useRef<HTMLElement>(null);
  const startEdit = (rule: CommissionRule) => {
    setEditingId(rule.id);
    setForm({
      targetType: rule.targetType,
      targetId: rule.targetId,
      rate: rule.rate,
      effectiveFrom: rule.effectiveFrom,
      effectiveUntil: rule.effectiveUntil ?? '',
      accreditedOnOrAfter: rule.accreditedOnOrAfter ?? '',
    });
    // The editor sits above a possibly long list: bring it into view.
    formRef.current?.scrollIntoView?.({ block: 'start' });
    document.getElementById('commission-rate')?.focus({ preventScroll: true });
  };
  const cancelEdit = () => {
    setForm(initialForm());
    setEditingId(null);
  };
  const history = useQuery({
    queryKey: sharedScopes.commissionRuleHistory(historyId),
    queryFn: () => getCommissionRuleHistory(historyId!),
    enabled: Boolean(historyId),
  });

  const allRules = useMemo(() => rules.data ?? [], [rules.data]);
  const editingRule = allRules.find((rule) => rule.id === editingId) ?? null;
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
        <div className={styles.skeleton} role="status" aria-label="Loading commission rules">
          <div className={styles.skeletonHead}>
            <Skeleton style={{ height: 32, maxWidth: 280 }} />
            <Skeleton style={{ height: 16, maxWidth: 360 }} />
          </div>
          <ul className={styles.badges} aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <li key={index}>
                <Skeleton style={{ height: 24, width: '10rem', borderRadius: '999px' }} />
              </li>
            ))}
          </ul>
          <Skeleton style={{ height: 220 }} />
          <div className={styles.skeletonRows}>
            <Skeleton style={{ height: 64 }} />
            <Skeleton style={{ height: 64 }} />
            <Skeleton style={{ height: 64 }} />
          </div>
        </div>
      </section>
    );

  const filtered = Boolean(search.trim()) || statusFilter !== 'all';

  return (
    <section className={styles.page}>
      <PageHeader title="Commission Settings" description="Direct seller commission rate rules." />
      <Alert variant="warning" title="Rules apply to future sales only">
        <ul className={styles.ruleFacts}>
          <li>Account rules override role rules.</li>
          <li>Rules never stack.</li>
          <li>No matching rule means 0%.</li>
          <li>Existing commissions keep their frozen rate.</li>
        </ul>
      </Alert>

      {rules.isError ? (
        <ErrorState error={rules.error} onRetry={rules.refetch} />
      ) : (
        <>
          <ul className={styles.badges} aria-label="Commission rule summary">
            <li>
              <StatusChip
                label={`Active rules: ${formatCountOrDash(summary.active)}`}
                tone="success"
                icon="check"
              />
            </li>
            <li>
              <StatusChip
                label={`Disabled rules: ${formatCountOrDash(summary.disabled)}`}
                tone="neutral"
                icon="close"
              />
            </li>
            <li>
              <StatusChip
                label={`Total rules: ${formatCountOrDash(summary.total)}`}
                tone="neutral"
                icon="file-text"
              />
            </li>
          </ul>

          <section
            ref={formRef}
            className={styles.panel}
            data-editing={editingId ? true : undefined}
            aria-label={editingId ? 'Edit rule' : 'Add rule'}
          >
            <header className={styles.panelHead}>
              <div>
                <h2 className={styles.panelTitle}>{editingId ? 'Edit rule' : 'Add rule'}</h2>
                <p className={styles.panelNote}>
                  {editingId
                    ? 'Only rate and dates can change. Past commissions stay the same.'
                    : 'One direct-seller rate per rule.'}
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

            <fieldset className={styles.group}>
              <legend className={styles.groupTitle}>Who it applies to</legend>
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
                    options={(Object.keys(TARGET_LABEL) as CommissionRule['targetType'][]).map(
                      (value) => ({ value, label: TARGET_LABEL[value] }),
                    )}
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
                  error={form.targetId && !idValid ? 'Enter the full ID.' : undefined}
                  disabled={editingId !== null}
                />
              </div>
            </fieldset>

            <fieldset className={styles.group}>
              <legend className={styles.groupTitle}>Rate and dates</legend>
              <div className={styles.formGrid}>
                <TextField
                  id="commission-rate"
                  name="rate"
                  label="Rate (0.15 = 15%)"
                  optional
                  inputMode="decimal"
                  value={form.rate}
                  onChange={(value) => setForm({ ...form, rate: value })}
                  error={
                    form.rate && !rateValid ? 'Use 0 to 1, up to 4 decimals.' : undefined
                  }
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
              </div>
            </fieldset>

            {create.error ? (
              <p role="alert" className={styles.formAlert}>
                {create.error.message}
              </p>
            ) : null}
            <div className={styles.formActions}>
              {editingId ? (
                <Button variant="secondary" onClick={cancelEdit}>
                  Cancel edit
                </Button>
              ) : null}
              <Button disabled={!valid || create.isPending} onClick={() => create.mutate()}>
                {editingId ? 'Save changes' : 'Add rule'}
              </Button>
            </div>
          </section>

          <section className={styles.listBlock} aria-label="Commission rules">
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
            />

            <h2 className={styles.resultsTitle}>
              {formatCount(visible.length)} {visible.length === 1 ? 'rule' : 'rules'}
              {filtered ? ` of ${formatCount(allRules.length)}` : ''}
            </h2>

            {visible.length === 0 ? (
              <EmptyState
                title={filtered ? 'No matching records.' : 'No commission rules'}
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
                    {visible.map((rule) => (
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
                            <Button size="sm" variant="ghost" onClick={() => startEdit(rule)}>
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
          </section>
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
          <ol className={styles.timeline} aria-label="Rule changes">
            {history.data.map((event) => {
              const changes = ruleChanges(event);
              return (
                <li key={event.id} className={styles.event}>
                  <div className={styles.eventHead}>
                    <span className={styles.eventAction}>{event.action}</span>
                    <time className={styles.secondary} dateTime={event.createdAt}>
                      {formatDateTime(event.createdAt)}
                    </time>
                  </div>
                  <p className={styles.secondary}>
                    By <code className={styles.code}>{event.actorId ?? 'System'}</code>
                  </p>
                  {event.reason ? <p className={styles.eventReason}>{event.reason}</p> : null}
                  {changes.length ? (
                    <dl className={styles.changes}>
                      {changes.map((change) => (
                        <div key={change.field}>
                          <dt>{change.field}</dt>
                          <dd>
                            {change.before !== null ? (
                              <span className={styles.before}>
                                <span className="sr-only">Before: </span>
                                {change.before}
                              </span>
                            ) : null}
                            {change.after !== null ? (
                              <span className={styles.after}>
                                <span className="sr-only">After: </span>
                                {change.after}
                              </span>
                            ) : null}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className={styles.secondary}>No field changes.</p>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          <EmptyState title="No history" description="No audit events exist for this rule." />
        )}
      </Dialog>
    </section>
  );
}
