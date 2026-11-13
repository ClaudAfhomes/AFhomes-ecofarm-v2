/**
 * Queue row shaping: authoritative status, tier and activation readiness.
 */
import { describe, expect, it } from 'vitest';
import { financeQueueItemSchema } from '@afhomes/contracts';

import { shape, type QueueRow } from './queue-model.js';

const row = (over: Partial<QueueRow> = {}): QueueRow => ({
  id: 'bbbbbbbb-0000-4000-8000-000000000001',
  sale_number: 'SALE-1',
  status: 'payment_verified',
  cash_price_snapshot: '60000.00',
  minimum_down_payment_snapshot: '0.00',
  payment_scheme: 'spot_cash',
  reservation_fee_snapshot: '0.00',
  required_initial_snapshot: '0.00',
  installment_months_snapshot: null,
  monthly_amount_snapshot: null,
  validity_months_snapshot: null,
  spot_cash_started_at: null,
  spot_cash_deadline: null,
  customer_id: 'aaaaaaaa-0000-4000-8000-000000000001',
  customerName: 'Ana',
  productName: 'Premium Gold Plan',
  planCode: 'silver',
  payments: [{ amount: '60000.00', status: 'verified' }],
  ...over,
});

describe('queue-model shape', () => {
  it('produces a contract-valid row', () => {
    expect(financeQueueItemSchema.safeParse(shape(row())).success).toBe(true);
  });

  it('takes the tier from the plan code, never the product name', () => {
    expect(shape(row()).tier).toBe('SILVER');
    expect(shape(row({ planCode: 'custom-plan' })).tier).toBeNull();
    expect(shape(row({ planCode: null })).tier).toBeNull();
  });

  it('fails loudly on a status outside the lifecycle instead of coercing it', () => {
    expect(() => shape(row({ status: 'paid' }))).toThrow(/unsupported lifecycle status "paid"/);
  });

  it('keeps activatable and activationBlocker on the single readiness rule', () => {
    const ready = shape(row());
    expect(ready.activatable).toBe(true);
    expect(ready.activationBlocker).toBeNull();

    const short = shape(row({ payments: [{ amount: '20000.00', status: 'verified' }] }));
    expect(short.activatable).toBe(false);
    expect(short.activationBlocker).toBe('outstanding_balance');

    // Fully paid but still in a payment state: not ready, never "underpaid".
    const notReady = shape(row({ status: 'payment_in_progress' }));
    expect(notReady.fullyPaid).toBe(true);
    expect(notReady.activationBlocker).toBe('not_ready');

    // Recorded or rejected money never counts toward readiness.
    const unverified = shape(
      row({
        payments: [
          { amount: '30000.00', status: 'recorded' },
          { amount: '30000.00', status: 'rejected' },
        ],
      }),
    );
    expect(unverified.activationBlocker).toBe('outstanding_balance');
  });
});
