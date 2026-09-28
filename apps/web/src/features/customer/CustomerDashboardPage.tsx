import { Link } from 'react-router';
import { ErrorState, StatusChip, type StatusTone } from '@jad/ui';

import { useCustomerLedgerQuery, useCustomerMembershipQuery, useCustomerProfileQuery, useCustomerPointsQuery } from './queries';
import { isForbidden, isNotFound } from './http';
import { Card, Field, FieldList, formatDate, humanEntryType, styles } from './portal-ui';

/**
 * Customer dashboard: the member's own position in one screen.
 *
 * Deliberately read-only and deliberately narrow - name, card, status,
 * activation and renewal dates, points balance, and recent points activity.
 * No staff-only field, no finance data, and no card code (the membership screen
 * explains why a code is never simply displayed).
 *
 * React Query dedupes by key, so the profile fetch here is the same request the
 * shell already made.
 */
export function CustomerDashboardPage() {
  const profile = useCustomerProfileQuery();
  const membership = useCustomerMembershipQuery();
  const points = useCustomerPointsQuery();
  const ledger = useCustomerLedgerQuery();

  if (profile.isLoading) return <p role="status">Loading your account…</p>;

  return (
    <>
      <Card title="Welcome">
        <p className={styles.notice}>
          Signed in as <strong>{profile.data?.fullName}</strong> ({profile.data?.customerNumber}).
        </p>
        <p className={styles.notice}>
          This portal shows your own account only. For anything else, contact AF Homes Ecofarm.
        </p>
      </Card>

      <Card title="Your card">
        {membership.isLoading && <p role="status">Loading your card…</p>}
        {membership.isError && (
          <ErrorState
            title="Card unavailable"
            message={
              isForbidden(membership.error)
                ? 'Your account is not active, so your card is not available. Contact AF Homes Ecofarm to restore access.'
                : isNotFound(membership.error)
                  ? 'You do not have an active membership yet.'
                  : 'We could not load your card. Please try again in a moment.'
            }
          />
        )}
        {membership.data && (
          <FieldList>
            <Field label="Membership number" value={membership.data.membershipNumber} />
            <Field label="Product" value={membership.data.productName ?? 'AF Homes card'} />
            <Field
              label="Status"
              value={
                <StatusChip label={membership.data.status} tone={toneFor(membership.data.status)} />
              }
            />
            <Field label="Activated" value={formatDate(membership.data.activatedAt)} />
            <Field label="Renews" value={formatDate(membership.data.renewalDueAt)} />
            <Field label="Annual points" value={membership.data.yearlyPointsAllocated.toLocaleString('en-PH')} />
          </FieldList>
        )}
        {membership.data && (
          <p className={styles.notice}>
            <Link to="/customer/membership">Manage your card code</Link>
            {' · '}
            <Link to="/customer/redemptions">Redemption history</Link>
            {' · '}
            <Link to="/customer/payments">Payment history</Link>
            {' · '}
            <Link to="/customer/profile">Your profile</Link>
          </p>
        )}
      </Card>

      <Card title="Your points">
        {points.isLoading && <p role="status">Loading your points…</p>}
        {points.isError && (
          <p className={styles.notice}>
            Points are not available right now.{' '}
            {isForbidden(points.error) ? 'Your account is not active.' : ''}
          </p>
        )}
        {points.data && (
          <>
            <p className={styles.balance}>{points.data.balance.toLocaleString('en-PH')}</p>
            <p className={styles.balanceCaption}>
              points available · {points.data.lifetimeAllocated.toLocaleString('en-PH')} allocated
              all time
            </p>
          </>
        )}
      </Card>

      <Card title="Recent points activity">
        {ledger.isLoading && <p role="status">Loading your points activity…</p>}
        {ledger.isError && <p className={styles.notice}>Your points activity is not available right now.</p>}
        {ledger.data && ledger.data.length === 0 && (
          <p className={styles.notice}>No points activity yet.</p>
        )}
        {ledger.data && ledger.data.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Type</th>
                <th scope="col">Description</th>
                <th scope="col" className={styles.numeric}>
                  Points
                </th>
                <th scope="col" className={styles.numeric}>
                  Balance
                </th>
              </tr>
            </thead>
            <tbody>
              {ledger.data.slice(0, 5).map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDate(entry.occurredAt)}</td>
                  <td>{humanEntryType(entry.entryType)}</td>
                  <td>{entry.reason ?? '—'}</td>
                  <td
                    className={`${styles.numeric} ${entry.amount >= 0 ? styles.positive : styles.negative}`}
                  >
                    {entry.amount >= 0 ? '+' : ''}
                    {entry.amount.toLocaleString('en-PH')}
                  </td>
                  <td className={styles.numeric}>{entry.balanceAfter.toLocaleString('en-PH')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {ledger.data && ledger.data.length > 0 && (
          <p className={styles.notice}>
            <Link to="/customer/points">See all points activity</Link>
          </p>
        )}
      </Card>
    </>
  );
}

const toneFor = (status: string): StatusTone =>
  status === 'active' ? 'success' : status === 'suspended' ? 'warning' : 'neutral';
