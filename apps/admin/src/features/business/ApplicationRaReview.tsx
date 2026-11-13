import { useState } from 'react';
import { Button } from '@afhomes/ui';
import {
  type ApplicationRaDraft,
  type CardProduct,
  type PaymentScheme,
  applicationRaDraftSchema,
} from '@afhomes/contracts';
import { subtractMoney, multiplyMoney, divideMoneyExact } from '@afhomes/shared';
import { Field, today } from './official-forms-fields';
import v4 from './CustomerApplicationV4.module.css';

export function suggestedRaTerms(
  plan: CardProduct | undefined,
  scheme: PaymentScheme,
): ApplicationRaDraft {
  if (!plan) return {};
  const totalPrice =
    scheme === 'spot_cash' || scheme === 'move_a' ? plan.cashPrice : plan.installmentPrice;
  const reservationFee = plan.reservationFee;
  const downPayment =
    scheme === 'move_b1_40_12'
      ? multiplyMoney(totalPrice, '0.40')
      : scheme === 'move_b2_25_12'
        ? multiplyMoney(totalPrice, '0.25')
        : reservationFee;
  const balance = subtractMoney(totalPrice, downPayment);
  const installmentMonths =
    scheme === 'spot_cash'
      ? 0
      : scheme === 'move_a'
        ? 4
        : scheme === 'installment_4_month'
          ? plan.standardInstallmentMonths
          : 12;
  let monthlyAmortization: string | undefined;
  try {
    if (installmentMonths) monthlyAmortization = divideMoneyExact(balance, installmentMonths);
  } catch {
    /* Leave inexact schedules for manual document review. */
  }
  return {
    // Dates default to today; the operator edits them to the real document dates.
    reservationDate: today(),
    agreementDate: today(),
    totalPrice,
    reservationFee,
    downPayment,
    balance,
    installmentMonths,
    monthlyAmortization,
  };
}

const fields: [keyof ApplicationRaDraft, string, string?][] = [
  ['reservationDate', 'Reservation date', 'date'],
  ['agreementDate', 'Agreement date', 'date'],
  ['revisionNumber', 'Revision number'],
  ['reservationPaymentDate', 'Reservation fee date of payment', 'date'],
  ['downPaymentDate', 'Down payment date of payment', 'date'],
  ['reportedPaymentReceived', 'Reported payment received (unverified)'],
  ['paymentMethod', 'Mode of payment'],
  ['paymentReference', 'Payment reference number'],
  ['totalPrice', 'Total price'],
  ['reservationFee', 'Reservation fee'],
  ['downPayment', 'Required down payment (includes reservation fee)'],
  ['balance', 'Balance after required down payment'],
  ['monthlyAmortization', 'Monthly amortization'],
  ['installmentMonths', 'Installment months', 'number'],
  ['monthlyAmortizationStart', 'Amortization start date', 'date'],
  ['monthlyAmortizationEnd', 'Amortization end date', 'date'],
  ['paymentDueDay', 'Payment due day of month', 'number'],
];
export function ApplicationRaReview({
  value,
  onChange,
  defaults,
  onDownload,
  onPrint,
  disabled = false,
}: {
  onDownload?: () => Promise<void>;
  onPrint?: () => Promise<void>;
  value: ApplicationRaDraft;
  onChange: (value: ApplicationRaDraft) => void;
  defaults: ApplicationRaDraft;
  disabled?: boolean;
}) {
  const [error, setError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const documentAction = async (action: () => Promise<void>) => {
    setError('');
    setPreparing(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'RA document could not be prepared.');
    } finally {
      setPreparing(false);
    }
  };
  const result = applicationRaDraftSchema.safeParse(value);
  return (
    <section className={v4.reviewbox} aria-label="Reservation Agreement review">
      <h2>Reservation Agreement review</h2>
      <p>
        Preliminary document details. These entries do not verify payments or issue an agreement
        number. Final terms remain subject to approval.
      </p>
      <Button
        variant="secondary"
        disabled={disabled}
        onClick={() => onChange({ ...value, ...defaults })}
      >
        Reset payment summary from selected scheme
      </Button>
      {!defaults.totalPrice && !value.totalPrice ? (
        <p role="status">
          Choose a configured plan to suggest payment terms, or enter proposed terms below.
        </p>
      ) : null}
      <Field label="Official Reservation Agreement Number" value="Pending authorized reservation issuance" readOnly onChange={() => {}} />
      {value.reservationNumber ? <p>Legacy proposed reference: {value.reservationNumber}. This is not an issued RA number.</p> : null}
      <div className={v4.grid2}>
        {fields.map(([key, label, type]) => (
          <Field
            key={key}
            label={label}
            type={type}
            disabled={disabled}
            value={value[key] ?? ''}
            onChange={(raw) =>
              onChange({
                ...value,
                [key]: raw === '' ? undefined : type === 'number' ? Number(raw) : raw,
              })
            }
          />
        ))}
      </div>
      {onPrint ? (
        <Button variant="secondary" disabled={!result.success || preparing} onClick={() => void documentAction(onPrint)}>
          Print RA
        </Button>
      ) : null}
      {onDownload ? (
        <Button
          variant="secondary"
          disabled={!result.success || preparing}
          onClick={() => void documentAction(onDownload)}
        >
          Download RA form
        </Button>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {!result.success && (
        <p role="alert">
          {result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}
        </p>
      )}
    </section>
  );
}
