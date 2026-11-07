import { describe, expect, it } from 'vitest';
import {
  serviceRefundRequestSchema,
  serviceRefundDecisionSchema,
  serviceRefundRepaymentSchema,
} from './service-refunds.js';
const request = {
  serviceValue: '900.00',
  cashAmount: '900.00',
  reference: 'REFUND-LOCAL',
  reason: 'Reviewed eligible service',
  serviceReviewConfirmed: true,
};
describe('external service refund contracts', () => {
  it('keeps refund request separate from repayment', () => {
    expect(serviceRefundRequestSchema.safeParse(request).success).toBe(true);
    expect(serviceRefundRequestSchema.safeParse({ ...request, status: 'completed' }).success).toBe(
      false,
    );
  });
  it('requires explicit service review', () => {
    expect(
      serviceRefundRequestSchema.safeParse({ ...request, serviceReviewConfirmed: false }).success,
    ).toBe(false);
    expect(
      serviceRefundDecisionSchema.safeParse({ decision: 'approve', serviceReviewConfirmed: false })
        .success,
    ).toBe(false);
  });
  it('rejects actor and points overrides', () => {
    expect(serviceRefundRequestSchema.safeParse({ ...request, pointsRestored: 1000 }).success).toBe(
      false,
    );
    expect(
      serviceRefundRepaymentSchema.safeParse({
        amount: '100.00',
        method: 'cash',
        reference: 'REPAY-LOCAL',
        repaidAt: '2026-10-01T00:00:00.000Z',
        recordedBy: 'staff',
      }).success,
    ).toBe(false);
  });
  it('requires external reference, exact amount, date and allowed repayment method', () => {
    const repayment = {
      amount: '100.00',
      method: 'gcash',
      reference: 'EXTERNAL-REF',
      repaidAt: '2026-10-01T00:00:00.000Z',
    };
    expect(serviceRefundRepaymentSchema.safeParse(repayment).success).toBe(true);
    for (const change of [
      { amount: '1.0001' },
      { reference: '' },
      { repaidAt: 'invalid' },
      { method: 'automatic_payout' },
    ])
      expect(serviceRefundRepaymentSchema.safeParse({ ...repayment, ...change }).success).toBe(
        false,
      );
  });
});
