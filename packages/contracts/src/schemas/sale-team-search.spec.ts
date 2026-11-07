import { expect, it } from 'vitest';
import { publicSaleTeamSearchResultSchema, saleTeamSearchRevealSchema } from './sale-team.js';

it('rejects raw names and historical records from the public search response', () => {
  const record = {
    aaNumber: 'AAI26100001',
    kind: 'IST',
    status: 'accredited',
    maskedName: 'Juan S*****',
    expiresOn: null,
    photoUrl: null,
  };
  expect(publicSaleTeamSearchResultSchema.safeParse(record).success).toBe(true);
  expect(
    publicSaleTeamSearchResultSchema.safeParse({ ...record, fullName: 'Juan Seller' }).success,
  ).toBe(false);
  expect(
    publicSaleTeamSearchResultSchema.safeParse({ ...record, status: 'superseded' }).success,
  ).toBe(false);
});
it('requires acknowledgment and contact details or a signed receipt', () => {
  const body = {
    sessionId: '11111111-1111-4111-8111-111111111111',
    searchToken: 'token',
    noticeVersion: 'v1',
    acknowledged: true,
  };
  expect(saleTeamSearchRevealSchema.safeParse(body).success).toBe(false);
  expect(saleTeamSearchRevealSchema.safeParse({ ...body, contactReceipt: 'receipt' }).success).toBe(
    true,
  );
  expect(
    saleTeamSearchRevealSchema.safeParse({
      ...body,
      acknowledged: false,
      contactReceipt: 'receipt',
    }).success,
  ).toBe(false);
});
