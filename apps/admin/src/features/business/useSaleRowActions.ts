import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Sale } from '@afhomes/contracts';
import { useNavigate } from 'react-router';

import { useSession } from '../../lib/session';
import { cancelSale, getCustomerApplications } from './services';

/** Application statuses the sales Edit flow can still open for changes. */
const EDITABLE_APPLICATION_STATUSES = ['draft', 'submitted'];

/**
 * A sale is editable only while its money is untouched: frozen snapshots
 * never change here, so the action is offered before any verified payment
 * lands and before activation.
 */
export function isSaleEditable(sale: Sale): boolean {
  return sale.paidAmount === '0.00' && !sale.activatedAt;
}

export type PaymentDialogRequest = {
  saleId: string;
  kind: 'record' | 'verify';
};

/**
 * Shared Edit/Delete/payment-dialog wiring for a sale row, used by the sales
 * directory menu and the customer detail Action card. One implementation so
 * the guards cannot drift apart: Edit resolves the linked application and
 * navigates to its editor, Delete cancels untouched drafts behind a typed
 * confirmation, and the server re-checks everything.
 */
export function useSaleRowActions() {
  const client = useQueryClient();
  const { user } = useSession();
  const navigate = useNavigate();
  const [cancelTarget, setCancelTarget] = useState<Sale | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [rowError, setRowError] = useState('');
  const [paymentDialog, setPaymentDialog] = useState<PaymentDialogRequest | null>(null);

  const canRecord = user?.afHomesPermissions.some(
    (permission) => permission.moduleKey === 'finance.payment_verification' && permission.canUpdate,
  );
  const canEdit = user?.afHomesPermissions.some(
    (permission) => permission.moduleKey === 'sales.customers' && permission.canUpdate,
  );
  const canCancel = user?.afHomesPermissions.some(
    (permission) => permission.moduleKey === 'sales.card_sales' && permission.canUpdate,
  );

  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['business'] }),
      client.invalidateQueries({ queryKey: ['reports'] }),
    ]);
  };

  const cancel = useMutation({
    mutationFn: (sale: Sale) => cancelSale(sale.id),
    onSuccess: async () => {
      await refresh();
      setCancelTarget(null);
      setConfirmation('');
    },
  });

  const openEditor = async (sale: Sale) => {
    setRowError('');
    try {
      const applications = await getCustomerApplications({ saleId: sale.id });
      const editable = applications.find((app) =>
        EDITABLE_APPLICATION_STATUSES.includes(app.status),
      );
      if (!editable) {
        setRowError(
          `Sale ${sale.saleNumber} has no editable application: only draft or submitted applications can still change.`,
        );
        return;
      }
      navigate(`/admin/customers/applications/${editable.id}`);
    } catch (error) {
      setRowError(error instanceof Error ? error.message : 'Could not open the application.');
    }
  };

  return {
    canRecord,
    canEdit,
    canCancel,
    cancelTarget,
    confirmation,
    setConfirmation,
    rowError,
    setRowError,
    cancel,
    openEditor,
    paymentDialog,
    openPaymentDialog: (request: PaymentDialogRequest) => setPaymentDialog(request),
    closePaymentDialog: () => setPaymentDialog(null),
    requestCancel: (sale: Sale) => {
      setCancelTarget(sale);
      setConfirmation('');
      cancel.reset();
    },
    closeCancel: () => {
      setCancelTarget(null);
      setConfirmation('');
      cancel.reset();
    },
    refresh,
  };
}

export type SaleRowActions = ReturnType<typeof useSaleRowActions>;
