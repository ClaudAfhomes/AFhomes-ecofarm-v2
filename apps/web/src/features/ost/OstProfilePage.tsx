import { useQuery } from '@tanstack/react-query';
import { Button, StatusChip, ErrorState } from '@afhomes/ui';

import { useCustomerSession } from '../../lib/customer-session';
import { getAuthPortals } from '../../lib/portals';
import { request } from '../../lib/api/client';
import { ostMeSchema } from '@afhomes/contracts';
import { formatDate, Card, Field, FieldList } from '../customer/portal-ui';
import { ProfilePhotoCard } from '../customer/ProfilePhotoCard';
import styles from './OstProfilePage.module.css';

/**
 * OST profile page - displays the OST member's profile details and photo.
 */
export function OstProfilePage() {
  const { signOut } = useCustomerSession();
  const portals = useQuery({ queryKey: ['ost', 'portals'], queryFn: getAuthPortals });
  const me = useQuery({
    queryKey: ['ost', 'me'],
    queryFn: () => request('/ost/me', ostMeSchema),
    enabled: portals.data?.ost?.status === 'active',
    retry: false,
  });

  if (portals.isLoading || me.isLoading) return <p role="status" className={styles.loading}>Loading your profile…</p>;
  if (portals.isError || me.isError) {
    return (
      <ErrorState
        title="Profile unavailable"
        message="We could not load your profile. Please try again in a moment."
      />
    );
  }

  const record = me.data!;

  return (
    <>
      <Card title="Profile Photo">
        <ProfilePhotoCard scope="staff" />
      </Card>

      <Card title="Account Information">
        <FieldList>
          <Field label="OST Number" value={record.ostNumber} />
          <Field label="Full Name" value={record.fullName} />
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
      </Card>

      <Card title="Account Details">
        <FieldList>
          <Field label="OST Number" value={record.ostNumber} />
          <Field label="Full Name" value={record.fullName} />
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
      </Card>

      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </>
  );
}