import { useQuery } from '@tanstack/react-query';
import { AccreditationId, Button, StatusChip } from '@afhomes/ui';

import { useCustomerSession } from '../../lib/customer-session';
import { getAuthPortals } from '../../lib/portals';
import { request } from '../../lib/api/client';
import { saleTeamLookupSchema, ostMeSchema } from '@afhomes/contracts';
import { formatDate, Card, Field, FieldList, styles as portalStyles } from '../customer/portal-ui';
import styles from './OstAccreditationPage.module.css';

/**
 * OST accreditation page - displays the OST member's accreditation details.
 */
export function OstAccreditationPage() {
  const { signOut } = useCustomerSession();
  const portals = useQuery({ queryKey: ['ost', 'portals'], queryFn: getAuthPortals });
  const accreditation = useQuery({
    queryKey: ['ost', 'accreditation'],
    queryFn: () => request('/sale-team/me', saleTeamLookupSchema),
    enabled: portals.data?.ost?.status === 'active',
    retry: false,
  });
  const me = useQuery({
    queryKey: ['ost', 'me'],
    queryFn: () => request('/ost/me', ostMeSchema),
    enabled: portals.data?.ost?.status === 'active',
    retry: false,
  });

  if (portals.isLoading || me.isLoading || accreditation.isLoading) return <p role="status" className={styles.loading}>Loading your accreditation…</p>;
  if (portals.isError || me.isError || accreditation.isError) {
    return (
      <div className={styles.centered}>
        <h2>Unable to load accreditation</h2>
        <p>Please try again in a moment.</p>
        <Button variant="secondary" onClick={() => void signOut()}>Sign out</Button>
      </div>
    );
  }

  const record = me.data!;
  const acc = accreditation.data;
  const refetchAccreditation = accreditation.refetch;

  return (
    <>
      <Card title="OST Account">
        <FieldList>
          <Field label="OST Number" value={record.ostNumber} />
          <Field
            label="AA Number"
            value={
              accreditation.isPending ? (
                'Loading accreditation'
              ) : accreditation.isError ? (
                'Accreditation unavailable'
              ) : (
                <AccreditationId value={acc?.aaNumber ?? null} />
              )
            }
          />
          {acc ? (
            <>
              <Field label="Accreditation" value={acc.status.replaceAll('_', ' ')} />
              <Field label="Valid From" value={formatDate(acc.startsOn)} />
              <Field label="Valid Until" value={formatDate(acc.expiresOn)} />
            </>
          ) : null}
          <Field label="Name" value={record.fullName} />
          <Field
            label="Status"
            value={
              <StatusChip
                label={record.status}
                tone={record.status === 'active' ? 'success' : 'warning'}
              />
            }
          />
          <Field label="Sponsor" value={record.sponsorName} />
          <Field label="Approved" value={formatDate(record.approvedAt)} />
        </FieldList>
        {accreditation.isError ? (
          <Button variant="secondary" onClick={() => void refetchAccreditation()}>
            Retry accreditation
          </Button>
        ) : null}
      </Card>

      {acc && (
        <Card title="Accreditation Details">
          <FieldList>
            <Field label="AA Number" value={<AccreditationId value={acc.aaNumber} />} />
            <Field label="Kind" value={acc.kind} />
            <Field label="Status" value={<StatusChip label={acc.status.replaceAll('_', ' ')} tone={acc.status === 'accredited' ? 'success' : 'warning'} />} />
            <Field label="Valid From" value={formatDate(acc.startsOn)} />
            <Field label="Valid Until" value={formatDate(acc.expiresOn)} />
            <Field label="Accredited Name" value={acc.fullName} />
          </FieldList>
        </Card>
      )}

      <p className={portalStyles.notice}>
        Applications you sponsor appear after applicants register with your referral code.{' '}
        <a href="/ost/renewal">Accreditation history and renewal</a>
      </p>
    </>
  );
}