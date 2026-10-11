import { useRef, useState } from 'react';

import {
  Button,
  ErrorState,
  Skeleton,
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
import { Card, Field, FieldList, formatDate, humanEntryType, styles } from './portal-ui';

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

  if (summary.isLoading)
    return (
      <div role="status" aria-label="Loading your points" aria-busy="true">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    );
  if (summary.isError) {
    return (
      <ErrorState
        title="Points unavailable"
        message={
          isForbidden(summary.error)
            ? 'Your account is not active, so points are not available. Contact AF Homes Ecofarm to restore access.'
            : 'We could not load your points. Please try again in a moment.'
        }
        onRetry={summary.refetch}
      />
    );
  }

  const entries = ledger.data ?? [];
  const hasRedemptions = entries.some((entry) => entry.entryType === 'redemption');

  return (
    <>
      <Card title="Your points">
        <p className={styles.balance}>{summary.data!.balance.toLocaleString('en-PH')}</p>
        <p className={styles.balanceCaption}>points accumulated on your card</p>
        <FieldList>
          {/* THREE different numbers. Spending capacity is a ceiling on future
              earnings, not money: a member who has reached their annual limit sees
              0 here while their spendable balance stays healthy. */}
          <Field
            label="Points on your card"
            value={summary.data!.balance.toLocaleString('en-PH')}
          />
          <Field
            label="Can still earn this year"
            value={summary.data!.remainingEarningCapacity.toLocaleString('en-PH')}
          />
          <Field label="Annual limit" value={summary.data!.annualCap.toLocaleString('en-PH')} />
          <Field
            label="Tier"
            value={summary.data!.tier.charAt(0) + summary.data!.tier.slice(1).toLowerCase()}
          />
          <Field
            label="Year"
            value={`${formatDate(summary.data!.periodStart)} to ${formatDate(summary.data!.periodEnd)}`}
          />
        </FieldList>

        {summary.data!.reversalDebt > 0 && (
          <p className={`${styles.notice} ${styles.noticeWarning}`} role="alert">
            {summary.data!.reversalDebt.toLocaleString('en-PH')} points are held against a reversed
            purchase, so{' '}
            {Math.max(summary.data!.balance - summary.data!.reversalDebt, 0).toLocaleString(
              'en-PH',
            )}{' '}
            points remain after that correction. Future earnings repay any outstanding reversal debt
            first.
          </p>
        )}

        <p className={styles.notice}>
          Points accumulate from eligible paid purchases. Claim each purchase code in your own
          account.
        </p>
      </Card>

      <Card title="Claim points from a purchase">
        <p className={styles.notice}>
          When AF Homes Ecofarm records a purchase for you, you get a claim code. Enter it here or
          scan its QR, review the purchase, then confirm to add the points to your card.
        </p>
        <label>
          Camera
          <select
            value={camera}
            onChange={(event) => {
              stopScan();
              setCamera(event.target.value === 'user' ? 'user' : 'environment');
            }}
          >
            <option value="environment">Rear camera</option>
            <option value="user">Front camera</option>
          </select>
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
              style={{ width: '100%', maxWidth: 480 }}
            />
            <Button variant="secondary" onClick={stopScan}>
              Cancel camera
            </Button>
          </>
        )}
        {scanStatus === 'scanning' && (
          <p role="status">Camera ready. Point it at the claim QR shown by AF Homes.</p>
        )}
        {scanMessage && <p role="status">{scanMessage}</p>}
        <label className={styles.fieldLabel} htmlFor="claim-credential">
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
          <section aria-label="Review purchase claim">
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
              <Field label="Capped points" value={reviewed.pointsCapped.toLocaleString('en-PH')} />
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
        <p role="status" aria-live="polite">
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
      </Card>

      <Card title="Points activity">
        {/* A Skeleton rather than a sentence: it reserves roughly the height the
            table will occupy, so the card does not jump when the rows arrive.
            The Skeleton is aria-hidden, so the region carries the announcement. */}
        {ledger.isLoading && (
          <div role="status" aria-label="Loading your points activity" aria-busy="true">
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        )}
        {ledger.isError && (
          <p className={styles.notice}>Your points activity is not available right now.</p>
        )}
        {ledger.data && ledger.data.length === 0 && (
          <p className={styles.notice}>No points activity yet.</p>
        )}
        {ledger.data && ledger.data.length > 0 && (
          // The same scroller the payments and redemptions tables use: the ledger
          // is five columns wide, which does not fit a 360px phone, and the
          // region is focusable so the overflow is reachable by keyboard.
          <div
            role="region"
            aria-label="Scrollable points activity"
            tabIndex={0}
            className={styles.tableScroll}
          >
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Type</th>
                  <th scope="col">Description</th>
                  {hasRedemptions && <th scope="col">Reference</th>}
                  <th scope="col" className={styles.numeric}>
                    Points
                  </th>
                  <th scope="col" className={styles.numeric}>
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {ledger.data.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDate(entry.occurredAt)}</td>
                    <td>{humanEntryType(entry.entryType)}</td>
                    {/* For a redemption the member sees WHAT they spent points on,
                        which is the joined item name, not an internal reason string. */}
                    <td>
                      {entry.itemName ??
                        (entry.quantity && entry.quantity > 1
                          ? `${entry.reason ?? humanEntryType(entry.entryType)}`
                          : (entry.reason ?? '—'))}
                    </td>
                    {hasRedemptions && (
                      <td className={styles.mono}>{entry.redemptionNumber ?? '—'}</td>
                    )}
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
          </div>
        )}
        {ledger.data && ledger.data.length > 0 && (
          <p className={styles.notice}>Showing the most recent {ledger.data.length} entries.</p>
        )}
      </Card>
    </>
  );
}
