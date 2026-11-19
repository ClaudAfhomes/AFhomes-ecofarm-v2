import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AccreditationId, Button, ErrorState, StatusChip } from '@afhomes/ui';
import { formatMoney } from '@afhomes/shared';

import { useCustomerSession } from '../../lib/customer-session';
import { getAuthPortals } from '../../lib/portals';
import { getOstMe, getOstDashboard } from './services';
import { Card, Field, FieldList, formatDate, styles } from '../customer/portal-ui';
import { saleTeamLookupSchema } from '@afhomes/contracts';
import { request } from '../../lib/api/client';
import { ProfilePhotoCard } from '../customer/ProfilePhotoCard';
import { formatCountOrDash } from '@afhomes/shared';

/**
 * The approved OST member's own dashboard: their number, status, sponsor and
 * approval, head info, personal sales, and personal commissions.
 * Data comes from `GET /ost/me/dashboard`, which resolves the member from the
 * bearer token, so there is no member id to pass or to spoof.
 */
export function OstDashboardPage() {
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
    queryFn: getOstMe,
    enabled: portals.data?.ost?.status === 'active',
    retry: false,
  });
  const dashboard = useQuery({
    queryKey: ['ost', 'dashboard'],
    queryFn: getOstDashboard,
    enabled: portals.data?.ost?.status === 'active',
    retry: false,
  });

  if (portals.isLoading || me.isLoading || dashboard.isLoading) return <p role="status">Loading your OST account…</p>;
  if (portals.isError || me.isError || dashboard.isError) {
    return (
      <ErrorState
        title="OST record unavailable"
        message="We could not load your OST record. If your application was just approved, sign out and sign in again."
      />
    );
  }

  const record = me.data!;
  const dash = dashboard.data!;

  return (
    <>
      <Card
        title="OST Account"
        actions={
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
        }
      >
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
                <AccreditationId value={accreditation.data?.aaNumber ?? null} />
              )
            }
          />
          {accreditation.data ? (
            <>
              <Field label="Accreditation" value={accreditation.data.status.replaceAll('_', ' ')} />
              <Field label="Valid From" value={accreditation.data.startsOn} />
              <Field label="Valid Until" value={accreditation.data.expiresOn} />
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
          <Button variant="secondary" onClick={() => void accreditation.refetch()}>
            Retry accreditation
          </Button>
        ) : null}
        <p className={styles.notice}>
          Applications you sponsor appear after applicants register with your referral code.{' '}
          <Link to="/ost/renewal">Accreditation history and renewal</Link>
        </p>
      </Card>

      {/* Head Information */}
      <Card title="My Head (Sponsor)">
        <FieldList>
          <Field label="Head Name" value={dash.head.headName} />
          <Field label="Head Role" value={dash.head.headRole} />
          <Field
            label="Head Status"
            value={
              <StatusChip
                label={dash.head.headStatus}
                tone={dash.head.headStatus === 'active' ? 'success' : 'warning'}
              />
            }
          />
          <Field label="Relationship" value={dash.head.relationship} />
        </FieldList>
      </Card>

      {/* My Sales */}
      <Card title="My Sales">
        <div className={styles.kpiGrid}>
          <article className={styles.kpiCard}>
            <div className={styles.kpiIcon} style={{ background: 'var(--color-brand-primary)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M18 20V10" /><path d="M12 20V4" /><path d="M6 20v-6" />
              </svg>
            </div>
            <dt>Total Sales</dt>
            <dd>{formatCountOrDash(dash.sales.totalSales)}</dd>
          </article>
          <article className={styles.kpiCard}>
            <div className={styles.kpiIcon} style={{ background: 'var(--color-success)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <dt>Qualifying Sales</dt>
            <dd>{formatCountOrDash(dash.sales.periodSales)}</dd>
          </article>
        </div>
        <p className={styles.reportPeriod}>
          Qualifying sale status: {dash.sales.qualifyingSaleStatus}
        </p>
      </Card>

      {/* My Commissions */}
      <Card title="My Commissions">
        <div className={styles.kpiGrid}>
          <article className={styles.kpiCard}>
            <div className={styles.kpiIcon} style={{ background: 'var(--color-brand-secondary)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <dt>Commission to Earn</dt>
            <dd>{formatMoney(dash.commissions.toEarn.amount)}</dd>
            <dd className={styles.kpiSubLabel}>{dash.commissions.toEarn.count} commission(s) pending qualification</dd>
          </article>
          <article className={styles.kpiCard}>
            <div className={styles.kpiIcon} style={{ background: 'var(--color-success)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <dt>Commission Earned</dt>
            <dd>{formatMoney(dash.commissions.earned.amount)}</dd>
            <dd className={styles.kpiSubLabel}>{dash.commissions.earned.count} commission(s)</dd>
          </article>
          <article className={styles.kpiCard}>
            <div className={styles.kpiIcon} style={{ background: 'var(--color-brand-primary)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M12 2a10 10 0 0 1 10 10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <dt>Commission Paid</dt>
            <dd>{formatMoney(dash.commissions.paid.amount)}</dd>
            <dd className={styles.kpiSubLabel}>{dash.commissions.paid.count} commission(s)</dd>
          </article>
          <article className={styles.kpiCard}>
            <div className={styles.kpiIcon} style={{ background: 'var(--color-error)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <dt>Cancelled</dt>
            <dd>{formatMoney(dash.commissions.cancelled.amount)}</dd>
            <dd className={styles.kpiSubLabel}>{dash.commissions.cancelled.count} commission(s)</dd>
          </article>
        </div>

        {/* Commission History Table */}
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Sale Reference</th>
                <th>Commission</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {dash.commissionHistory.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ textAlign: 'center', padding: 'var(--space-4)' }}>
                    No commission records yet.
                  </td>
                </tr>
              ) : (
                dash.commissionHistory.map((comm) => (
                  <tr key={comm.id}>
                    <td>{comm.saleNumber}</td>
                    <td>{formatMoney(comm.amount)}</td>
                    <td>
                      <StatusChip
                        label={comm.status.replaceAll('_', ' ')}
                        tone={
                          comm.status === 'earned' ? 'success' :
                          comm.status === 'paid' ? 'info' :
                          comm.status === 'pending' || comm.status === 'payment_verified' || comm.status === 'final_qualification_pending' ? 'warning' :
                          'neutral'
                        }
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {accreditation.isError ? (
        <Button variant="secondary" onClick={() => void accreditation.refetch()}>
          Retry accreditation
        </Button>
      ) : null}
      <p className={styles.notice}>
        Applications you sponsor appear after applicants register with your referral code.{' '}
        <Link to="/ost/renewal">Accreditation history and renewal</Link>
      </p>
      <ProfilePhotoCard scope="staff" />
    </>
  );
}