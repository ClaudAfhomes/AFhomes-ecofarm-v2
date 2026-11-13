/**
 * The single "what is due next" step for a list row, derived only from the
 * status/figures the list already carries. UX guidance: every target screen
 * re-checks state and the server enforces each rule.
 */
export interface RowStep {
  label: string;
  /** Where the primary button goes; null renders plain status text (nothing to do here). */
  to: string | null;
}

export function applicationNextStep(app: { id: string; status: string }): RowStep {
  switch (app.status) {
    case 'draft':
      return { label: 'Upload signed application', to: `/admin/customers/applications/${app.id}` };
    case 'submitted':
      return { label: 'Review and approve', to: `/admin/customers/applications/${app.id}` };
    case 'approved':
      return {
        label: 'Create reservation',
        to: `/admin/sales/reservations/new?application=${encodeURIComponent(app.id)}`,
      };
    default:
      return { label: 'No action due', to: null };
  }
}

export function reservationNextStep(item: {
  id: string;
  reservationNumber: string;
  status: string;
  saleId: string | null;
  fullyPaid: boolean;
}): RowStep {
  if (item.status === 'draft')
    return { label: 'Continue draft', to: `/admin/sales/reservations/${item.id}` };
  if (item.status === 'submitted')
    return { label: 'Review and execute', to: `/admin/sales/reservations/${item.id}` };
  if (item.status === 'executed') {
    if (item.saleId && item.fullyPaid) return { label: 'Activate', to: '/admin/finance/activation' };
    return {
      label: item.fullyPaid ? 'Finalize purchase' : 'Record payment',
      to: `/admin/finance/payments?search=${encodeURIComponent(item.reservationNumber)}`,
    };
  }
  return { label: 'No action due', to: null };
}
