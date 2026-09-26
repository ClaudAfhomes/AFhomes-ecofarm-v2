import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';

import { ErrorState, PageHeader, Skeleton } from '@jad/ui';
import type { PayoutMethod } from '@jad/contracts';

import { PAYOUT_METHOD_OPTIONS } from '../lib/presentation';

import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { ApiError } from '../../../lib/api/errors';
import { apiErrorMessage } from '../../../lib/api/errorMessage';
import { usePayoutAccounts } from '../hooks/useMember';
import { createPayoutAccount } from '../services/member';
import { SelectField } from '../../auth/components/SelectField';
import { TextField } from '../../auth/components/TextField';
import styles from './AddPayoutAccountPage.module.css';

const GCASH_RE = /^09\d{9}$/;
const BANK_ACCOUNT_RE = /^\d{10,12}$/;
const ALPHANUMERIC_RE = /^[A-Z0-9]{8,34}$/i;

const TRADITIONAL_BANK_FIELDS = [
  { id: 'bankName', label: 'Bank name', placeholder: 'e.g. BDO, BPI, Metrobank', required: true },
  {
    id: 'branch',
    label: 'Branch (optional)',
    placeholder: 'e.g. Makati Ayala Ave',
    required: false,
  },
];

const DIGITAL_BANK_FIELDS = [
  {
    id: 'bankName',
    label: 'Bank / e-wallet name',
    placeholder: 'e.g. Maya, GoTyme, Tonik',
    required: true,
  },
];

export function AddPayoutAccountPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const accountsQuery = usePayoutAccounts();
  const [method, setMethod] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountIdentifier, setAccountIdentifier] = useState('');
  const [bankName, setBankName] = useState('');
  const [branch, setBranch] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | undefined>();

  const createMutation = useMutation({
    mutationFn: createPayoutAccount,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['member', 'payout-accounts'] });
      navigate('/member/payouts', { replace: true, state: { justAdded: true } });
    },
  });

  const resetMethodFields = () => {
    setBankName('');
    setBranch('');
    setAccountIdentifier('');
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!method) nextErrors.method = 'Select a payout method.';
    if (!accountName.trim()) nextErrors.accountName = 'Enter the account holder name.';

    const idTrimmed = accountIdentifier.trim();

    if (method === 'GCASH') {
      if (!idTrimmed) nextErrors.accountIdentifier = 'Enter your GCash mobile number.';
      else if (!GCASH_RE.test(idTrimmed))
        nextErrors.accountIdentifier = 'Enter a valid GCash number (09 followed by 9 digits).';
    } else if (method === 'TRADITIONAL_BANK') {
      if (!bankName.trim()) nextErrors.bankName = 'Enter the bank name.';
      if (!idTrimmed) nextErrors.accountIdentifier = 'Enter your bank account number.';
      else if (!BANK_ACCOUNT_RE.test(idTrimmed))
        nextErrors.accountIdentifier = 'Enter a valid 10-12 digit account number.';
    } else if (method === 'DIGITAL_BANK') {
      if (!bankName.trim()) nextErrors.bankName = 'Enter the bank / e-wallet name.';
      if (!idTrimmed) nextErrors.accountIdentifier = 'Enter your account number.';
      else if (!BANK_ACCOUNT_RE.test(idTrimmed))
        nextErrors.accountIdentifier = 'Enter a valid 10-12 digit account number.';
    } else if (method === 'OTHER') {
      if (!idTrimmed) nextErrors.accountIdentifier = 'Enter the account identifier.';
      else if (!ALPHANUMERIC_RE.test(idTrimmed))
        nextErrors.accountIdentifier = 'Enter 8-34 alphanumeric characters.';
    }

    setErrors(nextErrors);
    if (nextErrors.method) document.getElementById('payout-method')?.focus();
    else if (nextErrors.bankName) document.getElementById('payout-bankName')?.focus();
    else if (nextErrors.accountName) document.getElementById('payout-accountName')?.focus();
    else if (nextErrors.accountIdentifier)
      document.getElementById('payout-accountIdentifier')?.focus();
    if (Object.keys(nextErrors).length > 0) return;

    setServerError(undefined);
    try {
      await createMutation.mutateAsync({
        method: method as PayoutMethod,
        accountName: accountName.trim(),
        accountIdentifier: idTrimmed,
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CONFLICT') {
        setErrors((current) => ({
          ...current,
          accountIdentifier: 'A payout account with this identifier already exists.',
        }));
        document.getElementById('payout-accountIdentifier')?.focus();
      } else {
        setServerError(
          apiErrorMessage(error, 'We could not add the payout account. Please try again.'),
        );
      }
    }
  };

  if (accountsQuery.isLoading) {
    return (
      <section>
        <PageHeader title="Add payout account" />

        <div className={styles.loading} role="status">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      </section>
    );
  }

  if (accountsQuery.isError) {
    return (
      <section>
        <PageHeader title="Add payout account" />

        <ErrorState
          error={accountsQuery.error}
          title="Could not load your payout accounts"
          onRetry={() => void accountsQuery.refetch()}
        />
      </section>
    );
  }

  const isGcash = method === 'GCASH';

  return (
    <section>
      <PageHeader
        title="Add payout account"
        description="Register the account your withdrawals will be paid into."
        actions={
          <Link to="/member/payouts" className={styles.backLink}>
            ← Back to payouts
          </Link>
        }
      />

      {serverError ? (
        <Alert variant="danger" title="We could not add the payout account">
          {serverError}
        </Alert>
      ) : null}

      <form className={styles.form} noValidate onSubmit={onSubmit}>
        <SelectField
          id="payout-method"
          name="method"
          label="Payout method"
          value={method}
          onChange={(v) => {
            setMethod(v);
            resetMethodFields();
          }}
          options={PAYOUT_METHOD_OPTIONS}
          error={errors.method}
          hint="Select where your withdrawals should be sent."
        />

        {method ? (
          <div className={styles.fieldGroup}>
            {method === 'TRADITIONAL_BANK' ? (
              <>
                <p className={styles.fieldGroupHint}>
                  Enter your traditional bank account details for fund transfers.
                </p>
                {TRADITIONAL_BANK_FIELDS.map((field) => (
                  <TextField
                    key={field.id}
                    id={`payout-${field.id}`}
                    name={field.id}
                    label={field.label}
                    value={field.id === 'bankName' ? bankName : branch}
                    onChange={(v) => (field.id === 'bankName' ? setBankName(v) : setBranch(v))}
                    error={errors[field.id]}
                    placeholder={field.placeholder}
                    autoComplete="off"
                  />
                ))}
              </>
            ) : method === 'DIGITAL_BANK' ? (
              <>
                <p className={styles.fieldGroupHint}>
                  Enter your digital bank or e-wallet account details.
                </p>
                {DIGITAL_BANK_FIELDS.map((field) => (
                  <TextField
                    key={field.id}
                    id={`payout-${field.id}`}
                    name={field.id}
                    label={field.label}
                    value={bankName}
                    onChange={setBankName}
                    error={errors.bankName}
                    placeholder={field.placeholder}
                    autoComplete="off"
                  />
                ))}
              </>
            ) : isGcash ? (
              <p className={styles.fieldGroupHint}>
                Enter your GCash-registered mobile number. Funds will be sent directly to this
                number.
              </p>
            ) : (
              <p className={styles.fieldGroupHint}>
                Enter a custom identifier for your payout account.
              </p>
            )}

            <TextField
              id="payout-accountName"
              name="accountName"
              label="Account holder name"
              value={accountName}
              onChange={setAccountName}
              error={errors.accountName}
              autoComplete="name"
              hint="Must match the registered account name for verification."
            />

            <TextField
              id="payout-accountIdentifier"
              name="accountIdentifier"
              label={isGcash ? 'Mobile number' : 'Account number'}
              value={accountIdentifier}
              onChange={setAccountIdentifier}
              error={errors.accountIdentifier}
              autoComplete="off"
              inputMode={isGcash ? 'tel' : 'numeric'}
              placeholder={isGcash ? '09xxxxxxxxx' : 'Account number'}
              maxLength={isGcash ? 11 : 34}
              hint={
                isGcash
                  ? 'Format: 09 followed by 9 digits.'
                  : 'Stored securely - only a masked version is shown after submission.'
              }
            />
          </div>
        ) : null}

        <div className={styles.actions}>
          <Button
            type="submit"
            loading={createMutation.isPending}
            disabled={createMutation.isPending || !method}
          >
            Add payout account
          </Button>
          <p className={styles.note}>
            New accounts are reviewed and confirmed before they can be used for withdrawals.
          </p>
        </div>
      </form>
    </section>
  );
}
