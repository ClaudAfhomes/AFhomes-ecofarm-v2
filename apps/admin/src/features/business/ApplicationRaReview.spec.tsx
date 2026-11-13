import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { ApplicationRaReview, suggestedRaTerms } from './ApplicationRaReview';
import { applicationRaDraftSchema, type CardProduct } from '@afhomes/contracts';
const plan = {
  cashPrice: '100000.00',
  installmentPrice: '130000.00',
  reservationFee: '10000.00',
  standardInstallmentMonths: 4,
} as CardProduct;
describe('preliminary RA review', () => {
 it('keeps official issuance pending and preserves a separately labelled legacy proposal', () => {
  renderWithProviders(<ApplicationRaReview value={{reservationNumber:'OLD-DRAFT'}} defaults={{}} onChange={vi.fn()} />);
  expect(screen.getByLabelText('Official Reservation Agreement Number')).toHaveValue('Pending authorized reservation issuance');
  expect(screen.getByLabelText('Official Reservation Agreement Number')).toHaveAttribute('readonly');
  expect(screen.getByText(/Legacy proposed reference: OLD-DRAFT/)).toBeVisible();
 });
  it('prints without submitting or changing the document and reports print errors', async () => {
    const onPrint = vi.fn().mockRejectedValueOnce(new Error('Printer unavailable')).mockResolvedValueOnce(undefined);
    const onChange = vi.fn();
    renderWithProviders(<form onSubmit={e => { e.preventDefault(); throw new Error('Unexpected submission'); }}><ApplicationRaReview value={{ reservationNumber: 'PROPOSED' }} defaults={{}} onChange={onChange} onPrint={onPrint} /></form>);
    fireEvent.click(screen.getByRole('button', { name: 'Print RA' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Printer unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Print RA' }));
    await waitFor(() => expect(onPrint).toHaveBeenCalledTimes(2));
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
  it('uses exact selected scheme terms and includes the reservation fee in the initial amount', () => {
    expect(suggestedRaTerms(plan, 'move_b1_40_12')).toMatchObject({
      totalPrice: '130000.00',
      downPayment: '52000.00',
      balance: '78000.00',
      monthlyAmortization: '6500.00',
      installmentMonths: 12,
    });
    expect(suggestedRaTerms(plan, 'move_a')).toMatchObject({
      totalPrice: '100000.00',
      monthlyAmortization: '22500.00',
      installmentMonths: 4,
    });
    expect(suggestedRaTerms(plan, 'spot_cash').monthlyAmortization).toBeUndefined();
  });
  it('allows incomplete dates but rejects invalid dates, money and due days', () => {
    expect(applicationRaDraftSchema.safeParse({}).success).toBe(true);
    for (const value of [
      { reservationDate: '2026-02-30' },
      { totalPrice: '-1.00' },
      { paymentDueDay: 32 },
    ])
      expect(applicationRaDraftSchema.safeParse(value).success).toBe(false);
  });

  it('defaults the reservation and agreement dates to today', () => {
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const iso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    expect(suggestedRaTerms(plan, 'spot_cash')).toMatchObject({
      reservationDate: iso,
      agreementDate: iso,
    });
  });
  it('edits document dates and can restore scheme suggestions without submitting', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <ApplicationRaReview
        value={{ paymentReference: 'LOCAL' }}
        defaults={suggestedRaTerms(plan, 'move_a')}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('Reservation date'), {
      target: { value: '2026-11-08' },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      paymentReference: 'LOCAL',
      reservationDate: '2026-11-08',
    });
    fireEvent.click(screen.getByRole('button', { name: /Reset payment summary/ }));
    expect(onChange.mock.lastCall?.[0]).toMatchObject({
      paymentReference: 'LOCAL',
      totalPrice: '100000.00',
    });
  });
});
