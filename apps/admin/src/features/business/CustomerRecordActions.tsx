import { useState } from 'react';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import type { Customer, CustomerOnboardingRecovery, Sale } from '@afhomes/contracts';
import {
  Alert,
  Button,
  DetailCard,
  DetailCardTitle,
  Dialog,
  Select,
  TextField,
} from '@afhomes/ui';


import { useSession } from '../../lib/session';
import { formatDateTime } from '../../lib/format';
import styles from './CustomerDetailPage.module.css';
import {
  issueCustomerAccountActivation,
} from './services';
import { RecordPaymentDialog, VerifyDialog } from './BusinessFinanceQueuePage';

import { useSaleRowActions } from './useSaleRowActions';

/**
 * All actions for one customer in a single card, mirroring the directory row
 * menu so the detail page carries the same workflows: the one-time activation
 * link, deactivation, and (super admin only) permanent delete -
 * plus the per-sale payment actions (record/verify) aimed at a selected sale.
 * Edit/cancel of a sale stay on the sales directory. Same guards, same dialogs,
 * same auditing - the server re-checks everything.
 */
export function CustomerRecordActions({
  customer,
  sales,
  onEdit,
  onDelete,
  canEdit,
}: {
  customer: Customer;
  sales: Sale[];
  onEdit?: () => void;
  onDelete?: () => void;
  canEdit?: boolean;
}) {
  const saleActions = useSaleRowActions();
  const { user } = useSession();
  const canIssueActivation =
    user?.roleSlug === 'super_admin' ||
    user?.afHomesPermissions.some(
      (permission) => permission.moduleKey === 'sales.customers' && permission.canUpdate,
    ) === true;
  const [activationResult, setActivationResult] = useState<CustomerOnboardingRecovery | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');

  const issueActivation = useBusinessMutation({
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

  // Only the payment actions are offered here; edit/cancel of a sale stay on the
  // sales directory, so a user with only those grants sees no dead sale card.
  const showSaleActions = sales.length > 0 && saleActions.canRecord;
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
            <Button
              variant="secondary"
              loading={issuing}
              loadingLabel="Issuing activation link…"
              onClick={() => issueActivation.mutate()}
            >
              Issue / Reissue activation link
            </Button>
          ) : null}
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
          {onEdit && canEdit ? (
            <Button variant="secondary" onClick={onEdit}>
              Edit
            </Button>
          ) : null}
          {onDelete && user?.roleSlug === 'super_admin' ? (
            <Button
              variant="danger"
              onClick={onDelete}
            >
              Delete
            </Button>
          ) : null}
        </div>
        {issueActivation.error && !activationResult ? (
          <Alert variant="danger">{issueActivation.error.message}</Alert>
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
              <dd>{formatDateTime(activationResult.expiresAt)}</dd>
            </dl>
            <TextField
              id="record-activation-link"
              name="activationLink"
              label="Customer activation link"
              value={activationResult.activationUrl}
              onChange={() => {}}
              readOnly
            />
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
    </>
  );
}
