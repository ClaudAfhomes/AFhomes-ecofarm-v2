import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Dialog, Skeleton, TextField, notifySuccess } from '@afhomes/ui';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { getMemberships } from './services';
import { adjustPoints } from './points-services';
import { TierBadge } from './TierBadge';
import styles from './RecordPointsDialog.module.css';

type Props = {
  customer: { id: string; fullName: string; tier?: string | null };
  open: boolean;
  onClose: () => void;
};

const ANNUAL_CAP: Record<string, number> = { BRONZE: 10000, SILVER: 20000, GOLD: 25000 };
const LIFETIME_GIFT: Record<string, number> = { BRONZE: 50000, SILVER: 200000, GOLD: 500000 };

const formatPoints = (value: number) => value.toLocaleString('en-US');

export function RecordPointsDialog({ customer, open, onClose }: Props) {
  const client = useQueryClient();
  const [pointsInput, setPointsInput] = useState('');

  const memberships = useQuery({
    queryKey: ['record-points', 'memberships', customer.id],
    queryFn: async () => (await getMemberships()).filter((m) => m.customerId === customer.id),
    enabled: open,
  });
  const membership = memberships.data?.[0];

  const tier = (customer.tier ?? 'BRONZE').toUpperCase();
  const annualCap: number = ANNUAL_CAP[tier] ?? 10000;
  const lifetimeGift: number = LIFETIME_GIFT[tier] ?? 50000;
  const gained = Number(pointsInput.replace(/,/g, '')) || 0;
  const previous = membership?.pointsBalance ?? 0;
  const total = previous + gained;
  const weekday = Math.round(total * 0.7);
  const weekend = total - weekday;
  const overCap = gained > annualCap;

  const record = useBusinessMutation({
    mutationFn: () =>
      adjustPoints({
        membershipId: membership!.id,
        amount: gained,
        reason: 'Manual points record',
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['business', 'customer'] });
      notifySuccess({
        title: 'Points recorded',
        message: `${formatPoints(gained)} points added to ${customer.fullName}.`,
      });
      onClose();
    },
  });

  const canRecord = Boolean(membership?.id) && gained > 0 && !overCap;

  return (
    <Dialog open={open} onClose={onClose} title="Record Points">
      <div className={styles.dialogBody}>
        <div className={styles.identity}>
          <p className={styles.identityName}>{customer.fullName}</p>
          <TierBadge tier={customer.tier ?? 'BRONZE'} />
        </div>

        {memberships.isPending ? (
          <div className={styles.skeletonStack} role="status" aria-label="Loading membership">
            <Skeleton style={{ height: 20, width: '40%' }} />
            <Skeleton style={{ height: 56 }} />
            <Skeleton style={{ height: 120 }} />
            <Skeleton style={{ height: 14, width: '60%' }} />
          </div>
        ) : null}
        {!memberships.isPending && !membership ? (
          <Alert variant="danger">No active membership found for this customer.</Alert>
        ) : null}

        {!memberships.isPending ? (
          <>
            <div className={styles.inputCard}>
              <TextField
                id="record-points-input"
                name="points"
                label="Points to record"
                normalize={(v) => v.replace(/[^0-9]/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                value={pointsInput}
                onChange={setPointsInput}
                inputMode="numeric"
              />
              <p className={styles.inputHint}>Enter whole points. Commas are added automatically.</p>
            </div>

            <div className={styles.summaryCard} aria-live="polite">
              <div className={styles.summaryRow}>
                <span>Previous points</span>
                <strong>{formatPoints(previous)}</strong>
              </div>
              <div className={styles.summaryRow}>
                <span>Points added</span>
                <strong>{formatPoints(gained)}</strong>
              </div>
              <hr className={styles.summaryRule} />
              <div className={styles.summaryTotal}>
                <span>Total points</span>
                <strong>{formatPoints(total)}</strong>
              </div>
              <div className={styles.summarySplit}>
                <div className={styles.splitCell}>
                  <span className={styles.splitLabel}>Weekday (70%)</span>
                  <span className={styles.splitValue}>{formatPoints(weekday)}</span>
                </div>
                <div className={styles.splitCell}>
                  <span className={styles.splitLabel}>Weekend (30%)</span>
                  <span className={styles.splitValue}>{formatPoints(weekend)}</span>
                </div>
              </div>
            </div>

            <div className={styles.limits}>
              <span>
                Annual cap ({tier}): <strong>{formatPoints(annualCap)}</strong>
              </span>
              <span>
                Lifetime gift: <strong>{formatPoints(lifetimeGift)}</strong>
              </span>
            </div>

            <div className={styles.alerts}>
              {overCap ? <Alert variant="danger">Input exceeds the annual cap.</Alert> : null}
              {record.error ? <Alert variant="danger">{record.error.message}</Alert> : null}
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => record.mutate()} loading={record.isPending} disabled={!canRecord}>
                Record
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}