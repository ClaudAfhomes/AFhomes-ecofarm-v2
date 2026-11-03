import { expect, it } from 'vitest';
import { planMigrationCounters } from './migration-counters.js';

const fixture = () => ({
  company: [{ issue_year: 2026, last_issued: 8 }],
  accreditation: [{ accreditation_month: '2026-10-01', last_value: 9 }],
  target: [
    { _id: 'company-customer:2026', seq: 20 },
    { _id: 'unrelated', seq: 5 },
  ],
  issued: {
    company: ['2026-0012', 'AF-CUS-2025-000017'],
    accreditation: ['AAI26100010', 'AAO26100014'],
    vip: ['26100100039G1C01N', '26100200012S1T12S'],
  },
});

it('takes the maximum of source counters, both AA kinds, retained numbers and native counters without changing input', () => {
  const input = fixture(),
    saved = structuredClone(input);
  const plan = planMigrationCounters(input);
  expect(plan.issues).toEqual([]);
  expect(plan.changes).toEqual([
    { _id: 'company-customer:2025', previous: null, seq: 17 },
    { _id: 'sale-team-aa:2610', previous: null, seq: 14 },
    { _id: 'vip-card-number', previous: null, seq: 39 },
  ]);
  expect(input).toEqual(saved);
  input.target.push(...plan.changes.map(({ _id, seq }) => ({ _id, seq })));
  expect(planMigrationCounters(input).changes).toEqual([]);
  expect(planMigrationCounters(input).digest).not.toBe(plan.digest);
});

it('blocks invalid, duplicate and century-colliding source counters without partial output', () => {
  for (const mutate of [
    (input: ReturnType<typeof fixture>) => {
      input.company[0]!.last_issued = -1;
    },
    (input: ReturnType<typeof fixture>) => {
      input.company[0]!.last_issued = 2147483648;
    },
    (input: ReturnType<typeof fixture>) => {
      input.company.push(...input.company);
    },
    (input: ReturnType<typeof fixture>) => {
      input.accreditation[0]!.accreditation_month = '2026-02-30';
    },
    (input: ReturnType<typeof fixture>) => {
      input.accreditation.push({ accreditation_month: '2126-10-01', last_value: 3 });
    },
    (input: ReturnType<typeof fixture>) => {
      input.target.push({ _id: 'sale-team-aa:2610', seq: 10000 });
    },
    (input: ReturnType<typeof fixture>) => {
      input.target.push(...input.target);
    },
  ]) {
    const input = fixture();
    mutate(input);
    expect(planMigrationCounters(input)).toMatchObject({ ready: false, changes: [] });
  }
});

it('blocks malformed or already-rounded identifier evidence', () => {
  for (const [kind, value] of [
    ['company', '2026-999999999999999999'],
    ['company', '0000-0001'],
    ['accreditation', 'AAO26130001'],
    ['accreditation', 'AAI26100000'],
    ['vip', '26100100039G1C01X'],
  ] as const) {
    const input = fixture();
    input.issued[kind].push(value);
    expect(planMigrationCounters(input)).toMatchObject({ ready: false, changes: [] });
  }
});

it('validates existing native counter bounds even when the source has no corresponding numbers', () => {
  expect(
    planMigrationCounters({
      company: [],
      accreditation: [],
      issued: { company: [], accreditation: [], vip: [] },
      target: [{ _id: 'vip-card-number', seq: 100000 }],
    }),
  ).toMatchObject({ ready: false, changes: [] });
  const input = fixture();
  input.target.push({ _id: 'vip-card-number', seq: 80 }, { _id: 'sale-team-aa:2610', seq: 99 });
  expect(planMigrationCounters(input).changes).toEqual([
    { _id: 'company-customer:2025', previous: null, seq: 17 },
  ]);
});
