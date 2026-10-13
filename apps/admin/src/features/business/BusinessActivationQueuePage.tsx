import { useMemo, useState, type KeyboardEvent } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  FilterBar,
  MetricCard,
  PageHeader,
  SearchField,
  Select,
  Skeleton,
  StatusChip,
  TextField,
  notifySuccess,
} from '@afhomes/ui';
import {
  paymentSchemeLabel,
  type ActivationResult,
  type FinanceQueueItem,
} from '@afhomes/contracts';

import { formatDateTime } from '../../lib/format';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { SPOT_CASH_LABEL, SPOT_CASH_TONE } from './format';
import { formatCountOrDash, formatMoneyOrDash } from '@afhomes/shared';
import { activateSale, getActivationQueue } from './services';
import { businessKeys, sharedScopes } from './queryKeys';
import { TierBadge } from './TierBadge';
import styles from './BusinessActivationQueuePage.module.css';

/**
 * Tier from a card plan name, using the same uppercase-substring rule the
 * dashboard uses to read tiers off published names. Unrecognized plans pass
 * through to TierBadge's neutral treatment with the name intact.
 */
function tierFromProductName(productName: string): string {
  const upper = productName.toUpperCase();
  if (upper.includes('GOLD')) return 'GOLD';
  if (upper.includes('SILVER')) return 'SILVER';
  if (upper.includes('BRONZE')) return 'BRONZE';
  return productName;
}

/**
 * Activation queue.
 *
 * A membership becomes active only through the server's activation transition,
 * which re-checks that VERIFIED payments reach the snapshotted price inside the
 * transaction. This button cannot bypass that: an unpaid sale is refused with
 * a 409 no matter what the screen believes.
 *
 * The fallback member code and QR token are shown exactly once here. Only
 * their hashes are stored, so they cannot be displayed again.
 */
export function BusinessActivationQueuePage() {
  const client = useQueryClient();
  const queue = useQuery({
    queryKey: businessKeys.activationQueue,
    queryFn: getActivationQueue,
    // Keep the previous page on screen while the next poll lands: refetches
    // then feel instant and the skeleton only ever appears on first load.
    placeholderData: keepPreviousData,
    // Activations and payments land from other sessions: poll the queue
    // (same-session writes invalidate instantly).
    refetchInterval: 15_000,
  });
  const [search, setSearch] = useState('');
  const settled = useDebouncedValue(search.trim());
  const [eligibility, setEligibility] = useState<'all' | 'eligible' | 'not'>('all');
  const [activating, setActivating] = useState<FinanceQueueItem | null>(null);
  const [result, setResult] = useState<ActivationResult | null>(null);

  const rows = useMemo(() => queue.data ?? [], [queue.data]);
  // Headline counts from the loaded rows.
  const summary = useMemo(() => {
    const eligible = rows.filter((item) => item.activatable).length;
    return { total: rows.length, eligible, notEligible: rows.length - eligible };
  }, [rows]);
  // Client-side search and eligibility filter over the loaded queue rows.
  const visible = useMemo(() => {
    const term = settled.toLowerCase();
    return rows.filter((item) => {
      if (eligibility === 'eligible' && !item.activatable) return false;
      if (eligibility === 'not' && item.activatable) return false;
      if (!term) return true;
      return [item.saleNumber, item.customerName, item.productName]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(term));
    });
  }, [rows, settled, eligibility]);

  const openActivate = (item: FinanceQueueItem) => {
    if (!item.activatable) return;
    setActivating(item);
    setResult(null);
  };
  const onRowKeyDown = (event: KeyboardEvent, item: FinanceQueueItem) => {
    if ((event.target as HTMLElement).closest('[data-row-actions]')) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openActivate(item);
    }
  };

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: businessKeys.activationQueue });
    // Activation changes what member lookup, memberships and the activation
    // report show: refresh them in this session without reload.
    await client.invalidateQueries({ queryKey: sharedScopes.memberLookup });
    await client.invalidateQueries({ queryKey: sharedScopes.memberships });
    await client.invalidateQueries({ queryKey: sharedScopes.reports });
    // The activated sale is no longer pending activation, and its commission
    // moves on to qualification in Commissions.
    await client.invalidateQueries({ queryKey: businessKeys.commissionsScope });
  };

  // First load skeletonizes the whole page: header, summary, filters and
  // table. Refetches keep the previous page visible via placeholderData and
  // never reach this branch.
  if (queue.isPending)
    return (
      <section className={styles.page}>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading activation queue"
        >
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 240 }} />
            <Skeleton style={{ height: 16, maxWidth: 360 }} />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Skeleton style={{ height: 40, flex: '1 1 200px', maxWidth: 420 }} />
            <Skeleton style={{ height: 40, width: 160 }} />
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
          </div>
        </div>
      </section>
    );

  return (
    <section className={styles.page}>
      <PageHeader title="Activation Queue" description="Fully paid sales awaiting activation" />

      {queue.isError ? (
        <ErrorState error={queue.error} onRetry={queue.refetch} />
      ) : (
        <>
          <ul className={styles.summary} aria-label="Activation summary">
            <li>
              <MetricCard
                label="Ready to activate"
                value={formatCountOrDash(summary.eligible)}
                icon="check"
                description="Fully paid and ready to activate"
              />
            </li>
            <li>
              <MetricCard
                label="Still short"
                value={formatCountOrDash(summary.notEligible)}
                icon="clock"
                description="Still short of the frozen total"
              />
            </li>
            <li>
              <MetricCard
                label="Queue records"
                value={formatCountOrDash(summary.total)}
                icon="file-text"
                description="Sales pending activation review"
              />
            </li>
          </ul>

          <FilterBar
            filtersToggleLabel="Expand Filters"
            search={
              <SearchField
                label="Search activation queue"
                placeholder="Sale number, customer, or card"
                value={search}
                onChange={(value) => setSearch(value)}
                busy={queue.isFetching}
              />
            }
            filters={
              <label className={styles.filterLabel}>
                Eligibility
                <Select
                  aria-label="Filter by eligibility"
                  value={eligibility}
                  onChange={(e) => setEligibility(e.target.value as typeof eligibility)}
                  options={[
                    { value: 'all', label: 'All records' },
                    { value: 'eligible', label: 'Eligible only' },
                    { value: 'not', label: 'Not eligible' },
                  ]}
                />
              </label>
            }
            actions={
              <p className={styles.resultCount}>
                {settled || eligibility !== 'all'
                  ? `${formatCountOrDash(visible.length)} of ${formatCountOrDash(summary.total)} records`
                  : `${formatCountOrDash(visible.length)} records`}
              </p>
            }
          />

          {visible.length === 0 ? (
            <EmptyState
              title={
                settled || eligibility !== 'all' ? 'No matching records.' : 'Nothing to activate'
              }
              description="No application is fully paid yet."
            />
          ) : (
            <div
              role="region"
              aria-label="Scrollable records"
              tabIndex={0}
              className={`table-scroll ${styles.tableWrap} ${styles.queueCard}`}
            >
              <table className={styles.queueTable}>
                <thead>
                  <tr>
                    <th>Sale</th>
                    <th>Customer</th>
                    <th>Plan</th>
                    <th>Scheme</th>
                    <th>Total</th>
                    <th>Verified</th>
                    <th>Balance</th>
                    <th>Validity</th>
                    <th>First verified</th>
                    <th>Spot cash</th>
                    <th>Deadline</th>
                    <th>Ready</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => (
                    <tr
                      key={item.saleId}
                      tabIndex={0}
                      role="link"
                      aria-label={`Activate membership for ${item.saleNumber}`}
                      onClick={() => openActivate(item)}
                      onKeyDown={(event) => onRowKeyDown(event, item)}
                      className={styles.clickable}
                    >
                      <td data-label="Sale">
                        <span className={styles.recordRef}>
                          <span className={styles.recordRefDot} aria-hidden="true" />
                          {item.saleNumber}
                        </span>
                      </td>
                      <td data-label="Customer">{item.customerName}</td>
                      <td data-label="Plan">
                        <TierBadge tier={tierFromProductName(item.productName)} />
                      </td>
                      <td data-label="Scheme">{paymentSchemeLabel(item.paymentScheme)}</td>
                      <td data-label="Total" className={styles.numeric}>
                        {formatMoneyOrDash(item.cashPrice)}
                      </td>
                      <td data-label="Verified" className={styles.numeric}>
                        {formatMoneyOrDash(item.verifiedTotal)}
                      </td>
                      <td data-label="Balance" className={styles.numeric}>
                        {formatMoneyOrDash(item.remainingBalance)}
                      </td>
                      <td data-label="Validity">
                        {item.validityMonths
                          ? `${item.validityMonths} mo${item.validityMonths % 12 === 0 ? ` (${item.validityMonths / 12}y)` : ''}`
                          : '—'}
                      </td>
                      <td data-label="First verified">
                        {item.firstVerifiedPayment
                          ? formatDateTime(item.firstVerifiedPayment)
                          : '—'}
                      </td>
                      <td data-label="Spot cash">
                        <StatusChip
                          label={SPOT_CASH_LABEL[item.spotCashState] ?? item.spotCashState}
                          tone={SPOT_CASH_TONE[item.spotCashState] ?? 'neutral'}
                        />
                      </td>
                      <td data-label="Deadline">
                        {item.spotCashDeadline ? formatDateTime(item.spotCashDeadline) : '—'}
                      </td>
                      <td data-label="Ready">
                        <StatusChip
                          label={item.activatable ? 'Eligible' : 'Not eligible'}
                          tone={item.activatable ? 'success' : 'warning'}
                        />
                      </td>
                      <td
                        data-label="Actions"
                        data-row-actions
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
                        }}
                      >
                        <Button
                          size="sm"
                          disabled={!item.activatable}
                          onClick={() => openActivate(item)}
                        >
                          Activate
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {activating ? (
        <ActivateDialog
          item={activating}
          onClose={() => setActivating(null)}
          onDone={async (activation) => {
            setResult(activation);
            await refresh();
            notifySuccess({
              title: activation.alreadyActive ? 'Already Activated' : 'Membership Activated',
              message: activation.alreadyActive
                ? 'This sale was already active, so nothing new was created.'
                : 'The activation queue and membership records are now up to date.',
              detail: `Membership: ${activation.membershipNumber}\nPoints allocated: ${activation.pointsAllocated}`,
            });
          }}
        />
      ) : null}
      {result ? <IdentifiersDialog result={result} onClose={() => setResult(null)} /> : null}
    </section>
  );
}

function ActivateDialog({
  item,
  onClose,
  onDone,
}: {
  item: FinanceQueueItem;
  onClose: () => void;
  onDone: (result: ActivationResult) => Promise<void>;
}) {
  // VIP Stage 1: new sales carry a frozen validity and the server prefers it;
  // the field is shown read-only. Pre-scheme sales (no snapshot) keep the
  // editable 12-month default.
  const frozen = item.validityMonths;
  const [months, setMonths] = useState(frozen ? String(frozen) : '12');
  const activate = useBusinessMutation({
    mutationFn: () => activateSale(item.saleId, Number(months)),
    onSuccess: onDone,
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Activate membership"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={activate.isPending} onClick={() => activate.mutate()}>
            Activate
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <p>
          The server recomputes the verified total inside the transaction. If it does not reach the
          snapshotted price, the activation is refused and nothing is created.
        </p>
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 8,
            margin: 0,
          }}
        >
          <div>
            <dt>Scheme</dt>
            <dd>{paymentSchemeLabel(item.paymentScheme)}</dd>
          </div>
          <div>
            <dt>Frozen total</dt>
            <dd>{formatMoneyOrDash(item.cashPrice)}</dd>
          </div>
        </dl>
        {frozen ? (
          <p>
            Membership validity: <strong>{frozen} months</strong>
            {frozen % 12 === 0 ? ` (${frozen / 12} years)` : ''}, frozen from the sale.
          </p>
        ) : (
          <TextField
            id="activation-validity-months"
            name="validityMonths"
            label="Validity (months)"
            optional
            inputMode="numeric"
            value={months}
            onChange={(value) => setMonths(value.replace(/\D/g, ''))}
          />
        )}
        {activate.error ? <p role="alert">{activate.error.message}</p> : null}
      </div>
    </Dialog>
  );
}

export function IdentifiersDialog({
  result,
  onClose,
}: {
  result: ActivationResult;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<'token' | 'link' | null>(null);
  const [copyError, setCopyError] = useState(false);

  const copy = async (kind: 'token' | 'link', value: string) => {
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
    } catch {
      setCopyError(true);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={result.alreadyActive ? 'Already activated' : 'Membership activated'}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <p>
          Membership <strong>{result.membershipNumber}</strong> is active with{' '}
          {formatCountOrDash(result.pointsAllocated)} yearly points allocated.
        </p>
        {result.fallbackCode ? (
          <p>
            Fallback member code: <code>{result.fallbackCode}</code>
          </p>
        ) : null}
        {result.qrToken ? (
          <p>
            QR token: <code style={{ wordBreak: 'break-all' }}>{result.qrToken}</code>
          </p>
        ) : null}
        {result.alreadyActive ? (
          <p>
            This membership was already active, so no new identifiers or onboarding token were
            issued. If the customer already created a sign-in, direct them to{' '}
            <a href="/customer/forgot-password">Forgot Password</a>.
          </p>
        ) : (
          <p>
            <strong>Shown once.</strong> Only hashes of these identifiers are stored, so they cannot
            be displayed again. Hand them to the member now; a replacement can be issued if lost.
          </p>
        )}

        {!result.alreadyActive && result.onboarding.status === 'email_sent' ? (
          <p role="status">
            The customer activation email was accepted by the configured mail server. Keep the
            one-time fallback below until the customer confirms receipt.
          </p>
        ) : null}
        {!result.alreadyActive && result.onboarding.status === 'manual_required' ? (
          <p role="alert">
            <strong>Membership activation succeeded, but email delivery failed.</strong> Give the
            customer the one-time activation code or secure link below now.
          </p>
        ) : null}
        {!result.alreadyActive && result.onboarding.status === 'not_issued' ? (
          <p role="alert">
            <strong>Membership activation succeeded, but no onboarding code was issued.</strong> Do
            not activate the sale again. Contact an administrator to issue a customer onboarding
            token through the authorized customer workflow.
          </p>
        ) : null}

        {result.onboarding.token ? (
          <div style={{ display: 'grid', gap: 6 }}>
            <TextField
              id="customer-onboarding-token"
              name="onboardingToken"
              label="Customer activation code"
              value={result.onboarding.token}
              onChange={() => {}}
              readOnly
            />
            <Button variant="secondary" onClick={() => copy('token', result.onboarding.token!)}>
              {copied === 'token' ? 'Activation code copied' : 'Copy activation code'}
            </Button>
          </div>
        ) : null}
        {result.onboarding.activationUrl ? (
          <div style={{ display: 'grid', gap: 6 }}>
            <TextField
              id="customer-activation-link"
              name="activationLink"
              label="Customer activation link"
              value={result.onboarding.activationUrl}
              onChange={() => {}}
              readOnly
            />
            <Button
              variant="secondary"
              onClick={() => copy('link', result.onboarding.activationUrl!)}
            >
              {copied === 'link' ? 'Activation link copied' : 'Copy activation link'}
            </Button>
          </div>
        ) : null}
        {result.onboarding.expiresAt ? (
          <p>The customer activation code expires {formatDateTime(result.onboarding.expiresAt)}.</p>
        ) : null}
        {copyError ? (
          <p role="alert">Copy failed. Select the code or link manually before closing.</p>
        ) : null}
        {result.onboarding.token ? (
          <p>
            <strong>Shown once.</strong> Closing this dialog removes the plaintext onboarding code
            from this screen. It is never stored in readable form and cannot be retrieved later.
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
