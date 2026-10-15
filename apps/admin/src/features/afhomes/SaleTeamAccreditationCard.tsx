import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { saleTeamLookupSchema, type SaleTeamAccreditation } from '@afhomes/contracts';
import {
  Alert,
  AccreditationId,
  Button,
  ConfirmDialog,
  DateField,
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

export function SaleTeamAccreditationCard({
  staffId,
  kind,
}: {
  staffId?: string;
  kind: 'IST' | 'OST';
}) {
  const { user } = useSession();
  const [startsOn, setStartsOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
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
          ...(kind === 'IST' && approvedAction === 'approve' ? { startsOn, expiresOn } : {}),
        }),
      }),
    onSuccess: async () => {
      setAction(null);
      await record.refetch();
    },
  });
  const value: SaleTeamAccreditation | null | undefined = record.data;
  return (
    <DetailCard>
      <DetailCardTitle>Sales accreditation</DetailCardTitle>
      {record.isPending ? (
        <Skeleton style={{ height: 80 }} />
      ) : record.isError ? (
        <ErrorState error={record.error} onRetry={() => void record.refetch()} />
      ) : (
        <DetailFieldGrid>
          <DetailField label="AA number">
            <AccreditationId value={value?.aaNumber ?? null} />
          </DetailField>
          {value ? <DetailField label="Accredited name">{value.fullName}</DetailField> : null}
          <DetailField label="Accreditation">
            <StatusChip
              label={value?.status.replaceAll('_', ' ') ?? 'Not issued'}
              tone={value?.status === 'accredited' ? 'success' : 'warning'}
            />
          </DetailField>
          {value ? (
            <>
              <DetailField label="Valid from">{value.startsOn}</DetailField>
              <DetailField label="Valid until">{value.expiresOn}</DetailField>
            </>
          ) : null}
        </DetailFieldGrid>
      )}
      {management && !record.isError && !record.isPending ? (
        <>
          {kind === 'IST' ? (
            <DetailFieldGrid>
              <DateField
                id={`aa-start-${staffId}`}
                name="startsOn"
                label="Approved start"
                value={startsOn}
                onChange={setStartsOn}
              />
              <DateField
                id={`aa-end-${staffId}`}
                name="expiresOn"
                label="Approved expiry"
                value={expiresOn}
                onChange={setExpiresOn}
              />
            </DetailFieldGrid>
          ) : (
            <p>Uses the approved OST validity dates.</p>
          )}
          <Button
            onClick={() => setAction('approve')}
            disabled={kind === 'IST' && (!startsOn || !expiresOn || expiresOn < startsOn)}
          >
            {value ? 'Approve accreditation' : 'Approve and issue AA number'}
          </Button>
          {value && value.status !== 'revoked' ? (
            <Button variant="danger" onClick={() => setAction('revoke')}>
              Revoke accreditation
            </Button>
          ) : null}
          {save.isError ? <Alert variant="danger">{save.error.message}</Alert> : null}
          <ConfirmDialog
            open={action !== null}
            title={action === 'revoke' ? 'Revoke accreditation?' : 'Approve accreditation?'}
            message={
              action === 'revoke'
                ? 'Public verification will stop immediately.'
                : 'Confirms eligibility for public AA verification.'
            }
            confirmLoading={save.isPending}
            danger={action === 'revoke'}
            confirmLabel={action === 'revoke' ? 'Revoke' : 'Approve'}
            onCancel={() => setAction(null)}
            onConfirm={() => {
              if (action) save.mutate(action);
            }}
          />
        </>
      ) : null}
    </DetailCard>
  );
}
