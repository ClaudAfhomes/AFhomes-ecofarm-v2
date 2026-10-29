import { expect, it } from 'vitest';
import { pointAllowanceChange, splitPointAllowance } from './point-allowances.mongo.js';

it.each([
  [1n, 1n, 0n],
  [2n, 1n, 1n],
  [5n, 3n, 2n],
  [101n, 71n, 30n],
  [-1n, -1n, 0n],
  [-5n, -3n, -2n],
])('allocates signed whole points exactly like PostgreSQL for %s', (amount, weekday, weekend) => {
  expect(splitPointAllowance(amount)).toEqual({ weekday, weekend });
});
it('preserves previously spent buckets rather than re-splitting the remaining balance', () => {
  expect(
    pointAllowanceChange(
      { _id: 'synthetic', balance: 70, reversal_debt: 0, weekday_balance: 63, weekend_balance: 7 },
      10n,
    ),
  ).toEqual({ weekday_delta: 7, weekend_delta: 3, weekday_balance: 70, weekend_balance: 10 });
});
it('refuses a pre-existing mismatch instead of inventing day balances', () => {
  expect(() =>
    pointAllowanceChange(
      { _id: 'synthetic', balance: 100, reversal_debt: 0, weekday_balance: 0, weekend_balance: 0 },
      10n,
    ),
  ).toThrow('require repair');
});
