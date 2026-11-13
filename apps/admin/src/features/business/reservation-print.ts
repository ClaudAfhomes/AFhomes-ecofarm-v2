import { printApplicationPages } from './application-print';
import { applicationRaDraftSchema, type ApplicationRaDraft } from '@afhomes/contracts';
import {
  paymentSchemeLabel,
  type ApplicationHolder,
  type CardProduct,
  type PaymentScheme,
  type ReservationAgreement,
} from '@afhomes/contracts';
import { formatMoneyOrDash, formatCountOrDash } from '@afhomes/shared';
import { applicationPdf, renderPaperRows, type PaperRow } from './application-print';

type Holder = {
  name: string;
  address: string;
  contactNumber: string;
  email: string;
  tinNumber?: string;
};
type ReservationPaper = {
  draft?: ApplicationRaDraft;
  tier: string;
  primary: Holder;
  secondary: Holder | null;
  paymentScheme: PaymentScheme;
  plan?: CardProduct;
  agreement?: Omit<ReservationAgreement, 'saleId'>;
};
const blank = '____________________';
const field = (label: string, value?: string | null) => ({ label, value: value?.trim() || blank });
const money = (value?: string | null) => (value == null ? blank : formatMoneyOrDash(value));
const toHolder = (holder: ApplicationHolder): Holder => ({
  name: [holder.prefix, holder.firstName, holder.middleName, holder.lastName, holder.suffix]
    .filter(Boolean)
    .join(' '),
  address: [
    holder.permanentAddressLine1,
    holder.permanentAddressLine2,
    holder.barangay,
    holder.cityMunicipality,
    holder.province,
    holder.postalCode,
  ]
    .filter(Boolean)
    .join(', '),
  contactNumber: holder.mobile,
  email: holder.email,
  tinNumber: holder.tinNumber,
});

export function draftReservationPaper(
  primary: ApplicationHolder,
  secondary: ApplicationHolder | null,
  tier: string,
  paymentScheme: PaymentScheme,
  plan?: CardProduct,
  draft?: ApplicationRaDraft,
): ReservationPaper {
  return {
    draft,
    primary: toHolder(primary),
    secondary: tier === 'GOLD' && secondary ? toHolder(secondary) : null,
    tier,
    paymentScheme,
    plan,
  };
}

export function savedReservationPaper(
  agreement: Omit<ReservationAgreement, 'saleId'>,
): ReservationPaper {
  // Saved agreement snapshots are authoritative; never read today's plan to rebuild history.
  return {
    primary: agreement.primary,
    secondary: agreement.tier === 'GOLD' ? (agreement.secondary ?? null) : null,
    tier: agreement.tier,
    paymentScheme: agreement.paymentScheme,
    agreement,
  };
}

/** Layout follows the supplied tier forms; photographs do not override commercial terms. */
export function reservationPaperRows(data: ReservationPaper): PaperRow[] {
  const a = data.agreement;
  const d = a ?? data.draft;
  const benefits = a ?? data.plan;
  const rows: PaperRow[] = [];
  const heading = (text: string) => rows.push({ heading: text });
  const cells = (...values: ReturnType<typeof field>[]) => rows.push({ cells: values });
  cells(
    field('Reservation date', d?.reservationDate),
    field('Official Reservation Agreement Number', a?.reservationNumber),
    field('Revision', d?.revisionNumber),
    field('Agreement date', d?.agreementDate),
  );
  if (!a && data.draft?.reservationNumber) cells(field('Legacy proposed reference (not official)', data.draft.reservationNumber));
  heading('RESERVATION FEE PAYMENT DETAILS');
  cells(
    field('Required reservation fee', money(d?.reservationFee)),
    field('Date of payment', data.draft?.reservationPaymentDate),
    field('Payment method', data.draft?.paymentMethod),
  );
  cells(
    field('Required down payment (not a receipt)', money(d?.downPayment)),
    field('Date of payment', data.draft?.downPaymentDate),
    field('Payment reference', data.draft?.paymentReference),
  );
  cells(field(a ? 'Verified total payment received' : 'Reported payment received (unverified)', money(a?.totalPaymentReceived ?? data.draft?.reportedPaymentReceived)));
  const holder = (value: Holder | null, label: string) => {
    heading(label);
    cells(field('Name', value?.name));
    cells(field('Address', value?.address));
    cells(
      field('Contact number', value?.contactNumber),
      field('Email address', value?.email),
      field('TIN', value?.tinNumber),
    );
  };
  holder(data.primary, 'PRIMARY CARDHOLDER DETAILS');
  holder(data.secondary, 'SUPPLEMENTARY CARDHOLDER DETAILS · GOLD OPTIONAL');
  heading('VIP PRIVILEGE CARD DETAILS');
  cells(
    field('Program type', data.tier),
    field('Payment terms', paymentSchemeLabel(data.paymentScheme)),
  );
  if (benefits) {
    cells(
      field('Discount', `${benefits.discountPercent}%`),
      field('Cardholders', String(a?.holderLimit ?? data.plan?.cardholderLimit)),
      field(
        'Validity',
        a
          ? `${a.validityYears} years`
          : `${data.plan!.baseValidityYears} + ${data.plan!.validityExtensionYears} years`,
      ),
    );
    cells(
      field(
        'Annual loyalty stay points',
        `${formatCountOrDash(benefits.yearlyPoints)} / year × ${benefits.annualPointsTranches} tranches`,
      ),
    );
    if (data.plan && !a) {
      cells(
        field('Priority reservation', data.plan.priorityReservation ? 'Included' : 'Not included'),
        field(
          'Monthly / annual dues',
          data.plan.noMonthlyAnnualDues ? 'None' : 'See approved terms',
        ),
      );
      cells(field('Total loyalty value (not purchase price)', money(data.plan.totalLoyaltyValue)));
    }
    if (a) {
      cells(
        field(
          'Priority reservation',
          typeof a.inclusions.priorityReservation === 'boolean'
            ? a.inclusions.priorityReservation
              ? 'Included'
              : 'Not included'
            : undefined,
        ),
        field(
          'Monthly / annual dues',
          typeof a.inclusions.noMonthlyAnnualDues === 'boolean'
            ? a.inclusions.noMonthlyAnnualDues
              ? 'None'
              : 'See agreement terms'
            : undefined,
        ),
      );
    }
  }
  heading('PAYMENT PLAN SUMMARY');
  cells(
    field('Particular', 'TOTAL PRICE'),
    field('Amount', money(d?.totalPrice)),
    field('Date of payment'),
    field('Remarks', a ? 'Frozen agreement terms' : 'Awaiting approved reservation'),
  );
  cells(
    field('Particular', 'RESERVATION FEE (included in price)'),
    field('Amount', money(d?.reservationFee)),
    field('Date of payment', data.draft?.reservationPaymentDate),
    field('Remarks'),
  );
  cells(
    field('Particular', 'REQUIRED DOWN PAYMENT'),
    field('Amount', money(d?.downPayment)),
    field('Date of payment', data.draft?.downPaymentDate),
    field('Remarks', 'Required amount; not evidence of payment'),
  );
  cells(
    field('Particular', 'BALANCE'),
    field('Amount', money(d?.balance)),
    field('Date of payment'),
    field('Remarks'),
  );
  cells(
    field('Monthly amortization', money(d?.monthlyAmortization)),
    field('Months', d?.installmentMonths?.toString()),
    field('Start date', d?.monthlyAmortizationStart),
    field('End date', d?.monthlyAmortizationEnd),
  );
  cells(field('Payment due day of month', d?.paymentDueDay?.toString()));
  for (const line of a?.schedule ?? [])
    cells(
      field(`Schedule ${line.lineNumber}: ${line.particular}`, money(line.amount)),
      field('Scheduled date (not payment verification)', line.paymentDate),
      field('Remarks'),
    );
  heading('DECLARATION');
  cells(
    field(
      'For signing by the cardholder',
      'I/We declare that the information in this Reservation Agreement is true, correct and complete to the best of my/our knowledge. I/We acknowledge reviewing the VIP Privilege Card Program and payment plan summary and agree to the pricing, payment terms and related conditions indicated above.',
    ),
  );
  cells(
    field(
      'Document status',
      a
        ? `Reservation status: ${a.status}. Signature and payment fields are not verification.`
        : 'PRELIMINARY FORM ONLY. Entered terms and numbers are proposals only; payments are unverified and signatures are blank.',
    ),
  );
  rows.push({ signature: true });
  return rows;
}

async function renderReservationPaper(data: ReservationPaper) {
  if (data.draft) applicationRaDraftSchema.parse(data.draft);
  return renderPaperRows(reservationPaperRows(data), {
    compact: true,
    title: `${data.tier} VIP · RESERVATION AGREEMENT`,
    footer: data.agreement
      ? 'Reservation Agreement · Unsigned copy · See recorded payment verification'
      : 'Preliminary Reservation Agreement · Not submitted, approved or paid · Unsigned',
    secondary: data.tier === 'GOLD' && Boolean(data.secondary),
  });
}

export async function printReservation(data: ReservationPaper) {
  await printApplicationPages(await renderReservationPaper(data), 'AFhomes Reservation Agreement');
}

export async function reservationPdf(data: ReservationPaper) {
  return applicationPdf(
    await renderReservationPaper(data),
    `${data.agreement?.reservationNumber ?? `AFhomes-${data.tier}-RA-Preview`}.pdf`,
  );
}
