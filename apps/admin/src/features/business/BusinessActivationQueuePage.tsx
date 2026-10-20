import { useMemo, useState, type KeyboardEvent } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  Pagination,
  SearchField,
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

/** Fixed queue page size: the table shows one page, the pager turns them. */
const PAGE_SIZE = 10;

export function BusinessActivationQueuePage() {
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const settled = useDebouncedValue(search.trim());
  const [eligibility, setEligibility] = useState<'all' | 'eligible' | 'not'>('all');
  const queue = useQuery({
    queryKey: businessKeys.activationQueue(settled),
    queryFn: () => getActivationQueue(settled),
    // Keep the previous page on screen while the next poll lands: refetches
    // then feel instant and the skeleton only ever appears on first load.
    placeholderData: keepPreviousData,
    // Activations and payments land from other sessions: poll the queue
    // (same-session writes invalidate instantly).
    refetchInterval: 15_000,
  });
  const [page, setPage] = useState(0);
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
  // A new search term or filter restarts at the first page. The settled term
  // only changes once the user stops typing, so turning pages never resets.
  const [prevSettled, setPrevSettled] = useState(settled);
  if (prevSettled !== settled) {
    setPrevSettled(settled);
    setPage(0);
  }
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  // A shrunken result (e.g. an activation elsewhere) can leave the page past
  // the last one. Correct during render on a page change (the documented
  // previous-value pattern, not an effect); display clamps meanwhile.
  const [prevPageCount, setPrevPageCount] = useState(pageCount);
  if (prevPageCount !== pageCount) {
    setPrevPageCount(pageCount);
    if (page > pageCount - 1) setPage(pageCount - 1);
  }
  const safePage = Math.min(page, pageCount - 1);
  const paged = visible.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

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
    await client.invalidateQueries({ queryKey: ['business', 'queue', 'activation'] });
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
          {/* Compact summary badges: counts only, no cards. Label + icon +
          tone on every badge, never color alone. */}
          <ul className={styles.badges} aria-label="Activation summary">
            <li>
              <StatusChip
                label={`Eligible: ${formatCountOrDash(summary.eligible)}`}
                tone="success"
                icon="check"
              />
            </li>
            <li>
              <StatusChip
                label={`Short: ${formatCountOrDash(summary.notEligible)}`}
                tone="warning"
                icon="clock"
              />
            </li>
            <li>
              <StatusChip
                label={`Total: ${formatCountOrDash(summary.total)}`}
                tone="neutral"
                icon="file-text"
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
              <div className={styles.filterGroup} role="group" aria-label="Filter by eligibility">
                {(['all', 'eligible', 'not'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={eligibility === value ? styles.filterChipActive : styles.filterChip}
                    onClick={() => {
                      setEligibility(value);
                      setPage(0);
                    }}
                    aria-pressed={eligibility === value}
                  >
                    {value === 'all' ? 'All records' : value === 'eligible' ? 'Eligible only' : 'Not eligible'}
                  </button>
                ))}
                {(search.trim() || eligibility !== 'all') ? (
                  <button
                    type="button"
                    className={styles.filterChip}
                    onClick={() => {
                      setSearch('');
                      setEligibility('all');
                      setPage(0);
                    }}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            }
          />

          {visible.length === 0 ? (
            <EmptyState
              title={
                settled || eligibility !== 'all'
                  ? 'No records match these filters.'
                  : 'Nothing to activate right now'
              }
              description={
                settled || eligibility !== 'all'
                  ? 'Try a different search term or eligibility filter.'
                  : 'No application is fully paid yet. Check back after payments are verified.'
              }
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
                    <th>Verified / Total</th>
                    <th>Ready</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((item) => (
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
                      <td data-label="Verified / Total" className={styles.numeric}>
                        {formatMoneyOrDash(item.verifiedTotal)} / {formatMoneyOrDash(item.cashPrice)}
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

          {pageCount > 1 ? (
            <div className={styles.pagination}>
              <Pagination
                page={safePage + 1}
                pageCount={pageCount}
                onChange={(next) => setPage(next - 1)}
                label="Activation queue pagination"
              />
            </div>
          ) : null}
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

  const verified = Number(item.verifiedTotal) || 0;
  const total = Number(item.cashPrice) || 0;
  const progress = total > 0 ? Math.min(100, (verified / total) * 100) : 0;
  const balance = Number(item.remainingBalance) || 0;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Activate membership"
      describedBy="activation-summary"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={activate.isPending}
            loading={activate.isPending}
            onClick={() => activate.mutate()}
          >
            Activate
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)' }}>
          {item.saleNumber} · {item.customerName} · {item.productName}
        </p>

        <div
          id="activation-summary"
          style={{
            display: 'grid',
            gap: 12,
            padding: 14,
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border-default)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
            <div>
              <dt style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)', fontWeight: 600 }}>Scheme</dt>
              <dd style={{ margin: '4px 0 0', fontWeight: 600 }}>{paymentSchemeLabel(item.paymentScheme)}</dd>
            </div>
            <div>
              <dt style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)', fontWeight: 600 }}>Frozen total</dt>
              <dd style={{ margin: '4px 0 0', fontWeight: 600 }}>{formatMoneyOrDash(item.cashPrice)}</dd>
            </div>
            <div>
              <dt style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)', fontWeight: 600 }}>Verified</dt>
              <dd style={{ margin: '4px 0 0', fontWeight: 600 }}>{formatMoneyOrDash(item.verifiedTotal)}</dd>
            </div>
            <div>
              <dt style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)', fontWeight: 600 }}>Balance due</dt>
              <dd style={{ margin: '4px 0 0', fontWeight: 700, color: balance > 0 ? 'var(--color-danger, #b91c1c)' : 'var(--color-success, #15803d)' }}>
                {formatMoneyOrDash(item.remainingBalance)}
              </dd>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--color-text-secondary)' }}>
              <span>Payment progress</span>
              <span>{progress.toFixed(0)}%</span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              style={{
                height: 8,
                borderRadius: 999,
                background: 'var(--color-bg-surface-raised, #e5e7eb)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${progress}%`,
                  height: '100%',
                  background: progress >= 100 ? 'var(--color-success, #15803d)' : 'var(--color-brand-primary, #2563eb)',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>
        </div>

        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)' }}>
          The server recomputes the verified total inside the transaction. If it does not reach the
          snapshotted price, the activation is refused and nothing is created.
        </p>

        {frozen ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              background: 'var(--color-brand-soft, #eff6ff)',
              border: '1px solid color-mix(in srgb, var(--color-brand-primary, #2563eb) 30%, white)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, color: 'var(--color-brand-primary, #2563eb)' }}>
              Validity locked
            </span>
            <span style={{ fontWeight: 600 }}>
              {frozen} months{frozen % 12 === 0 ? ` (${frozen / 12} years)` : ''}
            </span>
            <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>frozen from the sale</span>
          </div>
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

        {activate.error ? (
          <p role="alert" style={{ margin: 0, padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--radius-md)', color: '#b91c1c', fontSize: 13, fontWeight: 600 }}>
            {activate.error.message}
          </p>
        ) : null}
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
