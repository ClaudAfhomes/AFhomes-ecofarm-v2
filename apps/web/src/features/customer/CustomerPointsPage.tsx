import { CustomerRefundHistory } from './CustomerRefundHistory';
import { PointRedemptionApprovals } from './PointRedemptionApprovals';
import { useRef, useState } from 'react';

import {
  Button,
  EmptyState,
  ErrorState,
  Skeleton,
  Select,
  notifyConfirm,
  notifySuccess,
  useQrScanner,
} from '@afhomes/ui';
import { useMutation } from '@tanstack/react-query';
import { previewEarningClaim } from './services';

import {
  useClaimEarningPoints,
  useCustomerLedgerQuery,
  useCustomerPointsPositionQuery,
} from './queries';
import { claimErrorMessage, isForbidden } from './http';
import {
  ActivityList,
  ActivityRow,
  Field,
  FieldList,
  formatDate,
  humanEntryType,
  isNoCard,
  styles,
  ui,
  type ActivityRowProps,
} from './portal-ui';
import { MoneyPanel } from './MoneyPanel';
import money from './money.module.css';

const num = (value: number) => value.toLocaleString('en-PH');

/** Icon and tint for a ledger entry type. Display only. */
function entryVisual(entryType: string): Pick<ActivityRowProps, 'icon' | 'tone'> {
  switch (entryType) {
    case 'earned':
    case 'promotional_bonus':
      return { icon: 'star', tone: 'success' };
    case 'annual_allocation':
    case 'annual_reset':
    case 'cutover_baseline':
      return { icon: 'calendar', tone: 'neutral' };
    case 'redemption':
      return { icon: 'card', tone: 'neutral' };
    case 'reversal':
    case 'expiration':
      return { icon: 'alert', tone: 'warning' };
    default:
      return { icon: 'pencil', tone: 'neutral' };
  }
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className={money.row}>
      <dt className={money.rowLabel}>{label}</dt>
      <dd className={`${money.rowValue} ${strong ? money.rowValueStrong : ''}`}>{value}</dd>
    </div>
  );
}

/**
 * A scanned claim lands here as `/customer/points?c=<credential>`.
 *
 * The parameter is read once on mount and then REMOVED from the address bar, so
 * the token does not sit in browser history, in a shared link, or in a screenshot
 * of the URL bar. It is not logged and never sent anywhere except in a POST body,
 * where it cannot end up in a query string on an access log. The member can still
 * read it - it is prefilled - they just cannot leak it by accident afterwards.
 */
function readClaimFromUrl(): string {
  if (typeof window === 'undefined') return '';
  try {
    const token = new URLSearchParams(window.location.search).get('c') ?? '';
    if (token) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    return token;
  } catch {
    // A malformed or hostile URL is treated as "no code": the member can type
    // one, and nothing is trusted from the address bar regardless.
    return '';
  }
}

export function CustomerPointsPage() {
  const summary = useCustomerPointsPositionQuery();
  const ledger = useCustomerLedgerQuery();
  const claim = useClaimEarningPoints();
  const [credential, setCredential] = useState(readClaimFromUrl);
  const [camera, setCamera] = useState<'environment' | 'user'>('environment');
  const [confirming, setConfirming] = useState(false);
  const confirmingRef = useRef(false);
  const preview = useMutation({ mutationFn: previewEarningClaim, retry: false });
  // Destructured, not read off a `scanner` object: react-hooks/refs treats a
  // property read on a hook-returned object as a ref access during render.
  const {
    status: scanStatus,
    message: scanMessage,
    start: startScan,
    stop: stopScan,
    videoRef: scanVideoRef,
  } = useQrScanner((value) => {
    setCredential(value);
    preview.mutate({ token: value });
  });
  const reviewed = preview.variables?.token === credential.trim() ? preview.data : undefined;
  const busy = confirming || claim.isPending;
  // A member's own balance, capacity and debt are three DIFFERENT numbers and are
  // shown as three: spendable points are not remaining annual earning capacity,
  // and outstanding reversal debt is neither of them.
  //
  // The balance card reports its own loading and failure states INLINE. An early
  // return here would hide the scanner and the typed-code field exactly when a
  // member holding a claim code needs them most; the claim flow never reads the
  // balance card, so it stays usable while the balance is unknown. No figure is
  // ever invented: while the balance is unknown, none is shown.

  const submit = async () => {
    const token = credential.trim();
    // Guarded here as well as by the disabled button: a duplicate submit would be
    // a second claim attempt against a single-use credential, and the server
    // would answer "already used" for a request that had already succeeded.
    if (!token || claim.isPending || confirmingRef.current || preview.isPending || !reviewed)
      return;
    confirmingRef.current = true;
    setConfirming(true);
    stopScan();
    try {
      if (
        !(await notifyConfirm({
          title: 'Claim these purchase points?',
          message: `${reviewed.claimNumber}: points are credited once to your account. The final award is checked against your earning limit.`,
          confirmButtonText: 'Claim my points',
        }))
      )
        return;
      await claim.mutateAsync({ token });
      setCredential('');
      preview.reset();
      notifySuccess({ title: 'Points claimed' });
    } catch {
      // The mutation retains the error beside the reviewed claim.
    } finally {
      confirmingRef.current = false;
      setConfirming(false);
    }
  };

  const position = !summary.isLoading && !summary.isError ? summary.data : undefined;

  return (
    <>
      <MoneyPanel title="Your points">
        {isNoCard(summary) ? (
          // A 404 is the normal "no active membership" answer, not a failure: no
          // retry button and no error wording, and shown without waiting on retries.
          <EmptyState
            title="No active card yet"
            description="Your points appear here once you have an active membership."
          />
        ) : summary.isLoading ? (
          <div role="status" aria-label="Loading your points" aria-busy="true">
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        ) : summary.isError || !position ? (
          <ErrorState
            title="Points unavailable"
            message={
              isForbidden(summary.error)
                ? 'Your account is not active, so points are not available. Contact AFhomes Ecofarm to restore access.'
                : 'We could not load your points. You can still review and claim a purchase code below — your balance will appear here once it loads.'
            }
            onRetry={summary.refetch}
          />
        ) : (
          <>
            <div className={money.hero}>
              <p className={ui.sectionLabel}>Available points</p>
              <p className={money.heroValue}>{num(position.spendable)}</p>
              <p className={money.heroCaption}>points you can spend right now</p>
            </div>

            {/* The measures stay separate: what is on the card, what is held against a
                reversal, and what can be spent. Never merged into one total. */}
            <dl className={money.rows}>
              <Row label="On your card" value={num(position.balance)} />
              {position.reversalDebt > 0 && (
                <Row label="Held for a reversal" value={num(position.reversalDebt)} />
              )}
              <Row label="Available to spend" value={num(position.spendable)} strong />
            </dl>

            {position.reversalDebt > 0 && (
              <p
                className={`${styles.notice} ${styles.noticeWarning} ${money.notice}`}
                role="alert"
              >
                {num(position.reversalDebt)} points are held against a reversed purchase, so{' '}
                {num(Math.max(position.balance - position.reversalDebt, 0))} points remain after
                that correction. Future earnings repay any outstanding reversal debt first.
              </p>
            )}

            {/* Spending capacity is a ceiling on future earnings, not money: a member
                who has reached their annual limit sees 0 here while their spendable
                balance stays healthy. */}
            <p className={`${ui.sectionLabel} ${money.groupLabel}`}>Spendable by day</p>
            <dl className={money.rows}>
              <Row
                label="Weekday points (Monday–Friday)"
                value={position.weekdaySpendable?.toLocaleString('en-PH') ?? 'Unavailable'}
              />
              <Row
                label="Weekend points (Saturday–Sunday)"
                value={position.weekendSpendable?.toLocaleString('en-PH') ?? 'Unavailable'}
              />
            </dl>

            <p className={`${ui.sectionLabel} ${money.groupLabel}`}>This year</p>
            <dl className={money.rows}>
              <Row
                label="Can still earn this year"
                value={num(position.remainingEarningCapacity)}
              />
              <Row label="Annual limit" value={num(position.annualCap)} />
              <Row
                label="Tier"
                value={position.tier.charAt(0) + position.tier.slice(1).toLowerCase()}
              />
              <Row
                label="Year"
                value={`${formatDate(position.periodStart)} to ${formatDate(position.periodEnd)}`}
              />
            </dl>

            <p className={`${ui.muted} ${money.notice}`}>
              Points accumulate from eligible paid purchases. Claim each purchase code in your own
              account.
            </p>
          </>
        )}
      </MoneyPanel>

      <MoneyPanel title="Claim points from a purchase">
        <div className={money.stack}>
          <p className={ui.muted}>
            When AFhomes Ecofarm records a purchase for you, you get a claim code. Enter it here or
            scan its QR, review the purchase, then confirm to add the points to your card.
          </p>
          <label className={styles.selectLabel}>
            Camera
            <Select
              value={camera}
              onChange={(event) => {
                stopScan();
                setCamera(event.target.value === 'user' ? 'user' : 'environment');
              }}
              options={[
                { value: 'environment', label: 'Rear camera' },
                { value: 'user', label: 'Front camera' },
              ]}
            />
          </label>
          {/*
          Camera states are named out loud rather than implied by a video element.
          A member who cannot tell "the camera never opened" from "it is working"
          either waits forever or gives up, so each state gets its own sentence:
          opening, ready, detected, denied, unavailable, failed.
        */}
          <Button
            variant="secondary"
            loading={scanStatus === 'requesting'}
            loadingLabel="Opening the camera…"
            disabled={busy || preview.isPending}
            onClick={() => startScan(camera)}
          >
            Scan claim QR
          </Button>
          {['requesting', 'scanning'].includes(scanStatus) && (
            <>
              <video
                ref={scanVideoRef}
                autoPlay
                muted
                playsInline
                aria-label="Claim QR camera preview"
                className={money.video}
              />
              <Button variant="secondary" onClick={stopScan}>
                Cancel camera
              </Button>
            </>
          )}
          {scanStatus === 'scanning' && (
            <p role="status">Camera ready. Point it at the claim QR shown by AFhomes.</p>
          )}
          {scanMessage && <p role="status">{scanMessage}</p>}
          <label className={ui.sectionLabel} htmlFor="claim-credential">
            Claim code
          </label>
          <input
            id="claim-credential"
            className={styles.claimInput}
            value={credential}
            onChange={(event) => {
              setCredential(event.target.value);
              preview.reset();
              claim.reset();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && credential.trim() && !busy && !preview.isPending)
                preview.mutate({ token: credential.trim() });
            }}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
          <Button
            onClick={() => {
              stopScan();
              preview.mutate({ token: credential.trim() });
            }}
            loading={preview.isPending}
            disabled={busy || !credential.trim()}
          >
            Review claim
          </Button>
          {preview.isError && <p role="alert">{claimErrorMessage(preview.error)}</p>}
          {reviewed && (
            <section aria-label="Review purchase claim" className={money.reviewed}>
              {/* "Scan detected" is its own state: a member must be able to tell a
                decoded QR from a typed code, and must know the scan alone credited
                nothing. */}
              <p role="status">
                Claim code read. Review the purchase below, then confirm to add the points.
              </p>
              <FieldList>
                <Field label="Claim" value={reviewed.claimNumber} />
                <Field label="Purchase" value={reviewed.purchaseNumber ?? 'Service purchase'} />
                <Field label="Service" value={reviewed.serviceName ?? 'Eligible service'} />
                <Field
                  label="Requested points"
                  value={reviewed.pointsRequested.toLocaleString('en-PH')}
                />
                <Field
                  label="Reserved points"
                  value={reviewed.pointsReserved.toLocaleString('en-PH')}
                />
                <Field
                  label="Capped points"
                  value={reviewed.pointsCapped.toLocaleString('en-PH')}
                />
                <Field label="Expires" value={formatDate(reviewed.expiresAt)} />
              </FieldList>
              <p>
                The final award is checked when you confirm. Scanning and reviewing do not credit
                points.
              </p>
              {/* `loading` covers the whole confirm-to-credit sequence: the
                confirmation dialog, the request, and the wait. The label names the
                action so the member is not left guessing whether it worked. */}
              <Button
                onClick={() => void submit()}
                loading={busy}
                loadingLabel="Claiming your points…"
                disabled={preview.isPending}
              >
                Claim my points
              </Button>
            </section>
          )}
          {/* The pending state is announced, not just drawn: a screen-reader user
            otherwise gets silence for the length of the request. */}
          {/* A code that arrived by scan is prefilled; saying so explains why the
            field already has something in it. */}
          {credential && !claim.isSuccess && (
            <p className={styles.notice} role="status">
              Review your claim code before confirming the points.
            </p>
          )}
          <p role="status" aria-live="polite" className={money.live}>
            {claim.isPending ? 'Claiming your points…' : ''}
          </p>
          {claim.isError && (
            <p className={`${styles.notice} ${styles.noticeWarning}`} role="alert">
              {claimErrorMessage(claim.error)}
            </p>
          )}
          {claim.isSuccess && (
            <p className={styles.notice} role="status">
              {claim.data.pointsAwarded.toLocaleString('en-PH')} points added. Your balance is now{' '}
              {claim.data.balanceAfter.toLocaleString('en-PH')}
              {claim.data.pointsCapped > 0
                ? `. ${claim.data.pointsCapped.toLocaleString('en-PH')} points were not added because you reached this year's earning limit for your tier.`
                : '.'}
            </p>
          )}
        </div>
      </MoneyPanel>

      <PointRedemptionApprovals />
      <CustomerRefundHistory />
      <MoneyPanel title="Points activity">
        {/* A skeleton reserves roughly the height the rows will occupy, so the card
            does not jump when they arrive. */}
        {ledger.isLoading && !isNoCard(ledger) && (
          <div role="status" aria-label="Loading your points activity" aria-busy="true">
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        )}
        {isNoCard(ledger) && (
          <p className={styles.notice}>
            Points activity appears here once your membership is active.
          </p>
        )}
        {ledger.isError && !isNoCard(ledger) && (
          <p className={styles.notice}>Your points activity is not available right now.</p>
        )}
        {ledger.data && ledger.data.length === 0 && (
          <p className={styles.notice}>No points activity yet.</p>
        )}
        {ledger.data && ledger.data.length > 0 && (
          <ActivityList label="Points activity">
            {ledger.data.map((entry) => {
              const typeLabel = humanEntryType(entry.entryType);
              // For a redemption the member sees WHAT they spent points on (the joined
              // item name), not an internal reason string. With no description the
              // type label leads the row instead.
              const description = entry.itemName ?? entry.reason ?? null;
              const reference = entry.referenceNumber ?? entry.redemptionNumber;
              return (
                <ActivityRow
                  key={entry.id}
                  {...entryVisual(entry.entryType)}
                  title={description ?? typeLabel}
                  meta={
                    <>
                      {description ? (
                        <>
                          <span>{typeLabel}</span>
                          {' · '}
                        </>
                      ) : null}
                      <time dateTime={entry.occurredAt}>{formatDate(entry.occurredAt)}</time>
                      {reference ? (
                        <>
                          {' · '}
                          <span className={money.mono}>{reference}</span>
                        </>
                      ) : null}
                    </>
                  }
                  amount={num(Math.abs(entry.amount))}
                  direction={entry.amount >= 0 ? 'credit' : 'debit'}
                  status={
                    <span className={money.balanceAfter}>
                      Balance after {num(entry.balanceAfter)}
                    </span>
                  }
                />
              );
            })}
          </ActivityList>
        )}
        {ledger.data && ledger.data.length > 0 && (
          <p className={`${ui.muted} ${money.footnote}`}>
            Showing {ledger.data.length} entries on this page.
          </p>
        )}
        <nav className={money.pager} aria-label="Points history pages">
          <Button
            variant="secondary"
            disabled={!ledger.hasPrevious || ledger.isFetching}
            onClick={ledger.previousPage}
          >
            Newer activity
          </Button>
          <Button
            variant="secondary"
            disabled={!ledger.hasNext || ledger.isFetching}
            onClick={ledger.nextPage}
          >
            Older activity
          </Button>
        </nav>
      </MoneyPanel>
    </>
  );
}
