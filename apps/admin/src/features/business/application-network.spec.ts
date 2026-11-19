import { describe, expect, it } from 'vitest';
import type { GenealogyNode } from '@afhomes/contracts';
import { resolveApplicationNetwork } from './application-network';

const node = (
  staffId: string,
  role: GenealogyNode['role'],
  uplineStaffId: string | null,
): GenealogyNode => ({
  staffId,
  role,
  uplineStaffId,
  fullName: staffId,
  status: 'active',
  ostStatus: null,
  directDownlineCount: 0,
  totalDescendantCount: 0,
});
const nodes = [
  node('vd', 'vice_director', null),
  node('ssm', 'senior_sales_manager', 'vd'),
  node('sm', 'sales_manager', 'ssm'),
  node('ost', 'ost', 'sm'),
  node('other-sm', 'sales_manager', 'vd'),
  node('other-ost', 'ost', 'other-sm'),
];

describe('application network from actual genealogy', () => {
  it('resolves the selected OST and its actual direct head and ancestry', () => {
    expect(resolveApplicationNetwork(nodes, 'ost')).toMatchObject({
      head: { staffId: 'sm' },
      chain: { svdStaffId: 'vd', ssmStaffId: 'ssm', smStaffId: 'sm', referrerStaffId: 'ost' },
    });
  });
  it('replaces the entire chain when the selected member changes and preserves real gaps', () => {
    expect(resolveApplicationNetwork(nodes, 'other-ost').chain).toEqual({
      svdStaffId: 'vd',
      ssmStaffId: '',
      smStaffId: 'other-sm',
      referrerStaffId: 'other-ost',
    });
  });
  it('resolves IST without inventing an OST referrer', () => {
    expect(resolveApplicationNetwork(nodes, 'sm')).toMatchObject({
      head: { staffId: 'ssm' },
      chain: { referrerStaffId: '', smStaffId: 'sm' },
    });
  });
  it('keeps a root member without an invented head', () => {
    expect(resolveApplicationNetwork(nodes, 'vd').head).toBeNull();
  });
  it('refuses unavailable, inactive and cyclic relationships', () => {
    expect(() => resolveApplicationNetwork(nodes, 'missing')).toThrow();
    expect(() =>
      resolveApplicationNetwork(
        nodes.filter((n) => n.staffId !== 'sm'),
        'ost',
      ),
    ).toThrow();
    expect(() =>
      resolveApplicationNetwork(
        nodes.map((n) => (n.staffId === 'sm' ? { ...n, status: 'inactive' } : n)),
        'ost',
      ),
    ).toThrow();
    expect(() =>
      resolveApplicationNetwork(
        nodes.map((n) => (n.staffId === 'vd' ? { ...n, uplineStaffId: 'ost' } : n)),
        'ost',
      ),
    ).toThrow();
  });
});
