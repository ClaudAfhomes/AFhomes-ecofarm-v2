import { expect, it } from 'vitest';
import { splitStayPoints } from './stay-points.js';

it.each([[10000, 7000, 3000], [0, 0, 0], [5, 3, 2], [1000000000, 700000000, 300000000]])(
  'splits %i whole points without losing points', (total, weekday, weekend) => {
    expect(splitStayPoints(total)).toEqual({ total, weekday, weekend });
  },
);
it.each([-1, 1.5, NaN, Infinity])('rejects invalid balance %s', total => {
  expect(() => splitStayPoints(total)).toThrow();
});
