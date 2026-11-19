import { protectedRequest } from '../../lib/api/client';
import { describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import { recordPurchaseReceipt, issueEarningClaim } from './points-services';

vi.mock('../../lib/api/client', () => ({
  protectedRequest: vi.fn(async (_path: string, schema: ZodType) =>
    schema.parse({
      paymentId: '00000000-0000-4000-8000-000000000001',
      paymentNumber: 'QA-PAYMENT',
      amount: '2000.00',
      status: 'recorded',
    }),
  ),
  protectedRequestList: vi.fn(),
}));

describe('Operational Services receipt response', () => {
  it('accepts the write receipt returned by the API without requiring history fields', async () => {
    await expect(
      recordPurchaseReceipt({
        purchaseId: '00000000-0000-4000-8000-000000000002',
        amount: '2000.00',
        method: 'cash',
      }),
    ).resolves.toEqual({
      paymentId: '00000000-0000-4000-8000-000000000001',
      paymentNumber: 'QA-PAYMENT',
      amount: '2000.00',
      status: 'recorded',
    });
  });
});
it('accepts a newly issued claim before any customer award exists', async () => {
  const response = {
    claimId: '00000000-0000-4000-8000-000000000003',
    claimNumber: 'QA-EARN',
    qrToken: 'synthetic-qr',
    fallbackCode: 'QA-CODE',
    pointsRequested: 1000,
    pointsReserved: 1000,
    pointsCapped: 0,
    expiresAt: '2026-10-13T00:00:00Z',
  };
  vi.mocked(protectedRequest).mockImplementationOnce(async (_path, schema) =>
    schema.parse(response),
  );
  await expect(issueEarningClaim('00000000-0000-4000-8000-000000000002')).resolves.toEqual(
    response,
  );
});
