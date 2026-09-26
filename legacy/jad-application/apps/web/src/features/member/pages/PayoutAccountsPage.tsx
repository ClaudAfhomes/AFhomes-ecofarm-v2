import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';

import type { PayoutAccountStatus } from '@jad/contracts';

import {
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  notifySuccess,
  PageHeader,
  Skeleton,
  StatusChip,
} from '@jad/ui';

import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { ButtonLink } from '../../../components/ButtonLink';
import { apiErrorMessage } from '../../../lib/api/errorMessage';
import { usePayoutAccounts } from '../hooks/useMember';
import { deletePayoutAccount, setPrimaryPayoutAccount } from '../services/member';
import {
  PAYOUT_ACCOUNT_STATUS_TONE,
  formatDate,
  payoutAccountStatusLabel,
  payoutMethodLabel,
} from '../lib/presentation';
import styles from './PayoutAccountsPage.module.css';

/**
 * Payout accounts (SCR-MEM-010, FR-PAY-001..006). The member's registered
 * payout destinations. Lists and the details dialog show the full account
 * number when the API provides it (masked fallback otherwise) and the
 * Pending → Admin Review → Confirmed lifecycle (BR-PAY-004). Exactly one
 * account is the Primary (BR-PAY-006); setting another is the only action here.
 */
export function PayoutAccountsPage() {
  const queryClient = useQueryClient();
  const accountsQuery = usePayoutAccounts();
  const [mutationError, setMutationError] = useState<string | undefined>();

  const setPrimaryMutation = useMutation({
    mutationFn: setPrimaryPayoutAccount,
    onSuccess: () => {
      setMutationError(undefined);
      notifySuccess({ title: 'Primary payout account updated' });
      void queryClient.invalidateQueries({ queryKey: ['member', 'payout-accounts'] });
    },
  });

  const onSetPrimary = (accountId: string) => {
    setMutationError(undefined);
    setPrimaryMutation.mutate(accountId, {
      onError: (error) => {
        setMutationError(apiErrorMessage(error, 'We could not update the primary payout account.'));
      },
    });
  };

  const location = useLocation();
  const addedNotified = useRef(false);

  useEffect(() => {
    const state = location.state as { justAdded?: boolean } | null;
    if (state?.justAdded) {
      if (!addedNotified.current) {
        addedNotified.current = true;
        notifySuccess({
          title: 'Payout account added',
          message: 'Your payout account is pending verification - typically 24-48h.',
        });
      }
      window.history.replaceState({}, '', location.pathname);
    }
  }, [location.state, location.pathname]);

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [detailAccountId, setDetailAccountId] = useState<string | null>(null);
  const detailAccount = (accountsQuery.data ?? []).find(
    (account) => account.id === detailAccountId,
  );
  const deleteMutation = useMutation({
    mutationFn: deletePayoutAccount,
    onSuccess: () => {
      setMutationError(undefined);
      setDeleteTargetId(null);
      notifySuccess({ title: 'Payout account removed' });
      void queryClient.invalidateQueries({ queryKey: ['member', 'payout-accounts'] });
    },
  });

  const onDelete = (accountId: string) => {
    setMutationError(undefined);
    deleteMutation.mutate(accountId, {
      onError: (error) => {
        setMutationError(apiErrorMessage(error, 'We could not delete the payout account.'));
        setDeleteTargetId(null);
      },
    });
  };

  const FILTERS: { value: PayoutAccountStatus | 'All'; label: string }[] = [
    { value: 'All', label: 'All' },
    { value: 'PENDING', label: 'Pending' },
    { value: 'ADMIN_REVIEW', label: 'Admin Review' },
    { value: 'CONFIRMED', label: 'Confirmed' },
    { value: 'REJECTED', label: 'Rejected' },
  ];

  const pendingCount = (accountsQuery.data ?? []).filter(
    (account) => account.status === 'PENDING',
  ).length;
  const reviewCount = (accountsQuery.data ?? []).filter(
    (account) => account.status === 'ADMIN_REVIEW',
  ).length;

  const [filter, setFilter] = useState<PayoutAccountStatus | 'All'>('All');
  const filteredAccounts = useMemo(() => {
    const data = accountsQuery.data ?? [];
    if (filter === 'All') return data;
    return data.filter((account) => account.status === filter);
  }, [accountsQuery.data, filter]);

  return (
    <section>
      <PageHeader
        title="Payout accounts"
        description="Where your withdrawals are paid out."
        actions={
          <ButtonLink to="/member/payouts/new" className={styles.addLink}>
            Add payout account
          </ButtonLink>
        }
      />

      {mutationError ? (
        <Alert variant="danger" title="We could not update the payout account">
          {mutationError}
        </Alert>
      ) : null}

      {pendingCount + reviewCount > 0 ? (
        <div className={styles.verificationAlert}>
          <Alert variant="info" title="Verification pending">
            {pendingCount + reviewCount} payout account{pendingCount + reviewCount === 1 ? '' : 's'}{' '}
            pending verification - typically 24-48h. Verified accounts are required for withdrawals.
          </Alert>
        </div>
      ) : null}

      {(accountsQuery.data ?? []).length > 0 &&
      !accountsQuery.isLoading &&
      !accountsQuery.isError ? (
        <div className={styles.filters} role="group" aria-label="Filter payout accounts by status">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={filter === option.value ? styles.filterActive : styles.filter}
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      {accountsQuery.isLoading ? (
        <div className={styles.loading} role="status">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : accountsQuery.isError ? (
        <ErrorState
          error={accountsQuery.error}
          title="Could not load your payout accounts"
          onRetry={() => void accountsQuery.refetch()}
        />
      ) : (accountsQuery.data ?? []).length === 0 ? (
        <EmptyState
          title="No payout accounts yet"
          description="Add a payout account before requesting a withdrawal."
          action={
            <Link to="/member/payouts/new" className={styles.inlineLink}>
              Add a payout account
            </Link>
          }
        />
      ) : filteredAccounts.length === 0 ? (
        <EmptyState
          title="No payout accounts match this filter"
          description={`No ${payoutAccountStatusLabel(filter as PayoutAccountStatus)} accounts found. Try another filter.`}
          action={
            <button type="button" className={styles.inlineLink} onClick={() => setFilter('All')}>
              Clear filter
            </button>
          }
        />
      ) : (
        <ul className={styles.list}>
          {filteredAccounts.map((account) => (
            <li
              key={account.id}
              className={`${styles.card} ${styles.selectable}`}
              onClick={() => setDetailAccountId(account.id)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setDetailAccountId(account.id);
                }
              }}
              aria-label={`View payout account details for ${account.accountName}`}
            >
              <div className={styles.cardMain}>
                <span className={styles.name}>
                  {payoutMethodLabel(account.method)}
                  {account.isPrimary ? <span className={styles.primary}>Primary</span> : null}
                </span>
                <span className={styles.meta}>
                  {account.accountName} ·{' '}
                  {account.accountIdentifier ?? account.accountIdentifierMasked}
                </span>
                <span className={styles.meta}>Added {formatDate(account.createdAt)}</span>
                {account.rejectionReason ? (
                  <span className={styles.rejectionReason}>Reason: {account.rejectionReason}</span>
                ) : null}
              </div>
              <div className={styles.cardSide}>
                <StatusChip
                  label={payoutAccountStatusLabel(account.status)}
                  tone={PAYOUT_ACCOUNT_STATUS_TONE[account.status]}
                />
                <span
                  className={styles.cardActions}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  {account.status === 'CONFIRMED' && !account.isPrimary ? (
                    <Button
                      variant="secondary"
                      loading={
                        setPrimaryMutation.isPending && setPrimaryMutation.variables === account.id
                      }
                      disabled={
                        setPrimaryMutation.isPending && setPrimaryMutation.variables === account.id
                      }
                      onClick={() => onSetPrimary(account.id)}
                    >
                      Set as primary
                    </Button>
                  ) : null}
                  {account.status === 'PENDING' ? (
                    <Button
                      variant="ghost"
                      loading={deleteMutation.isPending && deleteMutation.variables === account.id}
                      disabled={deleteMutation.isPending}
                      onClick={() => setDeleteTargetId(account.id)}
                    >
                      Delete
                    </Button>
                  ) : null}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deleteTargetId !== null}
        onCancel={() => setDeleteTargetId(null)}
        onConfirm={() => {
          if (deleteTargetId) onDelete(deleteTargetId);
        }}
        title="Delete payout account?"
        message="This pending account will be permanently removed. You can add a new one with the correct details."
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />

      <Dialog
        open={detailAccountId !== null}
        onClose={() => setDetailAccountId(null)}
        title="Payout account details"
        footer={
          <Button variant="secondary" onClick={() => setDetailAccountId(null)}>
            Close
          </Button>
        }
      >
        {detailAccount ? (
          <dl className={styles.details}>
            <div className={styles.detailItem}>
              <dt>Method</dt>
              <dd>{payoutMethodLabel(detailAccount.method)}</dd>
            </div>
            <div className={styles.detailItem}>
              <dt>Account name</dt>
              <dd>{detailAccount.accountName}</dd>
            </div>
            <div className={styles.detailItem}>
              <dt>Account number</dt>
              <dd className={styles.mono}>
                {detailAccount.accountIdentifier ?? detailAccount.accountIdentifierMasked}
              </dd>
            </div>
            <div className={styles.detailItem}>
              <dt>Status</dt>
              <dd>{payoutAccountStatusLabel(detailAccount.status)}</dd>
            </div>
          </dl>
        ) : null}
      </Dialog>
    </section>
  );
}
