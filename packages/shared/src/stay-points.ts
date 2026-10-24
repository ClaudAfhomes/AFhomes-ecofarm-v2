/** Whole points: round the 30% weekend portion, keep the remainder for weekdays. */
export function splitStayPoints(total: number) {
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('Invalid whole-points balance');
  const weekend = Number((BigInt(total) * 30n + 50n) / 100n);
  return { total, weekday: total - weekend, weekend };
}
