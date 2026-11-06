import { expect, it } from 'vitest';
import type { AfHomesPrincipal } from './afhomes-access.js';
import { projectAnalytics, type AnalyticsInput } from './analytics-projection.js';

it('groups a large same-plan/scheme sale history with linear iteration work and exact totals', () => {
  const count = 1000;
  const input: AnalyticsInput = {
    principal: { userId: 'synthetic-admin', roleSlug: 'super_admin' } as AfHomesPrincipal,
    period: 'month', from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-12-01T00:00:00Z'), kind: 'global',
    scoped: { sales: Array.from({ length: count }, (_, n) => ({ id: `sale-${n}`, status: 'active', plan_id: 'plan', payment_scheme: 'spot_cash', cash_price_snapshot: '1.00', created_at: '2026-11-02T00:00:00.000Z' })), attributed: count, legacy: [] },
    canCommissions: false, canRedemption: false, allCustomers: [], plans: [{ id: 'plan', name: 'Synthetic Plan' }], paymentsAll: [], membershipsAll: [], commissionsAll: [], redemptionsAll: [], sellers: null, organizationStaff: [], organizationDepartments: [], networkContext: null,
  };
  input.scoped.sales.forEach(Object.freeze);
  Object.freeze(input.scoped.sales);
  let yielded = 0;
  const original = Array.prototype[Symbol.iterator];
  Array.prototype[Symbol.iterator] = function (this: unknown[]) {
    const iterator = original.call(this);
    const next = iterator.next.bind(iterator);
    iterator.next = () => { const result = next(); if (!result.done) yielded++; return result; };
    return iterator;
  };
  let result: ReturnType<typeof projectAnalytics>;
  try { result = projectAnalytics(input); } finally { Array.prototype[Symbol.iterator] = original; }
  expect(result.salesByPlan).toEqual([{ planId: 'plan', planName: 'Synthetic Plan', count, value: '1000.00' }]);
  expect(result.salesByScheme).toEqual([{ scheme: 'spot_cash', count, value: '1000.00' }]);
  // Counts actual iteration work, avoiding a machine-dependent elapsed-time assertion.
  expect(yielded).toBeLessThan(count * 50);
});
