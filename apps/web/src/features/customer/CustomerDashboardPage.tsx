import { Link } from 'react-router';
import { isFeaturePathEnabled } from '@afhomes/shared';
import { paymentSchemeLabel } from '@afhomes/contracts';
import { EmptyState, ErrorState, PageHeader, Skeleton, StatusChip } from '@afhomes/ui';

import {
  useCustomerLedgerQuery,
  useCustomerMembershipQuery,
  useCustomerPointsPositionQuery,
  useCustomerProfileQuery,
} from './queries';
import { DashboardAnnouncements } from './DashboardAnnouncements';
import { QuickActions } from './QuickActions';
import { VipCardPreview } from './VipCardPreview';
import { isForbidden, isNotFound } from './http';
import {
  ActivityList,
  ActivityListSkeleton,
  ActivityRow,
  PortalSection,
  formatDate,
  humanEntryType,
  isNoCard,
  statusTone,
  ui,
} from './portal-ui';
import styles from './dashboard.module.css';

/**
 * Customer dashboard: the member's own position in one screen.
 *
 * Membership-first: welcome, the VIP card preview beside the membership summary,
 * quick links, announcements and recent points activity. Deliberately read-only
 * and narrow - no staff-only field and no finance data. The scannable QR and
 * every other card field live on the membership screen; the dashboard never
 * renders a QR payload or token.
 *
 * React Query dedupes by key, so the profile fetch here is the same request the
 * shell already made.
 */
export function CustomerDashboardPage() {
  const profile = useCustomerProfileQuery();
  const membership = useCustomerMembershipQuery();
  // The POSITION endpoint, not the legacy summary: the dashboard headline is
  // SPENDABLE, and debt must be visible here rather than only on the points page.
  const position = useCustomerPointsPositionQuery();
  const ledger = useCustomerLedgerQuery();

  if (profile.isLoading) return <p role="status">Loading your account…</p>;

  // A 404 is the normal "no active membership" answer; it is shown at once instead of
  // waiting for the client to finish retrying it.
  const noCard = isNoCard(membership);
  const summaryLoading =
    !noCard && (membership.isLoading || (position.isLoading && !isNoCard(position)));
  const pointsEnabled = isFeaturePathEnabled('/customer/points');
  const messagesEnabled = isFeaturePathEnabled('/customer/messages');

  return (
    <>
      <div className={styles.welcome}>
        <PageHeader
          title="Dashboard"
          description={
            profile.data
              ? `Welcome back, ${profile.data.fullName}.`
              : 'Your membership, points, and recent activity.'
          }
        />
      </div>

      {summaryLoading ? (
        <div role="status" aria-label="Loading summary">
          <div className={styles.hero} aria-hidden="true">
            <Skeleton className={styles.heroSkeleton} />
            <Skeleton className={styles.heroSkeleton} />
          </div>
        </div>
      ) : (
        <div className={styles.hero}>
          {membership.data ? (
            <VipCardPreview
              productCode={membership.data.productCode}
              productName={membership.data.productName}
              status={membership.data.status}
              memberName={profile.data?.fullName}
              membershipNumber={membership.data.membershipNumber}
              validUntil={membership.data.renewalDueAt}
              href="/customer/membership"
            />
          ) : (
            <ErrorState
              title="Card unavailable"
              message={
                isForbidden(membership.error)
                  ? 'Your account is not active, so your card is not available. Contact AFhomes Ecofarm to restore access.'
                  : isNotFound(membership.failureReason)
                    ? 'You do not have an active membership yet.'
                    : 'We could not load your card. Please try again in a moment.'
              }
            />
          )}

          {membership.data ? (
            <section className={`${ui.surface} ${styles.summary}`}>
              <h2 className={ui.sectionLabel}>Available Points</h2>
              <p className={styles.points}>
                {position.data ? position.data.spendable.toLocaleString('en-PH') : '—'}
              </p>
              <p className={ui.muted}>
                {position.data
                  ? `${position.data.balance.toLocaleString('en-PH')} on your card${
                      position.data.reversalDebt > 0
                        ? ` · ${position.data.reversalDebt.toLocaleString('en-PH')} held for a reversal`
                        : ''
                    }`
                  : 'Points are not available right now.'}
              </p>
              {pointsEnabled && (
                <Link className={styles.pointsLink} to="/customer/points">
                  View points
                </Link>
              )}
              <hr className={ui.divider} />
              <dl className={styles.defs}>
                <div className={styles.defRow}>
                  <dt className={styles.defTerm}>Status</dt>
                  <dd className={styles.defValue}>
                    <StatusChip
                      label={membership.data.status}
                      tone={statusTone(membership.data.status)}
                    />
                  </dd>
                </div>
                <div className={styles.defRow}>
                  <dt className={styles.defTerm}>Valid until</dt>
                  <dd className={styles.defValue}>
                    {/* Expiry wording, never "Renews" (see CustomerMembershipPage). */}
                    {formatDate(membership.data.renewalDueAt)}
                    {membership.data.validityYears ? (
                      <span className={styles.defHint}>
                        {`Valid for ${membership.data.validityYears} year${membership.data.validityYears === 1 ? '' : 's'}`}
                      </span>
                    ) : null}
                  </dd>
                </div>
                <div className={styles.defRow}>
                  <dt className={styles.defTerm}>Payment scheme</dt>
                  <dd className={styles.defValue}>
                    {paymentSchemeLabel(membership.data.paymentScheme)}
                  </dd>
                </div>
              </dl>
            </section>
          ) : (
            <section className={`${ui.surface} ${styles.account}`}>
              <h2 className={ui.sectionLabel}>Your account</h2>
              {profile.data && (
                <p>
                  <StatusChip label={profile.data.status} tone={statusTone(profile.data.status)} />
                </p>
              )}
              <p className={styles.accountText}>
                Your points and card details appear here once you have an active membership.
                {messagesEnabled ? ' Questions about your membership? Send us a message.' : ''}
              </p>
              {messagesEnabled && (
                <Link className={styles.accountAction} to="/customer/messages">
                  Open Messages
                </Link>
              )}
            </section>
          )}
        </div>
      )}

      <PortalSection title="Quick actions">
        <QuickActions hasMembership={Boolean(membership.data)} />
      </PortalSection>

      <DashboardAnnouncements />

      <PortalSection
        title="Recent points activity"
        action={
          ledger.data && ledger.data.length > 0 && pointsEnabled ? (
            <Link to="/customer/points">See all points activity</Link>
          ) : undefined
        }
      >
        <div className={`${ui.surface} ${styles.panel}`}>
          {ledger.isLoading && !isNoCard(ledger) && <ActivityListSkeleton />}
          {isNoCard(ledger) && (
            <EmptyState
              title="No points activity"
              description="Points activity appears here once your membership is active."
            />
          )}
          {ledger.isError && !isNoCard(ledger) && (
            <p className={`${styles.notice} ${styles.panelPad}`}>
              Your points activity is not available right now.
            </p>
          )}
          {ledger.data && ledger.data.length === 0 && (
            <EmptyState
              title="No points activity"
              description="Your allocations and redemptions will appear here."
            />
          )}
          {ledger.data && ledger.data.length > 0 && (
            <ActivityList label="Recent points activity">
              {ledger.data.slice(0, 5).map((entry) => (
                <ActivityRow
                  key={entry.id}
                  icon="star"
                  title={humanEntryType(entry.entryType)}
                  meta={
                    <>
                      <span>{formatDate(entry.occurredAt)}</span>
                      {entry.reason ? (
                        <>
                          {' · '}
                          <span>{entry.reason}</span>
                        </>
                      ) : null}
                    </>
                  }
                  amount={Math.abs(entry.amount).toLocaleString('en-PH')}
                  direction={entry.amount >= 0 ? 'credit' : 'debit'}
                  tone={entry.amount >= 0 ? 'success' : 'neutral'}
                  status={
                    <span className={styles.balanceAfter}>
                      Balance {entry.balanceAfter.toLocaleString('en-PH')}
                    </span>
                  }
                />
              ))}
            </ActivityList>
          )}
        </div>
      </PortalSection>
    </>
  );
}
