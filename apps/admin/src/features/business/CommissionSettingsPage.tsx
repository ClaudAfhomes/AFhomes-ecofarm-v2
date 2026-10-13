import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import type { CommissionRule } from '@afhomes/contracts';
import { Button, DateField, EmptyState, ErrorState, PageHeader, Select, StatusChip, TextField } from '@afhomes/ui';

import { formatRate } from './format';
import {
  createCommissionRule,
  getCommissionRuleHistory,
  getCommissionRules,
  updateCommissionRule,
} from './services';
import { sharedScopes } from './queryKeys';
import { useSession } from '../../lib/session';

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
  const rules = useQuery({
    queryKey: sharedScopes.commissionRules,
    queryFn: getCommissionRules,
    enabled: mayManage,
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

  if (!mayManage)
    return (
      <section>
        <PageHeader
          title="Commission Settings"
          description="Commission-rule management is restricted to authorized Admin and Super Admin accounts."
        />
        <p role="alert">You do not have permission to manage commission rules.</p>
      </section>
    );

  return (
    <section>
      <PageHeader
        title="Commission Settings"
        description="Configure one direct-seller rate. Account rules override role rules; rules never stack and no matching rule means 0%."
      />
      <div style={{ display: 'grid', gap: 10, maxWidth: 720, marginBottom: 24 }}>
        <label>
          Target type
          <Select
            value={form.targetType}
            onChange={(event) =>
              setForm({ ...form, targetType: event.target.value as 'role' | 'staff' | 'ost' })
            }
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
        <Button disabled={!valid || create.isPending} onClick={() => create.mutate()}>
          {editingId ? 'Save changes' : 'Add rule'}
        </Button>
        {create.error ? <p role="alert">{create.error.message}</p> : null}
      </div>
      {rules.isPending ? (
        <p role="status">Loading commission rules…</p>
      ) : rules.isError ? (
        <ErrorState error={rules.error} onRetry={rules.refetch} />
      ) : !rules.data?.length ? (
        <EmptyState
          title="No commission rules"
          description="All direct sellers currently resolve to the 0% default."
        />
      ) : (
        <div role="region" aria-label="Scrollable records" tabIndex={0} className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Target</th>
                <th>Rate</th>
                <th>Effective</th>
                <th>Accreditation</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rules.data.map((rule) => (
                <tr key={rule.id}>
                  <td>
                    {rule.targetType}: {rule.targetName ?? rule.targetId}
                  </td>
                  <td>{formatRate(rule.rate)}</td>
                  <td>
                    {rule.effectiveFrom} — {rule.effectiveUntil ?? 'open'}
                  </td>
                  <td>{rule.accreditedOnOrAfter ?? 'Any'}</td>
                  <td>
                    <StatusChip
                      label={rule.isActive ? 'Active' : 'Disabled'}
                      tone={rule.isActive ? 'success' : 'neutral'}
                    />
                  </td>
                  <td>
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
                    </Button>{' '}
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={toggle.isPending}
                      onClick={() => toggle.mutate(rule)}
                    >
                      {rule.isActive ? 'Disable' : 'Activate'}
                    </Button>{' '}
                    <Button size="sm" variant="secondary" onClick={() => setHistoryId(rule.id)}>
                      History
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {historyId ? (
        <section>
          <h2>Rule history</h2>
          <Button variant="secondary" onClick={() => setHistoryId(null)}>
            Close history
          </Button>
          {history.isPending ? (
            <p role="status">Loading history…</p>
          ) : history.isError ? (
            <ErrorState error={history.error} onRetry={history.refetch} />
          ) : history.data?.length ? (
            <table>
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
                    <td>{event.createdAt}</td>
                    <td>{event.action}</td>
                    <td>{event.actorId ?? 'System'}</td>
                    <td>
                      <code>{JSON.stringify(event.before)}</code>
                    </td>
                    <td>
                      <code>{JSON.stringify(event.after)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState title="No history" description="No audit events exist for this rule." />
          )}
        </section>
      ) : null}
    </section>
  );
}
