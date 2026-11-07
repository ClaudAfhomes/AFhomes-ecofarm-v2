import { describe, expect, it } from 'vitest';
import type { GenealogyNode } from '@afhomes/contracts';

import { chainOptions } from './official-forms-fields';

const node = (overrides: Partial<GenealogyNode> & { staffId: string }): GenealogyNode => ({
  fullName: 'QA Member',
  role: 'sales_manager',
  status: 'active',
  ostStatus: null,
  uplineStaffId: null,
  directDownlineCount: 0,
  totalDescendantCount: 0,
  ...overrides,
});

// VD vd1 -> SSM ssm1 -> SM sm1 -> OST ost1, plus an unrelated VD vd2 with its
// own SSM ssm2. Statuses vary so the active filter has something to refuse.
const VD1 = '11111111-1111-4111-8111-111111111111';
const VD2 = '22222222-2222-4222-8222-222222222222';
const SSM1 = '33333333-3333-4333-8333-333333333333';
const SSM2 = '44444444-4444-4334-8334-444444444434';
const SM1 = '55555555-5555-4555-8555-555555555555';
const SM2 = '66666666-6666-4666-8666-666666666666';
const OST1 = '77777777-7777-4777-8777-777777777777';
const nodes: GenealogyNode[] = [
  node({ staffId: VD1, fullName: 'Victor Director', role: 'vice_director' }),
  node({ staffId: VD2, fullName: 'Vera Director', role: 'vice_director' }),
  node({ staffId: SSM1, fullName: 'Sam Senior', role: 'senior_sales_manager', uplineStaffId: VD1 }),
  node({
    staffId: SSM2,
    fullName: 'Sue Senior',
    role: 'senior_sales_manager',
    uplineStaffId: VD2,
  }),
  node({ staffId: SM1, fullName: 'Max Manager', role: 'sales_manager', uplineStaffId: SSM1 }),
  node({
    staffId: SM2,
    fullName: 'Mia Manager',
    role: 'sales_manager',
    uplineStaffId: SSM1,
    status: 'suspended',
  }),
  node({ staffId: OST1, fullName: 'Omar Ost', role: 'ost', uplineStaffId: SM1, ostStatus: 'active' }),
];

describe('chainOptions', () => {
  it('lists every active seller of the level with no upline chosen', () => {
    expect(chainOptions(nodes, 'vice_director', null).map((n) => n.staffId)).toEqual([VD1, VD2]);
    expect(chainOptions(nodes, 'senior_sales_manager', null).map((n) => n.staffId)).toEqual([
      SSM1,
      SSM2,
    ]);
  });

  it('limits each level to the chosen upline downline', () => {
    expect(chainOptions(nodes, 'senior_sales_manager', VD1).map((n) => n.staffId)).toEqual([SSM1]);
    expect(chainOptions(nodes, 'sales_manager', SSM1).map((n) => n.staffId)).toEqual([SM1]);
    expect(chainOptions(nodes, 'ost', SM1).map((n) => n.staffId)).toEqual([OST1]);
  });

  it('walks past gaps: an SM under an SVD lists without naming the SSM', () => {
    expect(chainOptions(nodes, 'sales_manager', VD1).map((n) => n.staffId)).toEqual([SM1]);
    expect(chainOptions(nodes, 'ost', VD1).map((n) => n.staffId)).toEqual([OST1]);
  });

  it('refuses inactive staff and mismatched roles', () => {
    // Suspended Mia never lists, even under her own SSM.
    expect(chainOptions(nodes, 'sales_manager', SSM1).map((n) => n.staffId)).toEqual([SM1]);
    expect(chainOptions(nodes, 'ost', VD1).map((n) => n.staffId)).toEqual([OST1]);
    expect(chainOptions(nodes, 'vice_director', OST1)).toEqual([]);
  });

  it('ignores an OST whose accreditation lapsed', () => {
    const lapsed = nodes.map((n) =>
      n.staffId === OST1 ? { ...n, ostStatus: 'suspended' as const } : n,
    );
    expect(chainOptions(lapsed, 'ost', SM1)).toEqual([]);
  });

  it('stops on a cycle instead of looping', () => {
    const looped = nodes.map((n) =>
      n.staffId === VD1 ? { ...n, uplineStaffId: SSM1 } : n,
    );
    expect(chainOptions(looped, 'senior_sales_manager', VD1).map((n) => n.staffId)).toEqual([
      SSM1,
    ]);
  });
});
