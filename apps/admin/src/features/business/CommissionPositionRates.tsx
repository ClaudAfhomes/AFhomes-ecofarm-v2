import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CommissionRosterPosition } from '@afhomes/contracts';
import { Button, EmptyState, TextField, notifyError, notifySuccess } from '@afhomes/ui';
import { formatCount } from '@afhomes/shared';

import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { percentToRate, rateToPercent } from './format';
import { sharedScopes } from './queryKeys';
import { createCommissionRule, updateCommissionRule } from './services';
import styles from './CommissionSettingsPage.module.css';

/** One default rate per position. Everyone in the position inherits it automatically. */
export function CommissionPositionRates({ positions }: { positions: CommissionRosterPosition[] }) {
  const client = useQueryClient();
  const save = useBusinessMutation({
    mutationFn: ({ target, rate }: { target: CommissionRosterPosition; rate: string }) =>
      target.defaultRuleId
        ? updateCommissionRule(target.defaultRuleId, { rate })
        : createCommissionRule({
            targetType: 'role',
            targetId: target.roleId,
            rate,
            effectiveFrom: new Date().toISOString().slice(0, 10),
          }),
    onSuccess: async (_rule, { target, rate }) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: sharedScopes.commissionRules }),
        client.invalidateQueries({ queryKey: sharedScopes.commissionRoster }),
      ]);
      notifySuccess({ title: 'Rate saved', message: `${target.name} is now ${rateToPercent(rate)}%.` });
    },
    onError: (error) => notifyError({ title: 'Rate not saved', message: error.message }),
  });

  if (positions.length === 0)
    return <EmptyState title="No positions yet" description="Selling positions appear here." />;

  return (
    <ul className={styles.positions} aria-label="Position rates">
      {positions.map((position) => (
        <PositionRow
          key={`${position.roleId}:${position.defaultRate ?? ''}`}
          position={position}
          pending={save.isPending && save.variables?.target.roleId === position.roleId}
          onSave={(target, rate) => save.mutate({ target, rate })}
        />
      ))}
    </ul>
  );
}

function PositionRow({
  position,
  pending,
  onSave,
}: {
  position: CommissionRosterPosition;
  pending: boolean;
  onSave: (position: CommissionRosterPosition, rate: string) => void;
}) {
  const [draft, setDraft] = useState(position.defaultRate ? rateToPercent(position.defaultRate) : '');
  const rate = percentToRate(draft);
  const changed = rate !== null && rate !== position.defaultRate;
  return (
    <li className={styles.positionRow}>
      <div className={styles.positionName}>
        <span className={styles.primary}>{position.name}</span>
        <span className={styles.secondary}>
          {formatCount(position.memberCount)} {position.memberCount === 1 ? 'seller' : 'sellers'}
          {position.defaultRate === null ? ' · No rate set' : ''}
        </span>
      </div>
      <TextField
        id={`position-rate-${position.slug}`}
        name={`rate-${position.slug}`}
        label={`${position.name} rate (%)`}
        inputMode="decimal"
        value={draft}
        onChange={setDraft}
        placeholder="0"
        disabled={pending}
        error={draft && rate === null ? 'Use 0 to 100.' : undefined}
      />
      <Button
        size="sm"
        variant="secondary"
        aria-label={`Save ${position.name} rate`}
        loading={pending}
        loadingLabel="Saving…"
        disabled={!changed}
        onClick={() => rate && onSave(position, rate)}
      >
        Save
      </Button>
    </li>
  );
}
