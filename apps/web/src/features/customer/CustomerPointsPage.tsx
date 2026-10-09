import { useState } from 'react';

import { Button, ErrorState } from '@afhomes/ui';

import { useClaimEarningPoints, useCustomerLedgerQuery, useCustomerPointsPositionQuery } from './queries';
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
  // A member's own balance, capacity and debt are three DIFFERENT numbers and are
  // shown as three: spendable points are not remaining annual earning capacity,
  // and outstanding reversal debt is neither of them.

  const submit = () => {
    const token = credential.trim();
    // Guarded here as well as by the disabled button: a duplicate submit would be
    // a second claim attempt against a single-use credential, and the server
    // would answer "already used" for a request that had already succeeded.
    if (!token || claim.isPending) return;
    claim.mutate(
      { token },
      { onSuccess: () => setCredential('') },
    );
  };

  if (summary.isLoading) return <p role="status">Loading your points…</p>;
  if (summary.isError) {
    return (
      <ErrorState
        title="Points unavailable"
        message={
          isForbidden(summary.error)
            ? 'Your account is not active, so points are not available. Contact AF Homes Ecofarm to restore access.'
            : 'We could not load your points. Please try again in a moment.'
        }
      />
    );
  }

  const entries = ledger.data ?? [];
  const hasRedemptions = entries.some((entry) => entry.entryType === 'redemption');

  return (
    <>
      <Card title="Your points">
        <p className={styles.balance}>{summary.data!.spendable.toLocaleString('en-PH')}</p>
        <p className={styles.balanceCaption}>points available to spend right now</p>
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
          <Field
            label="Annual limit"
            value={summary.data!.annualCap.toLocaleString('en-PH')}
          />
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
            purchase, so {Math.max(summary.data!.balance - summary.data!.reversalDebt, 0).toLocaleString('en-PH')}{' '}
            of your balance can be spent until that is cleared. Earning is not affected.
          </p>
        )}

        <p className={styles.notice}>
          Points accumulate from eligible purchases. Spending them is handled by AF Homes Ecofarm
          staff at any branch or desk that offers a redemption, and applies to accommodation and
          staycation unless a current promotion says otherwise.
        </p>
      </Card>

      <Card title="Claim points from a purchase">
        <p className={styles.notice}>
          When AF Homes Ecofarm records a purchase for you, you get a claim code. Enter it
          here - or scan its QR at any branch desk - to add the points to your card.
        </p>
        <label className={styles.fieldLabel} htmlFor="claim-credential">
          Claim code
        </label>
        <input
          id="claim-credential"
          className={styles.claimInput}
          value={credential}
          onChange={(event) => setCredential(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
          autoComplete="off"
          spellCheck={false}
          disabled={claim.isPending}
        />
        <Button onClick={submit} disabled={claim.isPending || !credential.trim()}>
          {claim.isPending ? 'Claiming your points…' : 'Claim my points'}
        </Button>
        {/* The pending state is announced, not just drawn: a screen-reader user
            otherwise gets silence for the length of the request. */}
        {/* A code that arrived by scan is prefilled; saying so explains why the
            field already has something in it. */}
        {credential && !claim.isSuccess && (
          <p className={styles.notice} role="status">
            We found your claim code. Check it and choose Claim my points to add them.
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
        )}
        {ledger.data && ledger.data.length > 0 && (
          <p className={styles.notice}>
            Showing the most recent {ledger.data.length} entries.
          </p>
        )}
      </Card>
    </>
  );
}
