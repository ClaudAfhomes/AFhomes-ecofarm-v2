import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { splitStayPoints } from '@afhomes/shared';

export function pointInteger(value: unknown): bigint {
  const text = String(value ?? 0);
  if (!/^-?\d+$/.test(text))
    throw new CustomerActivationError(409, 'Points configuration requires review');
  const integer = BigInt(text);
  if (integer > BigInt(Number.MAX_SAFE_INTEGER) || integer < BigInt(Number.MIN_SAFE_INTEGER))
    throw new CustomerActivationError(409, 'Points range requires review');
  return integer;
}

// Mirrors private.attribute_point_allowances: signed 30% rounding, remainder to weekdays.
export function splitPointAllowance(amount: bigint) {
  const split = splitStayPoints(Number(pointInteger(amount < 0n ? -amount : amount)));
  const weekend = (amount < 0n ? -1n : 1n) * BigInt(split.weekend);
  return { weekday: amount - weekend, weekend };
}

export function pointAllowanceChange(account: MongoRow, amount: bigint, reset = false) {
  const weekday = pointInteger(account.weekday_balance),
    weekend = pointInteger(account.weekend_balance);
  if (weekday + weekend !== pointInteger(account.balance) - pointInteger(account.reversal_debt))
    throw new CustomerActivationError(
      409,
      'Points day allowances require repair before recording points',
    );
  const weekendDelta = reset
    ? splitPointAllowance(weekday + weekend + amount).weekend - weekend
    : splitPointAllowance(amount).weekend;
  const weekdayDelta = amount - weekendDelta;
  return {
    weekday_delta: Number(pointInteger(weekdayDelta)),
    weekend_delta: Number(pointInteger(weekendDelta)),
    weekday_balance: Number(pointInteger(weekday + weekdayDelta)),
    weekend_balance: Number(pointInteger(weekend + weekendDelta)),
  };
}
