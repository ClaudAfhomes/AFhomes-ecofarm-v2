import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Customer, CustomerOnboardingRecovery, Sale } from '@afhomes/contracts';
import { Button, ConfirmDialog, DetailCard, DetailCardTitle, Dialog, Select } from '@afhomes/ui';
import { useNavigate } from 'react-router';

import { useSession } from '../../lib/session';
import styles from './CustomerDetailPage.module.css';
import {
  anonymizeCustomer,
  deactivateCustomer,
  deleteCustomer,
  issueCustomerAccountActivation,
  updateCustomerStatus,
} from './services';
import { RecordPaymentDialog, VerifyDialog } from './BusinessFinanceQueuePage';
import { useSaleRowActions } from './useSaleRowActions';

/**
 * All actions for one customer in a single card, mirroring the directory row
 * menu so the detail page carries the same workflows: a new application, the
 * one-time activation link, deactivation, and (super admin only) anonymize
 * and permanent delete - plus the per-sale actions (record/verify payment,
 * edit, delete) aimed at a selected sale. Same guards, same dialogs, same
 * auditing - the server re-checks everything.
 */
export function CustomerRecordActions({
  customer,
  sales,
  onChanged,
}: {
  customer: Customer;
  sales: Sale[];
  onChanged: () => void;
}) {
  const saleActions = useSaleRowActions();
  const client = useQueryClient();
  const { user } = useSession();
  const navigate = useNavigate();
  const canIssueActivation =
    user?.roleSlug === 'super_admin' ||
    user?.afHomesPermissions.some(
      (permission) => permission.moduleKey === 'sales.customers' && permission.canUpdate,
    ) === true;
  const isSuperAdmin = user?.roleSlug === 'super_admin';

  const [accountAction, setAccountAction] = useState<'deactivate' | 'delete' | 'anonymize' | null>(
    null,
  );
  const [confirmation, setConfirmation] = useState('');
  const [activationResult, setActivationResult] = useState<CustomerOnboardingRecovery | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['business', 'customer'] });
    onChanged();
  };

  const changeAccount = useMutation({
    mutationFn: async () => {
      if (accountAction === 'delete') await deleteCustomer(customer.id);
      else if (accountAction === 'anonymize') await anonymizeCustomer(customer.id);
      else await deactivateCustomer(customer.id);
    },
    onSuccess: async () => {
      setAccountAction(null);
      setConfirmation('');
      if (accountAction === 'delete' || accountAction === 'anonymize') {
        navigate('/admin/customers');
        return;
      }
      await refresh();
    },
  });

  const issueActivation = useMutation({
    mutationFn: () => issueCustomerAccountActivation(customer.id),
    onMutate: () => {
      setIssuing(true);
      setCopyStatus('');
    },
    onSuccess: (result) => {
      setActivationResult(result);
      setIssuing(false);
    },
    onError: () => setIssuing(false),
  });

  const closeActivationResult = () => {
    // The URL contains the plaintext bearer token and is deliberately removed
    // from component state when the one-time dialog closes.
    setActivationResult(null);
    setCopyStatus('');
    issueActivation.reset();
  };

  const showActivation =
    canIssueActivation && customer.hasActiveMembership && !customer.portalAccountActivated;

  const canUpdateCustomer =
    user?.roleSlug === 'super_admin' ||
    user?.afHomesPermissions.some(
      (permission) => permission.moduleKey === 'sales.customers' && permission.canUpdate,
    ) === true;

  const statusMutation = useMutation({
    mutationFn: (status: 'prospect' | 'active' | 'suspended') =>
      updateCustomerStatus(customer.id, status),
    onSuccess: async () => {
      await refresh();
    },
  });

  const showSaleActions =
    sales.length > 0 && (saleActions.canRecord || saleActions.canEdit || saleActions.canCancel);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const selectedSale = sales.find((sale) => sale.id === selectedSaleId) ?? sales[0];

  return (
    <>
      <DetailCard>
        <DetailCardTitle>Actions</DetailCardTitle>
        {sales.length > 1 && showSaleActions && selectedSale ? (
          <label className={styles.filterLabel}>
            Sale
            <Select
              aria-label="Sale for actions"
              value={selectedSale.id}
              onChange={(e) => setSelectedSaleId(e.target.value)}
              options={sales.map((sale) => ({ value: sale.id, label: sale.saleNumber }))}
            />
          </label>
        ) : null}
        <div className={styles.actionButtons}>
          {showActivation ? (
            <Button variant="secondary" disabled={issuing} onClick={() => issueActivation.mutate()}>
              {issuing ? 'Issuing activation link…' : 'Issue / Reissue activation link'}
            </Button>
          ) : null}
          {isSuperAdmin ? (
            <>
              <Button
                variant="secondary"
                className={styles.toneSlate}
                onClick={() => {
                  setAccountAction('anonymize');
                  setConfirmation('');
                }}
              >
                Anonymize
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setAccountAction('delete');
                  setConfirmation('');
                }}
              >
                Delete permanently
              </Button>
            </>
          ) : null}
          <Button
            variant="secondary"
            className={styles.toneInfo}
            disabled={customer.status === 'suspended' || customer.status === 'cancelled'}
            onClick={() => {
              setAccountAction('deactivate');
              setConfirmation('');
            }}
          >
            Deactivate account
          </Button>
          {showSaleActions && selectedSale ? (
            <>
              {saleActions.canRecord ? (
                <>
                  <Button
                    variant="primary"
                    onClick={() =>
                      saleActions.openPaymentDialog({ saleId: selectedSale.id, kind: 'record' })
                    }
                  >
                    Record payment
                  </Button>
                  <Button
                    variant="secondary"
                    className={styles.toneAccent}
                    onClick={() =>
                      saleActions.openPaymentDialog({ saleId: selectedSale.id, kind: 'verify' })
                    }
                  >
                    Verify payment
                  </Button>
                </>
              ) : null}
            </>
          ) : null}
          {canUpdateCustomer ? (
            <Select
              aria-label="Membership status"
              value={
                ['prospect', 'active', 'suspended'].includes(customer.status) ? customer.status : ''
              }
              disabled={statusMutation.isPending}
              onChange={(e) => {
                const next = e.target.value as 'prospect' | 'active' | 'suspended' | '';
                if (next && next !== customer.status) statusMutation.mutate(next);
              }}
              options={[
                { value: '', label: 'Select Status' },
                { value: 'prospect', label: 'Prospect' },
                { value: 'active', label: 'Active' },
                { value: 'suspended', label: 'Suspended' },
              ]}
            />
          ) : null}
        </div>
        {statusMutation.error ? <p role="alert">{statusMutation.error.message}</p> : null}
        {issueActivation.error && !activationResult ? (
          <p role="alert">{issueActivation.error.message}</p>
        ) : null}
      </DetailCard>
      {saleActions.paymentDialog?.kind === 'record' ? (
        <RecordPaymentDialog
          saleId={saleActions.paymentDialog.saleId}
          onDone={saleActions.refresh}
          onClose={saleActions.closePaymentDialog}
        />
      ) : null}
      {saleActions.paymentDialog?.kind === 'verify' ? (
        <VerifyDialog
          saleId={saleActions.paymentDialog.saleId}
          onDone={saleActions.refresh}
          onClose={saleActions.closePaymentDialog}
        />
      ) : null}
      <Dialog
        open={activationResult !== null}
        onClose={closeActivationResult}
        title="Customer activation ready"
        footer={<Button onClick={closeActivationResult}>Done</Button>}
      >
        {activationResult ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <p>
              {activationResult.emailStatus === 'sent'
                ? 'Activation email sent.'
                : 'Email could not be sent. Copy this link and give it to the customer.'}
            </p>
            <p>
              <strong>This activation link is shown once.</strong> Closing this dialog removes it
              from this screen.
            </p>
            <dl>
              <dt>Email</dt>
              <dd>{activationResult.email}</dd>
              <dt>Expires</dt>
              <dd>{new Date(activationResult.expiresAt).toLocaleString()}</dd>
            </dl>
            <label>
              Activation link
              <input
                aria-label="Customer activation link"
                readOnly
                value={activationResult.activationUrl}
              />
            </label>
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(activationResult.activationUrl);
                  setCopyStatus('Activation link copied.');
                } catch {
                  setCopyStatus('Copy failed. Select and copy the link manually.');
                }
              }}
            >
              Copy activation link
            </Button>
            {copyStatus ? <p role="status">{copyStatus}</p> : null}
          </div>
        ) : null}
      </Dialog>
      <ConfirmDialog
        open={accountAction !== null}
        onCancel={() => {
          setAccountAction(null);
          setConfirmation('');
        }}
        onConfirm={() => changeAccount.mutate()}
        title={
          accountAction === 'delete'
            ? 'Permanently Delete Customer Account'
            : accountAction === 'anonymize'
              ? 'Anonymize Customer Account'
              : 'Deactivate Customer Account'
        }
        message={
          <div>
            <p>
              {accountAction === 'delete'
                ? 'This permanently removes an unused customer account only when no protected business records exist.'
                : accountAction === 'anonymize'
                  ? 'Direct profile information and login access will be removed while business history remains.'
                  : 'Customer login access will be removed. Sales, payments, membership, points, and redemption history will remain.'}
            </p>
            {accountAction !== 'deactivate' ? (
              <label>
                Type DELETE to confirm
                <input
                  aria-label="Type DELETE to confirm customer action"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
            ) : null}
            {changeAccount.error ? <p role="alert">{changeAccount.error.message}</p> : null}
          </div>
        }
        danger
        confirmLabel={
          accountAction === 'delete'
            ? 'Delete permanently'
            : accountAction === 'anonymize'
              ? 'Anonymize'
              : 'Confirm'
        }
        confirmDisabled={accountAction !== 'deactivate' && confirmation !== 'DELETE'}
        confirmLoading={changeAccount.isPending}
      />
    </>
  );
}
