import { Link } from 'react-router';
import { paymentSchemeLabel } from '@afhomes/contracts';
import {
  EmptyState,
  ErrorState,
  MetricCard,
  PageHeader,
  Skeleton,
  StatusChip,
  type StatusTone,
} from '@afhomes/ui';

import { useCustomerLedgerQuery, useCustomerMembershipQuery, useCustomerProfileQuery, useCustomerPointsQuery } from './queries';
import { isForbidden, isNotFound } from './http';
import { Card, Field, FieldList, formatDate, humanEntryType, styles } from './portal-ui';

/**
 * Customer dashboard: the member's own position in one screen.
 *
 * AF Homes member-dashboard structure (page header, KPI grid, membership panel,
 * recent activity) with AF Homes content: deliberately read-only and
 * deliberately narrow - name, card, status, activation and renewal dates,
 * points balance, and recent points activity. No staff-only field and no
 * finance data; the scannable card itself lives on the membership screen.
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

  const kpiLoading = membership.isLoading || points.isLoading;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={
          profile.data
            ? `Welcome back, ${profile.data.fullName}.`
            : 'Your membership, points, and recent activity.'
        }
      />

      {kpiLoading ? (
        <div role="status" aria-label="Loading summary">
          <ul className={styles.kpiGrid} aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <li key={index}>
                <Skeleton className={styles.kpiSkeleton} />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ul className={styles.kpiGrid}>
          <li>
            <MetricCard
              label="Membership"
              value={membership.data?.productName ?? 'No active card'}
              icon="user-check"
              description={
                membership.data
                  ? `${paymentSchemeLabel(membership.data.paymentScheme)}`
                  : 'You do not have an active membership yet.'
              }
              chip={
                membership.data
                  ? {
                      label: membership.data.status,
                      tone: toneFor(membership.data.status),
                    }
                  : undefined
              }
              to="/customer/membership"
            />
          </li>
          <li>
            <MetricCard
              label="Points balance"
              value={(points.data?.balance ?? 0).toLocaleString('en-PH')}
              icon="wallet"
              description={
                points.data
                  ? `${points.data.lifetimeAllocated.toLocaleString('en-PH')} allocated all time`
                  : 'Points are not available right now.'
              }
              to="/customer/points"
            />
          </li>
          <li>
            <MetricCard
              label="Valid until"
              value={formatDate(membership.data?.renewalDueAt)}
              icon="clock"
              description={
                membership.data?.validityYears
                  ? `Valid for ${membership.data.validityYears} year${membership.data.validityYears === 1 ? '' : 's'}`
                  : 'Membership validity.'
              }
              to="/customer/membership"
            />
          </li>
        </ul>
      )}

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
            <Field label="Payment scheme" value={paymentSchemeLabel(membership.data.paymentScheme)} />
            <Field
              label="Status"
              value={
                <StatusChip label={membership.data.status} tone={toneFor(membership.data.status)} />
              }
            />
            <Field label="Activated" value={formatDate(membership.data.activatedAt)} />
            {/* See CustomerMembershipPage: expiry wording, never "Renews". */}
            <Field label="Valid until" value={formatDate(membership.data.renewalDueAt)} />
            <Field label="Annual points" value={membership.data.yearlyPointsAllocated.toLocaleString('en-PH')} />
          </FieldList>
        )}
        {membership.data && (
          <p className={styles.notice}>
            <Link to="/customer/membership">Open your digital VIP card</Link>
            {' · '}
            <Link to="/customer/redemptions">Redemption history</Link>
            {' · '}
            <Link to="/customer/payments">Payment history</Link>
            {' · '}
            <Link to="/customer/profile">Your profile</Link>
          </p>
        )}
      </Card>

      <Card title="Recent points activity">
        {ledger.isLoading && <p role="status">Loading your points activity…</p>}
        {ledger.isError && <p className={styles.notice}>Your points activity is not available right now.</p>}
        {ledger.data && ledger.data.length === 0 && (
          <EmptyState
            title="No points activity"
            description="Your allocations and redemptions will appear here."
          />
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
