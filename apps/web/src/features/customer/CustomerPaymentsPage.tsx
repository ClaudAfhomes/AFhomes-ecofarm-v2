import { ErrorState, StatusChip } from '@afhomes/ui';
import { formatMoneyOrDash } from '@afhomes/shared';

import { useCustomerPaymentsQuery } from './queries';
import { isForbidden } from './http';
import {
  ActivityList,
  ActivityListSkeleton,
  ActivityRow,
  formatDate,
  humanStatus,
  statusTone,
  ui,
} from './portal-ui';
import { MoneyPanel } from './MoneyPanel';
import { sentenceCase } from './money-format';
import money from './money.module.css';

/**
 * Status as TEXT. A payment that is only `recorded` is never worded as
 * verified: only verified payments count toward the balance.
 */
function paymentStatusLabel(status: string): string {
  switch (status) {
    case 'verified':
      return 'Verified';
    case 'recorded':
      return 'Recorded, not yet verified';
    case 'rejected':
      return 'Rejected';
    case 'voided':
      return 'Voided';
    default:
      return humanStatus(status);
  }
}

/**
 * Read-only payment history: only this member's own card-sale payments, and
 * only the safe columns the server selects (amount, method, reference,
 * status, dates). Staff ids, receipt paths and finance notes never leave
 * the API, so there is nothing here to leak.
 */
export function CustomerPaymentsPage() {
  const payments = useCustomerPaymentsQuery();

  if (payments.isLoading)
    return (
      <MoneyPanel title="Payment history">
        <ActivityListSkeleton />
      </MoneyPanel>
    );
  if (payments.isError) {
    return (
      <ErrorState
        onRetry={payments.refetch}
        title="Payments unavailable"
        message={
          isForbidden(payments.error)
            ? 'Your account is not active, so payments are not available. Contact AFhomes Ecofarm to restore access.'
            : 'We could not load your payments. Please try again in a moment.'
        }
      />
    );
  }

  const rows = payments.data ?? [];

  return (
    <MoneyPanel
      title="Payment history"
      description={
        rows.length > 0 ? 'Only verified payments are counted as received.' : undefined
      }
    >
      {rows.length === 0 ? (
        <p className={ui.muted}>No payments recorded yet.</p>
      ) : (
        <>
          <ActivityList label="Payment history">
            {rows.map((payment) => (
              <ActivityRow
                key={payment.id}
                icon="receipt"
                tone={statusTone(payment.status)}
                title={payment.paymentType ? sentenceCase(payment.paymentType) : 'Payment'}
                meta={
                  <>
                    <span>{sentenceCase(payment.method)}</span>
                    {payment.reference ? (
                      <>
                        {' · '}
                        <span className={money.mono}>{payment.reference}</span>
                      </>
                    ) : null}
                    {' · '}
                    <time dateTime={payment.recordedAt}>{formatDate(payment.recordedAt)}</time>
                  </>
                }
                amount={formatMoneyOrDash(payment.amount)}
                status={
                  <StatusChip
                    label={paymentStatusLabel(payment.status)}
                    tone={statusTone(payment.status)}
                  />
                }
              />
            ))}
          </ActivityList>
          <p className={`${ui.muted} ${money.footnote}`}>
            Showing the most recent {rows.length} payments.
          </p>
        </>
      )}
    </MoneyPanel>
  );
}
