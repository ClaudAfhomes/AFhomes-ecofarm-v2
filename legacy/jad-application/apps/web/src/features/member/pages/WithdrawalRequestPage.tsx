import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';

import { compareMoney, formatMoney, isExactDecimal, subtractMoney } from '@jad/shared';
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  notifySuccess,
} from '@jad/ui';

import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { ApiError } from '../../../lib/api/errors';
import { apiErrorMessage } from '../../../lib/api/errorMessage';
import { usePayoutAccounts, useWallet } from '../hooks/useMember';
import { usePublicConfig } from '../../public/hooks/usePublicConfig';
import { createWithdrawal, getWallet } from '../services/member';
import { SelectField } from '../../auth/components/SelectField';
import { TextField } from '../../auth/components/TextField';
import { payoutMethodLabel } from '../lib/presentation';
import styles from './WithdrawalRequestPage.module.css';

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;

/**
 * Request a withdrawal (SCR-MEM-012, FR-WDR-001..005). Requires at least one
 * verified payout account (BR-PAY-005) and a positive amount ≤ Available
 * Balance. Submission is irreversible - the amount is reserved immediately
 * (BR-WDR-001/002) - so it goes through a ConfirmDialog. `Idempotency-Key`
 * (API-SPECIFICATION §5.3) is held in state for the attempt and reused on retry;
 * the server remains authoritative for balance checks (409/422).
 */
export function WithdrawalRequestPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const walletQuery = useWallet();
  const accountsQuery = usePayoutAccounts();
  // Configured withdrawal bounds (MIN/MAX_WITHDRAWAL_AMOUNT via GET
  // /config/public). The DB function remains authoritative; these only
  // validate inline. Unknown until loaded - then the checks are skipped.
  const configQuery = usePublicConfig();
  const limits = configQuery.data?.withdrawalLimits;
  const [amount, setAmount] = useState('');
  const [payoutAccountId, setPayoutAccountId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | undefined>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => {
    try {
      const stored = sessionStorage.getItem('jad:withdrawal:idempotency');
      if (stored) return stored;
    } catch {
      // sessionStorage unavailable (SSR/test)
    }
    const fresh =
      typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `idem-${Date.now()}`;
    try {
      sessionStorage.setItem('jad:withdrawal:idempotency', fresh);
    } catch {
      // ignore
    }
    return fresh;
  });

  const verifiedAccounts = useMemo(
    () => (accountsQuery.data ?? []).filter((account) => account.status === 'CONFIRMED'),
    [accountsQuery.data],
  );

  const regenerateKey = () => {
    const fresh =
      typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `idem-${Date.now()}`;
    try {
      sessionStorage.setItem('jad:withdrawal:idempotency', fresh);
    } catch {
      // ignore
    }
    setIdempotencyKey(fresh);
  };

  const createMutation = useMutation({
    mutationFn: ({
      amount: mutationAmount,
      payoutAccountId: mutationAccountId,
    }: {
      amount: string;
      payoutAccountId: string;
    }) =>
      createWithdrawal(
        { amount: mutationAmount, payoutAccountId: mutationAccountId },
        idempotencyKey,
      ),
    onSuccess: (withdrawal) => {
      try {
        sessionStorage.removeItem('jad:withdrawal:idempotency');
      } catch {
        // ignore
      }
      regenerateKey();
      // Await the refetches so the destination page (detail + eWallet) shows
      // the server truth (deducted Available, raised Pending reservation).
      void (async () => {
        await Promise.allSettled([
          queryClient.invalidateQueries({ queryKey: ['member', 'wallet'] }),
          queryClient.invalidateQueries({ queryKey: ['member', 'withdrawals'] }),
          queryClient.invalidateQueries({ queryKey: ['member', 'ledger', 'page'] }),
        ]);
        notifySuccess({
          title: 'Withdrawal reserved',
          message: `${formatMoney(withdrawal.amount)} moved from Available to your reserved withdrawals.`,
        });
      })();
      navigate(`/member/withdrawals/${withdrawal.id}`, { replace: true });
    },
  });

  const balance = walletQuery.data?.availableBalance ?? '0.00';

  const onReview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!amount.trim()) nextErrors.amount = 'Enter an amount.';
    else if (!AMOUNT_RE.test(amount.trim()))
      nextErrors.amount = 'Enter a valid amount with up to two decimal places.';
    else if (compareMoney(amount.trim(), '0.00') <= 0)
      nextErrors.amount = 'Enter an amount greater than zero.';
    else if (limits && compareMoney(amount.trim(), limits.min) < 0)
      nextErrors.amount = `Enter at least ${formatMoney(limits.min)}.`;
    else if (compareMoney(amount.trim(), balance) > 0)
      nextErrors.amount = 'The amount exceeds your Available Balance.';
    else if (limits && compareMoney(amount.trim(), limits.max) > 0)
      nextErrors.amount = `Enter no more than ${formatMoney(limits.max)}.`;
    if (!payoutAccountId) nextErrors.payoutAccountId = 'Choose a verified payout account.';
    setErrors(nextErrors);
    if (nextErrors.amount) document.getElementById('withdrawal-amount')?.focus();
    else if (nextErrors.payoutAccountId)
      document.getElementById('withdrawal-payoutAccountId')?.focus();
    if (Object.keys(nextErrors).length > 0) return;
    setServerError(undefined);
    setConfirmOpen(true);
  };

  const onConfirm = async () => {
    setConfirmOpen(false);
    setServerError(undefined);
    try {
      const fresh = await queryClient.fetchQuery({
        queryKey: ['member', 'wallet'],
        queryFn: getWallet,
      });
      const freshBalance = fresh.availableBalance;
      if (compareMoney(amount.trim(), freshBalance) > 0) {
        setServerError(
          'The withdrawal amount exceeds your Available Balance. Enter a lower amount.',
        );
        return;
      }
    } catch {
      // If fresh fetch fails, rely on server 409 and show generic error below
    }
    createMutation.mutate(
      { amount: amount.trim(), payoutAccountId },
      {
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'INSUFFICIENT_BALANCE') {
            setServerError(
              'The withdrawal amount exceeds your Available Balance. Enter a lower amount.',
            );
          } else if (error instanceof ApiError && error.code === 'PAYOUT_ACCOUNT_UNVERIFIED') {
            setServerError('Choose a verified payout account to continue.');
          } else {
            setServerError(
              apiErrorMessage(error, 'We could not process the withdrawal. Please try again.'),
            );
          }
          void queryClient.invalidateQueries({ queryKey: ['member', 'wallet'] });
          void queryClient.invalidateQueries({ queryKey: ['member', 'payout-accounts'] });
        },
      },
    );
  };

  if (walletQuery.isLoading || accountsQuery.isLoading) {
    return (
      <section>
        <PageHeader
          title="Request a withdrawal"
          actions={
            <Link
              className={styles.backLink}
              to="/member/withdrawals"
              aria-label="Back to withdrawals"
            >
              ← Back to withdrawals
            </Link>
          }
        />

        <div className={styles.loading} role="status">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      </section>
    );
  }

  if (walletQuery.isError) {
    return (
      <section>
        <PageHeader
          title="Request a withdrawal"
          actions={
            <Link
              className={styles.backLink}
              to="/member/withdrawals"
              aria-label="Back to withdrawals"
            >
              ← Back to withdrawals
            </Link>
          }
        />

        <ErrorState
          error={walletQuery.error}
          title="Could not load your wallet"
          onRetry={() => void walletQuery.refetch()}
        />
      </section>
    );
  }

  if (accountsQuery.isError) {
    return (
      <section>
        <PageHeader
          title="Request a withdrawal"
          actions={
            <Link
              className={styles.backLink}
              to="/member/withdrawals"
              aria-label="Back to withdrawals"
            >
              ← Back to withdrawals
            </Link>
          }
        />

        <ErrorState
          error={accountsQuery.error}
          title="Could not load your payout accounts"
          onRetry={() => void accountsQuery.refetch()}
        />
      </section>
    );
  }

  if (verifiedAccounts.length === 0) {
    return (
      <section>
        <PageHeader
          title="Request a withdrawal"
          actions={
            <Link
              className={styles.backLink}
              to="/member/withdrawals"
              aria-label="Back to withdrawals"
            >
              ← Back to withdrawals
            </Link>
          }
        />

        <EmptyState
          title="No verified payout account"
          description="Add and confirm a payout account before requesting a withdrawal. Verification typically takes 24-48h (BR-PAY-003/004)."
          action={
            <Link to="/member/payouts/new" className={styles.inlineLink}>
              Add a payout account
            </Link>
          }
        />
      </section>
    );
  }

  const accountOptions = verifiedAccounts.map((account) => ({
    value: account.id,
    label: `${payoutMethodLabel(account.method)} · ${account.accountIdentifier ?? account.accountIdentifierMasked}`,
  }));

  const selectedAccount = verifiedAccounts.find((account) => account.id === payoutAccountId);

  return (
    <section>
      <PageHeader
        title="Request a withdrawal"
        actions={
          <Link
            className={styles.backLink}
            to="/member/withdrawals"
            aria-label="Back to withdrawals"
          >
            ← Back to withdrawals
          </Link>
        }
      />

      <p className={styles.balance}>
        Available Balance: <strong>{formatMoney(balance)}</strong>
      </p>

      {serverError ? (
        <Alert variant="danger" title="We could not process the withdrawal">
          {serverError}
        </Alert>
      ) : null}

      <form className={styles.form} noValidate onSubmit={onReview}>
        <TextField
          id="withdrawal-amount"
          name="amount"
          label="Amount (PHP)"
          value={amount}
          onChange={setAmount}
          error={errors.amount}
          hint={
            limits
              ? `Withdraw between ${formatMoney(limits.min)} and ${formatMoney(limits.max)}. The full amount is reserved immediately and cannot be edited after submission.`
              : 'The full amount is reserved immediately and cannot be edited after submission.'
          }
          inputMode="decimal"
        />
        {(() => {
          const trimmed = amount.trim();
          if (!trimmed || !isExactDecimal(trimmed)) return null;
          let availableAfter: string;
          try {
            if (compareMoney(trimmed, '0.00') <= 0 || compareMoney(trimmed, balance) > 0)
              return null;
            if (
              limits &&
              (compareMoney(trimmed, limits.min) < 0 || compareMoney(trimmed, limits.max) > 0)
            )
              return null;
            availableAfter = formatMoney(subtractMoney(balance, trimmed));
          } catch {
            return null;
          }
          return (
            <p className={styles.preview} aria-live="polite">
              Available after: <strong>{availableAfter}</strong>
            </p>
          );
        })()}
        <SelectField
          id="withdrawal-payoutAccountId"
          name="payoutAccountId"
          label="Payout account"
          value={payoutAccountId}
          onChange={setPayoutAccountId}
          options={accountOptions}
          error={errors.payoutAccountId}
          hint="Only verified payout accounts can be used (BR-PAY-005)."
        />
        <div className={styles.actions}>
          <Button type="submit" disabled={createMutation.isPending}>
            Review withdrawal
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={onConfirm}
        title="Request this withdrawal?"
        confirmLabel="Request withdrawal"
        message={
          <>
            <p className={styles.confirmText}>
              Request a withdrawal of{' '}
              <strong>{formatMoney(isExactDecimal(amount) ? amount : '0.00')}</strong> to your{' '}
              <strong>
                {selectedAccount ? payoutMethodLabel(selectedAccount.method) : 'payout account'}
              </strong>
              ?
            </p>
            <p className={styles.confirmText}>
              The amount will be reserved from your Available Balance and cannot be edited.
            </p>
          </>
        }
      />
    </section>
  );
}
