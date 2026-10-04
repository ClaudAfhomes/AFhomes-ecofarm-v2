import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Button, ErrorState, StatusChip } from '@jad/ui';

import { useCustomerSession } from '../../lib/customer-session';
import { getAuthPortals } from '../../lib/portals';
import { getOstMe } from './services';
import { Card, Field, FieldList, formatDate, styles } from '../customer/portal-ui';

/**
 * The approved OST member's own dashboard: their number, status, sponsor and
 * approval - nothing else. Data comes from `GET /ost/me`, which resolves the
 * member from the bearer token, so there is no member id to pass or to spoof.
 */
export function OstDashboardPage() {
  const { signOut } = useCustomerSession();
  const portals = useQuery({ queryKey: ['ost', 'portals'], queryFn: getAuthPortals });
  const me = useQuery({
    queryKey: ['ost', 'me'],
    queryFn: getOstMe,
    enabled: portals.data?.ost?.status === 'active',
    retry: false,
  });

  if (portals.isLoading || me.isLoading) return <p role="status">Loading your OST account…</p>;
  if (portals.isError || me.isError) {
    return (
      <ErrorState
        title="OST record unavailable"
        message="We could not load your OST record. If your application was just approved, sign out and sign in again."
      />
    );
  }

  const record = me.data!;
  return (
    <>
      <Card
        title="OST Dashboard"
        actions={
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
        }
      >
        <FieldList>
          <Field label="OST number" value={record.ostNumber} />
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
        <p className={styles.notice}>
          Applications you sponsor appear after applicants register with your referral code.{' '}
          <Link to="/ost/renewal">Accreditation history and renewal</Link>
        </p>
      </Card>
    </>
  );
}
