import { expect, it } from 'vitest';
import { gsdActiveVipLookupFromDirectory } from './member-lookup.js';

const member = {
  first_name: 'SYNTHETIC', last_name: 'MEMBER', tier: 'GOLD',
  expires_at: '2099-01-01T00:00:00Z', available_points: 7000,
  weekday_available_points: 6300, weekend_available_points: 700,
};
it('shows the persisted allowances after spending instead of splitting the remaining total again', async () => {
  expect(await gsdActiveVipLookupFromDirectory(member)).toMatchObject({
    totalAvailablePoints: 7000, weekdayAvailablePoints: 6300, weekendAvailablePoints: 700,
  });
});
it('does not invent allowances when an old read model has no bucket balances', async () => {
  expect(await gsdActiveVipLookupFromDirectory({ ...member, weekday_available_points: undefined })).toMatchObject({ weekdayAvailablePoints: null, totalAvailablePoints: 7000 });
});
it('returns the full Unicode surname for the authorized staff lookup', async () => {
  const result = await gsdActiveVipLookupFromDirectory({ ...member, last_name: 'N\u0303ANDU' });
  expect(result?.lastName).toBe('N\u0303ANDU');
  expect(result).not.toHaveProperty('maskedLastName');
  expect(JSON.stringify(result)).toContain('ANDU');
});
