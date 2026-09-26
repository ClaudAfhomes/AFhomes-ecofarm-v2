import { Link } from 'react-router';
import { useMemo } from 'react';

import { useSession } from '../../../lib/session';
import { formatMoney } from '@jad/shared';
import {
  EmptyState,
  ErrorState,
  Icon,
  PageHeader,
  Skeleton,
  StatusChip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@jad/ui';
import type { Genealogy, GenealogyNode, SaleStatus } from '@jad/contracts';

import {
  useCommissions,
  useGenealogy,
  usePayoutAccounts,
  useQualification,
  useSales,
  useWallet,
} from '../hooks/useMember';
import {
  MEMBER_STATUS_TONE,
  SALE_STATUS_TONE,
  formatDate,
  memberStatusLabel,
  saleStatusLabel,
} from '../lib/presentation';
import styles from './DashboardPage.module.css';

const RECENT_SALES_LIMIT = 4;
const GENEALOGY_LIMIT = 5;

const BANNER_TONE: Record<string, string | undefined> = {
  PENDING: styles.statusWarning,
  REJECTED: styles.statusDanger,
  NOT_QUALIFIED: styles.statusWarning,
};

function FinancialSkeleton() {
  return (
    <div className={styles.financialCard} aria-hidden="true">
      <div className={styles.financialTop}>
        <Skeleton className={styles.financialSkeletonLabel} />
        <Skeleton style={{ width: 44, height: 44, borderRadius: 12 }} />
      </div>
      <Skeleton className={styles.financialSkeletonValue} />
      <Skeleton className={styles.financialSkeletonHint} />
    </div>
  );
}

function flattenGenealogy(root: Genealogy['root']): GenealogyNode[] {
  const out: GenealogyNode[] = [];
  const walk = (node: GenealogyNode) => {
    for (const child of node.children) {
      out.push(child);
      for (const grand of child.children) out.push(grand);
    }
  };
  walk(root);
  return out;
}

/**
 * Member dashboard (SCR-MEM-001). Financial summary + Recent Sales + Genealogy.
 * All money is server-provided exact-decimal strings via formatMoney; no client
 * calculation. Layout: 4 financial cards (desktop 4col / tablet 2x2 / mobile 1col)
 * then 2-col Recent Sales + Genealogy (stacked on mobile).
 */
export function DashboardPage() {
  const { user } = useSession();
  const walletQuery = useWallet();
  const qualificationQuery = useQualification();
  const salesQuery = useSales();
  const genealogyQuery = useGenealogy();
  const commissionsQuery = useCommissions();
  const payoutsQuery = usePayoutAccounts();

  const status = user?.status;
  const isQualified = qualificationQuery.data?.isQualified ?? user?.isQualified;

  const wallet = walletQuery.data;

  const recentSales = useMemo(
    () => (salesQuery.data ?? []).slice(0, RECENT_SALES_LIMIT),
    [salesQuery.data],
  );
  // Pending is the server-computed pipeline estimate (open sales x rates),
  // not the sum of PENDING commissions (commissions now credit instantly).
  const pendingCommissions = wallet?.pendingCommission ?? '0.00';
  const genealogyRows = useMemo(() => {
    const root = genealogyQuery.data?.root;
    if (!root) return [];
    return flattenGenealogy(root).slice(0, GENEALOGY_LIMIT);
  }, [genealogyQuery.data]);

  return (
    <section>
      <PageHeader title="Dashboard" description={`Welcome back, ${user?.name}.`} />

      {status === 'PENDING' ? (
        <div className={`${styles.statusBanner} ${BANNER_TONE.PENDING}`}>
          <StatusChip label={memberStatusLabel('PENDING')} tone={MEMBER_STATUS_TONE.PENDING} />
          <p>
            Your application is Pending - email verification and JA&amp;D review come before your
            account becomes active.
          </p>
        </div>
      ) : null}

      {status === 'REJECTED' ? (
        <div className={`${styles.statusBanner} ${BANNER_TONE.REJECTED}`}>
          <StatusChip label={memberStatusLabel('REJECTED')} tone={MEMBER_STATUS_TONE.REJECTED} />
          <p>
            Your application was not approved. You can correct the flagged details and resubmit.
          </p>
          <Link className={styles.bannerLink} to="/member/resubmit">
            Resubmit your application
          </Link>
        </div>
      ) : null}

      {status === 'APPROVED_ACTIVE' && !isQualified ? (
        <div className={`${styles.statusBanner} ${BANNER_TONE.NOT_QUALIFIED}`}>
          <StatusChip label="Not qualified" tone="warning" />
          <p>Complete the qualification requirements to submit qualifying sales.</p>
          <Link className={styles.bannerLink} to="/member/qualification?highlight=unmet">
            View qualification status
          </Link>
        </div>
      ) : null}

      {/* Membership summary - kept for account-status visibility and test compat */}
      {status ? (
        <div className={styles.membershipBar}>
          <StatusChip label={memberStatusLabel(status)} tone={MEMBER_STATUS_TONE[status]} />
          <StatusChip
            label={isQualified ? 'Qualified' : 'Not qualified'}
            tone={isQualified ? 'success' : 'warning'}
          />
          {isQualified ? (
            <Link to="/member/sales/new" className={styles.membershipCta}>
              Submit sale
            </Link>
          ) : null}
        </div>
      ) : null}

      {/* ── SECTION 1 - FINANCIAL SUMMARY (4 cards) ─────────────────────── */}
      <section aria-label="Financial summary">
        {walletQuery.isLoading ? (
          <div className={styles.financialGrid}>
            <FinancialSkeleton />
            <FinancialSkeleton />
            <FinancialSkeleton />
            <FinancialSkeleton />
          </div>
        ) : walletQuery.isError || !wallet ? (
          <ErrorState error={walletQuery.error} title="Could not load your wallet summary" />
        ) : (
          <div className={styles.financialGrid}>
            {/* 1 - Available Balance */}
            <div className={styles.financialCard}>
              <div className={styles.financialTop}>
                <span className={styles.financialLabel}>Available Balance</span>
                <span
                  className={`${styles.financialIcon} ${styles.financialIconAvailable}`}
                  aria-hidden="true"
                >
                  <Icon name="wallet" size={20} />
                </span>
              </div>
              <span className={styles.financialValue}>{formatMoney(wallet.availableBalance)}</span>
              <span className={styles.financialHint}>Ready to withdraw</span>
            </div>

            {/* 2 - Pending Commissions */}
            <div className={styles.financialCard}>
              <div className={styles.financialTop}>
                <span className={styles.financialLabel}>Pending Commissions</span>
                <span
                  className={`${styles.financialIcon} ${styles.financialIconPending}`}
                  aria-hidden="true"
                >
                  <Icon name="info" size={20} />
                </span>
              </div>
              <span className={styles.financialValue}>{formatMoney(pendingCommissions)}</span>
              <span className={styles.financialHint}>
                Awaiting admin approval of submitted sales
              </span>
            </div>

            {/* 3 - Total Withdrawals */}
            <div className={styles.financialCard}>
              <div className={styles.financialTop}>
                <span className={styles.financialLabel}>Total Withdrawals</span>
                <span
                  className={`${styles.financialIcon} ${styles.financialIconWithdrawals}`}
                  aria-hidden="true"
                >
                  <Icon name="list" size={20} />
                </span>
              </div>
              <span className={styles.financialValue}>
                {formatMoney(wallet.totalWithdrawals ?? '0.00')}
              </span>
              <span className={styles.financialHint}>Completed &amp; reserved</span>
            </div>

            {/* 4 - Total Earned */}
            <div className={styles.financialCard}>
              <div className={styles.financialTop}>
                <span className={styles.financialLabel}>Total Earned</span>
                <span
                  className={`${styles.financialIcon} ${styles.financialIconEarned}`}
                  aria-hidden="true"
                >
                  <Icon name="check" size={20} />
                </span>
              </div>
              <span className={styles.financialValue}>
                {formatMoney(wallet.totalEarned ?? '0.00')}
              </span>
              <span className={styles.financialHint}>Ledger-defined total</span>
            </div>
          </div>
        )}
      </section>

      {/* Sales & Earnings quick links */}
      <nav aria-label="Sales and earnings" className={styles.quickLinks}>
        <Link to="/member/sales" className={styles.quickLink}>
          <span className={`${styles.quickIcon} ${styles.quickIconSales}`} aria-hidden="true">
            <Icon name="check" size={18} />
          </span>
          <span className={styles.quickText}>
            <span className={styles.quickLabel}>Sales</span>
            <span className={styles.quickMeta}>
              {salesQuery.isLoading ? (
                <Skeleton className={styles.quickMetaSkeleton} />
              ) : (
                `${salesQuery.data?.length ?? 0} records`
              )}
            </span>
          </span>
        </Link>
        <Link to="/member/commissions" className={styles.quickLink}>
          <span className={`${styles.quickIcon} ${styles.quickIconCommissions}`} aria-hidden="true">
            <Icon name="grid" size={18} />
          </span>
          <span className={styles.quickText}>
            <span className={styles.quickLabel}>Commissions</span>
            <span className={styles.quickMeta}>
              {commissionsQuery.isLoading ? (
                <Skeleton className={styles.quickMetaSkeleton} />
              ) : (
                `${commissionsQuery.data?.length ?? 0} records`
              )}
            </span>
          </span>
        </Link>
        <Link to="/member/ewallet" className={styles.quickLink}>
          <span className={`${styles.quickIcon} ${styles.quickIconWallet}`} aria-hidden="true">
            <Icon name="wallet" size={18} />
          </span>
          <span className={styles.quickText}>
            <span className={styles.quickLabel}>eWallet</span>
            <span className={styles.quickMeta}>Available &amp; pending</span>
          </span>
        </Link>
        <Link to="/member/payouts" className={styles.quickLink}>
          <span className={`${styles.quickIcon} ${styles.quickIconPayouts}`} aria-hidden="true">
            <Icon name="list" size={18} />
          </span>
          <span className={styles.quickText}>
            <span className={styles.quickLabel}>Payouts</span>
            <span className={styles.quickMeta}>
              {payoutsQuery.isLoading ? (
                <Skeleton className={styles.quickMetaSkeleton} />
              ) : (
                `${payoutsQuery.data?.length ?? 0} accounts`
              )}
            </span>
          </span>
        </Link>
      </nav>

      {/* ── SECTION 2 - ACTIVITY / RELATIONSHIP (2-col) ─────────────────── */}
      <div className={styles.lowerSection}>
        <div className={styles.lowerGrid}>
          {/* LEFT - Recent Sales Table */}
          <section className={styles.sectionCard} aria-label="Recent sales">
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Recent Sales</h2>
              {(salesQuery.data ?? []).length > 0 ? (
                <Link className={styles.sectionAction} to="/member/sales">
                  View all
                </Link>
              ) : null}
            </div>
            <div className={styles.sectionBody}>
              {salesQuery.isLoading ? (
                <div
                  className={styles.loadingWrap}
                  role="status"
                  aria-live="polite"
                  aria-busy="true"
                >
                  <Skeleton style={{ height: 44 }} />
                  <Skeleton style={{ height: 44 }} />
                  <Skeleton style={{ height: 44 }} />
                </div>
              ) : salesQuery.isError ? (
                <div className={styles.errorWrap}>
                  <ErrorState error={salesQuery.error} title="Could not load sales" />
                </div>
              ) : recentSales.length === 0 ? (
                <div className={styles.emptyWrap}>
                  <EmptyState
                    title="No sales yet"
                    description="When you have qualifying sales they will appear here."
                    action={
                      <Link className={styles.inlineLink} to="/member/sales">
                        Submit your first sale
                      </Link>
                    }
                  />
                </div>
              ) : (
                <div className={styles.tableWrap}>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableHeaderCell>Property</TableHeaderCell>
                        <TableHeaderCell align="right">Value</TableHeaderCell>
                        <TableHeaderCell>Status</TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {recentSales.map((sale) => (
                        <TableRow key={sale.id}>
                          <TableCell label="Property">
                            <Link to={`/member/sales/${sale.id}`} className={styles.propertyLink}>
                              {sale.propertyName}
                            </Link>
                            <span
                              style={{
                                display: 'block',
                                fontSize: 'var(--text-caption)',
                                color: 'var(--color-text-muted)',
                              }}
                            >
                              {sale.customerName} · {formatDate(sale.submittedAt)}
                            </span>
                          </TableCell>
                          <TableCell label="Value" align="right">
                            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                              {formatMoney(sale.propertyValue)}
                            </span>
                          </TableCell>
                          <TableCell label="Status">
                            <StatusChip
                              label={saleStatusLabel(sale.status)}
                              tone={SALE_STATUS_TONE[sale.status as SaleStatus]}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </section>

          {/* RIGHT - Genealogy Table */}
          <section className={styles.sectionCard} aria-label="Genealogy">
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Genealogy</h2>
              <Link className={styles.sectionAction} to="/member/referrals/genealogy">
                View full tree
              </Link>
            </div>
            <div className={styles.sectionBody}>
              {genealogyQuery.isLoading ? (
                <div
                  className={styles.loadingWrap}
                  role="status"
                  aria-live="polite"
                  aria-busy="true"
                >
                  <Skeleton style={{ height: 44 }} />
                  <Skeleton style={{ height: 44 }} />
                  <Skeleton style={{ height: 44 }} />
                </div>
              ) : genealogyQuery.isError || !genealogyQuery.data ? (
                <div className={styles.errorWrap}>
                  <ErrorState error={genealogyQuery.error} title="Could not load genealogy" />
                </div>
              ) : genealogyRows.length === 0 ? (
                <div className={styles.emptyWrap}>
                  <EmptyState
                    title="No referrals yet"
                    description="Members who join with your code appear here."
                    action={
                      <Link className={styles.inlineLink} to="/member/referrals">
                        View referral code
                      </Link>
                    }
                  />
                </div>
              ) : (
                <div className={styles.tableWrap}>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableHeaderCell>Member</TableHeaderCell>
                        <TableHeaderCell>Status</TableHeaderCell>
                        <TableHeaderCell>Qualified</TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {genealogyRows.map((node) => (
                        <TableRow key={node.id}>
                          <TableCell label="Member">
                            <span style={{ fontWeight: 600 }}>{node.name}</span>
                            <span
                              style={{
                                display: 'block',
                                fontSize: 'var(--text-caption)',
                                color: 'var(--color-text-muted)',
                              }}
                            >
                              Joined {formatDate(node.joinedAt)}
                            </span>
                          </TableCell>
                          <TableCell label="Status">
                            <StatusChip
                              label={memberStatusLabel(node.status)}
                              tone={MEMBER_STATUS_TONE[node.status]}
                            />
                          </TableCell>
                          <TableCell label="Qualified">
                            <StatusChip
                              label={node.isQualified ? 'Qualified' : 'Not qualified'}
                              tone={node.isQualified ? 'success' : 'warning'}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
