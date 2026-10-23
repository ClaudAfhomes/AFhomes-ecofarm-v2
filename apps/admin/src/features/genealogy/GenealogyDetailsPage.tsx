import { useState, useCallback, useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusChip,
  DateField,
} from '@afhomes/ui';
import { formatCountOrDash } from '@afhomes/shared';
import type { Member } from '@afhomes/contracts';

import { ApiError, ApiNetworkError } from '../../lib/api/errors';
import { getGenealogyNode, getGenealogySummary, getGenealogyUpline, getTeamSalesAnalytics } from './services';
import { humanizeCode } from '../business/format';
import { genealogyKeys, teamSalesKeys } from '../business/queryKeys';
import { useSession } from '../../lib/session';
import { GenealogyTree } from './GenealogyTree';
import { MemberDetailDialog } from '../network-members/MemberDetailDialog';
import { getMember } from '../network-members/services';
import styles from './GenealogyDetailsPage.module.css';

/**
 * Check if the current user can view the full profile of an upline member.
 * SSM cannot view VD profile, SM cannot view SSM/VD profiles, OST cannot view any upline.
 * VD can view all upline (none). Admin can view all.
 */
function canViewUplineProfile(upline: { role: string; staffId: string }, viewer: { roleSlug?: string; id?: string } | null): boolean {
  if (!viewer) return false;
  // Admin can view all
  if (viewer.roleSlug === 'admin' || viewer.roleSlug === 'super_admin') return true;
  // Self can always view own profile
  if (viewer.id === upline.staffId) return true;
  // Seller roles: check hierarchy
  const viewerRole = viewer.roleSlug;
  const uplineRole = upline.role;
  if (!viewerRole) return false;
  // VD can view all upline (none)
  if (viewerRole === 'vice_director') return true;
  // SSM can view VD? No - VD is upline, SSM cannot view VD profile
  if (viewerRole === 'senior_sales_manager') {
    return uplineRole !== 'vice_director';
  }
  // SM can view SSM/VD? No - both are upline
  if (viewerRole === 'sales_manager') {
    return !['vice_director', 'senior_sales_manager'].includes(uplineRole);
  }
  // OST cannot view any upline profile
  if (viewerRole === 'ost') {
    return false;
  }
  return false;
}

/**
 * One seller's network record: identity, upline chain, team summary,
 * interactive downline tree, and team sales activity.
 *
 * Read-only by construction: every figure comes from the authorized genealogy
 * APIs, and nothing here edits attribution. The server remains the security
 * boundary; route guards only decide what is visible.
 */
export function GenealogyDetailsPage() {
  const { staffId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useSession();
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [viewingMember, setViewingMember] = useState<Member | null>(null);
  const [memberLoading, setMemberLoading] = useState(false);

  // Quick presets
  const presets = [
    { label: 'Today', days: 0 },
    { label: 'Past 7 Days', days: 7 },
    { label: 'Past 28 Days', days: 28 },
    { label: 'Past 6 Months', days: 180 },
  ] as const;

  // Compute today's date once per render cycle
  const today = useMemo(() => new Date(), []);
  const todayStr = today.toISOString().slice(0, 10);

  const applyPreset = useCallback((days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - days);
    setDateTo(to.toISOString().slice(0, 10));
    setDateFrom(from.toISOString().slice(0, 10));
  }, []);

  const isPresetActive = useCallback(
    (days: number) => {
      const expectedFrom = new Date();
      expectedFrom.setDate(today.getDate() - days);
      return dateFrom === expectedFrom.toISOString().slice(0, 10) && dateTo === todayStr;
    },
    [dateFrom, dateTo, today, todayStr]
  );

  const handleMemberClick = async (genealogyNode: import('@afhomes/contracts').GenealogyNode) => {
    setMemberLoading(true);
    try {
      const fullMember = await getMember(genealogyNode.staffId);
      setViewingMember(fullMember);
    } catch (error) {
      console.error('Failed to load member details:', error);
    } finally {
      setMemberLoading(false);
    }
  };

  const node = useQuery({
    queryKey: genealogyKeys.node(staffId),
    queryFn: () => getGenealogyNode(staffId),
    placeholderData: keepPreviousData,
  });
  const chain = useQuery({
    queryKey: genealogyKeys.upline(staffId),
    queryFn: () => getGenealogyUpline(staffId),
    placeholderData: keepPreviousData,
  });
  const summary = useQuery({
    queryKey: genealogyKeys.summary(staffId),
    queryFn: () => getGenealogySummary(staffId),
    placeholderData: keepPreviousData,
  });
  const salesQuery = useQuery({
    queryKey: teamSalesKeys.analytics(staffId, 'month', dateFrom, dateTo),
    queryFn: () => getTeamSalesAnalytics(staffId, 'month', dateFrom, dateTo),
    placeholderData: keepPreviousData,
  });

  if (node.isPending)
    return (
      <section>
        <div style={{ display: 'grid', gap: 'var(--space-4)' }} role="status" aria-label="Loading seller">
          <span className="sr-only">Loading seller…</span>
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 280 }} />
            <Skeleton style={{ height: 16, maxWidth: 360 }} />
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Skeleton style={{ height: 120 }} />
            <Skeleton style={{ height: 120 }} />
          </div>
        </div>
      </section>
    );
  if (node.isError)
    return (
      <section className={styles.page}>
        <PageHeader
          title="Seller Record"
          description="The requested seller could not be opened."
          actions={
            <Button variant="secondary" onClick={() => navigate('/admin/genealogy')}>
              Back to sales network
            </Button>
          }
        />
        <ErrorState
          error={node.error}
          title="Seller could not be loaded"
          message={describeSellerLoadError(node.error)}
          onRetry={() => void node.refetch()}
        />
      </section>
    );

  return (
    <section className={styles.page}>
      <PageHeader
        title="Seller Record"
        description={`${node.data.fullName} · ${humanizeCode(node.data.role)}`}
        actions={
          <Button variant="secondary" onClick={() => navigate('/admin/genealogy')}>
            Back
          </Button>
        }
      />

      <section className={styles.hero} aria-label="Seller identity">
        <span className={styles.heroAvatar} aria-hidden="true">
          {(node.data.fullName.trim().charAt(0) || '•').toUpperCase()}
        </span>
        <div className={styles.heroText}>
          <div className={styles.heroNameRow}>
            <h2 className={styles.heroName}>{node.data.fullName}</h2>
          </div>
          <dl className={styles.facts}>
            <div>
              <dt>Role</dt>
              <dd>{humanizeCode(node.data.role)}</dd>
            </div>
            <div>
              <dt>Staff status</dt>
              <dd>
                <StatusChip label={humanizeCode(node.data.status)} />
              </dd>
            </div>
            <div>
              <dt>Direct downline</dt>
              <dd>{formatCountOrDash(node.data.directDownlineCount)}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className={styles.panel} aria-label="Head">
        <h2 className={styles.panelTitle}>Head</h2>
        {chain.isPending ? (
          <p role="status">
            <Skeleton style={{ height: 64 }} />
            <span className="sr-only">Loading head…</span>
          </p>
        ) : chain.isError ? (
          <ErrorState
            error={chain.error}
            title="Head could not be loaded"
            message={describeSellerLoadError(chain.error)}
            onRetry={() => void chain.refetch()}
          />
        ) : chain.data.length ? (
          <article className={styles.headCard} aria-label="Immediate head">
            <span className={styles.headAvatar} aria-hidden="true">
              {(chain.data[0]!.fullName.trim().charAt(0) || '•').toUpperCase()}
            </span>
            <div className={styles.headText}>
              {canViewUplineProfile(chain.data[0]!, user) ? (
                <Link to={`/admin/genealogy/${chain.data[0]!.staffId}`} className={styles.headName}>
                  {chain.data[0]!.fullName}
                </Link>
              ) : (
                <span className={styles.headName} style={{ cursor: 'default', color: 'var(--color-text-primary)' }}>
                  {chain.data[0]!.fullName}
                </span>
              )}
              <p className={styles.headMeta}>
                <StatusChip label={humanizeCode(chain.data[0]!.role)} />
                {chain.data.length > 1 ? (
                  <span className={styles.panelNote}> · reads through an unavailable head</span>
                ) : null}
                {chain.data.length > 1 && !canViewUplineProfile(chain.data[1]!, user) && (
                  <span className={styles.panelNote}> · upline profile restricted</span>
                )}
              </p>
            </div>
          </article>
        ) : (
          <p className={styles.panelNote}>Top-level seller</p>
        )}
      </section>

      <section className={styles.panel} aria-label="Team summary">
        <h2 className={styles.panelTitle}>Team summary</h2>
        {summary.isPending ? (
          <p role="status">
            <Skeleton style={{ height: 88 }} />
            <span className="sr-only">Loading summary…</span>
          </p>
        ) : summary.isError ? (
          <ErrorState
            error={summary.error}
            title="Team summary could not be loaded"
            message={describeSellerLoadError(summary.error)}
            onRetry={() => void summary.refetch()}
          />
        ) : summary.data.totalDirectDownline === 0 ? (
          <>
            <div className={styles.badges}>
              <StatusChip
                label={`Direct downline: ${formatCountOrDash(summary.data.totalDirectDownline)}`}
                tone="neutral"
                icon="users"
              />
              <StatusChip
                label={`Active sellers: ${formatCountOrDash(summary.data.activeSellerCount)}`}
                tone="success"
                icon="user-check"
              />
              <StatusChip
                label={`Inactive sellers: ${formatCountOrDash(summary.data.inactiveSellerCount)}`}
                tone="neutral"
                icon="user-x"
              />
            </div>
            <div className={styles.emptyWrap}>
              <EmptyState title="No downline yet" description="New recruits appear here." />
            </div>
          </>
        ) : (
          <>
            <div className={styles.badges}>
              <StatusChip
                label={`Direct downline: ${formatCountOrDash(summary.data.totalDirectDownline)}`}
                tone="neutral"
                icon="users"
              />
              <StatusChip
                label={`Active sellers: ${formatCountOrDash(summary.data.activeSellerCount)}`}
                tone="success"
                icon="user-check"
              />
              <StatusChip
                label={`Inactive sellers: ${formatCountOrDash(summary.data.inactiveSellerCount)}`}
                tone="neutral"
                icon="user-x"
              />
            </div>
            <h3 className={styles.subTitle}>Team mix</h3>
            <ul className={styles.mix}>
              {(
                [
                  'vice_director',
                  'senior_sales_manager',
                  'sales_manager',
                  'ost',
                ] as const
              ).map((role) => (
                <li key={role}>
                  <span>{humanizeCode(role)}</span>
                  <strong>{formatCountOrDash(summary.data.roleCounts[role])}</strong>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className={styles.panel} aria-label="My Downline">
        <h2 className={styles.panelTitle}>My Downline</h2>
        <GenealogyTree
          rootStaffId={staffId}
          viewerRole={user?.roleSlug ?? ''}
          viewerId={user?.id ?? ''}
          onMemberClick={handleMemberClick}
        />
        {memberLoading && <div className={styles.loading}>Loading member details…</div>}
      </section>

      <section className={styles.panel} aria-label="Team sales activity">
        <div className={styles.filterSection}>
          <h2 className={styles.panelTitle}>Team Sales Activity</h2>

          {/* Quick presets */}
          <div className={styles.presetButtons} role="group" aria-label="Quick date presets">
            {presets.map((p) => (
              <Button
                key={p.label}
                variant="ghost"
                size="sm"
                onClick={() => applyPreset(p.days)}
                className={isPresetActive(p.days) ? styles.presetActive : ''}
              >
                {p.label}
              </Button>
            ))}
          </div>

          {/* Custom date range */}
          <div className={styles.dateRangeInputs}>
            <div className={styles.dateInputGroup}>
              <DateField
                id="date-from"
                name="date-from"
                label="Start Date"
                value={dateFrom}
                onChange={setDateFrom}
                max={dateTo || todayStr}
                hint="Optional — defaults to period start"
                optional
              />
            </div>
            <div className={styles.dateInputGroup}>
              <DateField
                id="date-to"
                name="date-to"
                label="End Date"
                value={dateTo}
                onChange={setDateTo}
                min={dateFrom || undefined}
                max={todayStr}
                hint="Optional — defaults to today"
                optional
              />
            </div>
          </div>

          {/* Validation message */}
          {dateFrom && dateTo && new Date(dateFrom) > new Date(dateTo) && (
            <div className={styles.validationError} role="alert">
              End date must be on or after start date
            </div>
          )}
        </div>

        {salesQuery.isPending ? (
          <div className={styles.salesLoading}>
            <Skeleton style={{ height: 120 }} />
            <Skeleton style={{ height: 200 }} />
          </div>
        ) : salesQuery.isError ? (
          <ErrorState error={salesQuery.error} title="Sales activity could not be loaded" onRetry={() => void salesQuery.refetch()} />
        ) : (
          <>
            <div className={styles.kpiGrid}>
              <article className={styles.kpiCard}>
                <dt>Total Sales</dt>
                <dd>{formatCountOrDash(salesQuery.data.kpis.totalTeamSales)}</dd>
              </article>
              <article className={styles.kpiCard}>
                <dt>Members With Sales</dt>
                <dd>{formatCountOrDash(salesQuery.data.kpis.membersWithSales)}</dd>
              </article>
              <article className={styles.kpiCard}>
                <dt>No Sales</dt>
                <dd>{formatCountOrDash(salesQuery.data.kpis.membersNoSales)}</dd>
              </article>
              <article className={styles.kpiCard}>
                <dt>Top Seller</dt>
                <dd>{formatCountOrDash(salesQuery.data.kpis.topSellerCount)}</dd>
              </article>
              <article className={styles.kpiCard}>
                <dt>Participation</dt>
                <dd>{salesQuery.data.kpis.participationRate.toFixed(1)}%</dd>
              </article>
            </div>

            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Role</th>
                    <th style={{ textAlign: 'right' }}>Sales</th>
                    <th>Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {salesQuery.data.members
                    .sort((a, b) => b.salesCount - a.salesCount)
                    .map((member) => (
                      <tr key={member.staffId}>
                        <td>
                          <span className={styles.memberName}>
                            {member.fullName}
                            {member.staffId === user?.id && <span className={styles.youBadge}>(You)</span>}
                          </span>
                        </td>
                        <td><StatusChip label={humanizeCode(member.role)} tone="neutral" /></td>
                        <td style={{ textAlign: 'right' }}>{formatCountOrDash(member.salesCount)}</td>
                        <td>
                          <StatusChip
                            label={member.salesActivity}
                            tone={
                              member.salesActivity === 'Top Seller' ? 'success' :
                              member.salesActivity === 'With Sales' ? 'info' :
                              member.salesActivity === 'Low Sales' ? 'warning' : 'neutral'
                            }
                          />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <p className={styles.reportPeriod}>
              {dateFrom || dateTo
                ? `Custom range: ${dateFrom || 'start'} to ${dateTo || 'today'} (UTC)`
                : `Reporting period: ${salesQuery.data.window.from.slice(0, 10)} to ${salesQuery.data.window.to.slice(0, 10)} (UTC)`}
            </p>
          </>
        )}

      </section>

      {viewingMember && (
        <MemberDetailDialog
          member={viewingMember}
          onClose={() => setViewingMember(null)}
          onChanged={() => { /* invalidate queries if needed */ }}
        />
      )}
    </section>
  );
}

/**
 * Actionable seller-load guidance per failure cause. Raw server internals are
 * never rendered (see `ErrorState`); each branch names the next step instead.
 * Returns `undefined` for unknown errors so the shared generic message applies.
 */
function describeSellerLoadError(error: unknown): string | undefined {
  if (error instanceof ApiNetworkError)
    return 'Check your connection and try again. If this continues, contact AFHomes support.';
  if (error instanceof ApiError && error.status === 401)
    return 'Your session has expired. Sign in again, then retry.';
  if (error instanceof ApiError && error.status === 403)
    return 'Your account cannot open this seller right now. Contact an administrator.';
  return undefined;
}