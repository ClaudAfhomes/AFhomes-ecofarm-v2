import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { saleTeamLookupSchema, type SaleTeamAccreditation } from '@afhomes/contracts';
import {
  Alert,
  AccreditationId,
  Button,
  ConfirmDialog,
  DetailCard,
  DetailCardTitle,
  DetailField,
  DetailFieldGrid,
  ErrorState,
  Skeleton,
  StatusChip,
} from '@afhomes/ui';
import { protectedRequest } from '../../lib/api/client';
import { useSession } from '../../lib/session';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import styles from './SaleTeamAccreditationCard.module.css';

/** Chip tone per accreditation status; anything unrecognized reads neutral. */
const ACCREDITATION_STATUS_TONES: Record<
  SaleTeamAccreditation['status'],
  'success' | 'neutral' | 'danger'
> = {
  accredited: 'success',
  expired: 'neutral',
  revoked: 'danger',
  inactive: 'neutral',
  not_started: 'neutral',
};

export function SaleTeamAccreditationCard({
  staffId,
  kind,
  showValidityDates = false,
}: {
  staffId?: string;
  kind: 'IST' | 'OST';
  showValidityDates?: boolean;
}) {
  const { user } = useSession();
  const [action, setAction] = useState<'approve' | 'revoke' | null>(null);
  const management = Boolean(
    staffId &&
    ['admin', 'super_admin'].includes(user?.roleSlug ?? '') &&
    user?.afHomesPermissions.some(
      (p) =>
        p.moduleKey === (kind === 'IST' ? 'organization.staff' : 'network.ost_registrations') &&
        p.canUpdate,
    ),
  );
  const endpoint = staffId ? `/sale-team/${staffId}` : '/sale-team/me';
  const record = useQuery({
    queryKey: ['sale-team', staffId ?? 'me', kind],
    queryFn: () =>
      protectedRequest(staffId ? `${endpoint}?kind=${kind}` : endpoint, saleTeamLookupSchema),
    retry: false,
  });
  const save = useBusinessMutation({
    mutationFn: (approvedAction: 'approve' | 'revoke') =>
      protectedRequest(endpoint, saleTeamLookupSchema, {
        method: 'POST',
        body: JSON.stringify({
          action: approvedAction,
          kind,
        }),
      }),
    onSuccess: async () => {
      setAction(null);
      await record.refetch();
    },
  });
  const value: SaleTeamAccreditation | null | undefined = record.data;
  const statusLabel =
    value?.kind === 'IST' && value.status === 'accredited'
      ? 'Active employee'
      : value
        ? value.status.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase())
        : 'Not issued';
  const statusTone = value ? ACCREDITATION_STATUS_TONES[value.status] : 'warning';
  return (
    <DetailCard>
      <div className={styles.header}>
        <DetailCardTitle>
          {kind === 'IST' ? 'Employee identity' : 'Sales accreditation'}
        </DetailCardTitle>
        {record.isPending || record.isError ? null : (
          <StatusChip label={statusLabel} tone={statusTone} />
        )}
      </div>
      {record.isPending ? (
        <Skeleton style={{ height: 80 }} />
      ) : record.isError ? (
        <ErrorState error={record.error} onRetry={() => void record.refetch()} />
      ) : (
        <DetailFieldGrid>
          <DetailField label="AA number">
            <AccreditationId value={value?.aaNumber ?? null} />
          </DetailField>
          {value ? (
            <DetailField label={kind === 'IST' ? 'Employee name' : 'Accredited name'}>
              {value.fullName}
            </DetailField>
          ) : null}
          {value && (kind === 'OST' || showValidityDates) ? (
            <>
              <DetailField label="Valid from">{value.startsOn ?? 'Not defined'}</DetailField>
              <DetailField label="Valid until">{value.expiresOn ?? 'Not defined'}</DetailField>
            </>
          ) : null}
        </DetailFieldGrid>
      )}
      {management && !record.isError && !record.isPending ? (
        <div className={styles.actionArea}>
          {kind === 'OST' ? (
            <p className={styles.note}>Uses approved OST validity dates.</p>
          ) : (
            <p className={styles.note}>
              IST employees have no accreditation dates or annual renewal.
            </p>
          )}
          <div className={styles.actionButtons}>
            <Button onClick={() => setAction('approve')} disabled={kind === 'IST' && !!value}>
              {kind === 'IST'
                ? 'Issue employee AAI number'
                : value
                  ? 'Approve accreditation'
                  : 'Approve and issue AA number'}
            </Button>
            {kind === 'OST' && value && value.status !== 'revoked' ? (
              <Button variant="danger" onClick={() => setAction('revoke')}>
                Revoke accreditation
              </Button>
            ) : null}
          </div>
          {save.isError ? <Alert variant="danger">{save.error.message}</Alert> : null}
          <ConfirmDialog
            open={action !== null}
            title={
              kind === 'IST'
                ? 'Issue employee identity?'
                : action === 'revoke'
                  ? 'Revoke accreditation?'
                  : 'Approve accreditation?'
            }
            message={
              kind === 'IST'
                ? 'Issues the permanent AAI identifier without an accreditation term.'
                : action === 'revoke'
                  ? 'Public verification will stop immediately.'
                  : 'Confirms eligibility for AA verification.'
            }
            confirmLoading={save.isPending}
            danger={action === 'revoke'}
            confirmLabel={action === 'revoke' ? 'Revoke' : 'Approve'}
            onCancel={() => setAction(null)}
            onConfirm={() => {
              if (action) save.mutate(action);
            }}
          />
        </div>
      ) : null}
    </DetailCard>
  );
}
