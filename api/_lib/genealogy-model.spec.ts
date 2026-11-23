import { describe, expect, it } from 'vitest';
import { projectGenealogy, type GenealogyInput } from './genealogy-model.js';

const ROLES = [
  { id: 'r-vd', slug: 'vice_director' },
  { id: 'r-sm', slug: 'sales_manager' },
  { id: 'r-ost', slug: 'ost' },
];
function wideTree(children: number): GenealogyInput {
  const ids = Array.from({ length: children }, (_, i) => `ost-${String(i).padStart(6, '0')}`);
  return {
    staff: [
      { id: 'vd', full_name: 'VD', status: 'active' },
      { id: 'sm', full_name: 'SM', status: 'active' },
      ...ids.map((id) => ({ id, full_name: id, status: 'active' as const })),
    ],
    assign: [
      { staff_id: 'vd', role_id: 'r-vd' },
      { staff_id: 'sm', role_id: 'r-sm' },
      ...ids.map((id) => ({ staff_id: id, role_id: 'r-ost' })),
    ],
    roles: ROLES,
    rels: [
      { subject_staff_id: 'sm', upline_staff_id: 'vd', is_active: true },
      ...ids.map((id) => ({ subject_staff_id: id, upline_staff_id: 'sm', is_active: true })),
    ],
    ost: ids.map((id) => ({ id, status: 'active' as const })),
  };
}

describe('genealogy projection on very wide and deep trees', () => {
  it('processes a 150,000-member flat downline without stack overflow and within bounds', () => {
    const input = wideTree(150_000);
    globalThis.gc?.();
    const heapBefore = process.memoryUsage().heapUsed;
    const started = performance.now();
    const graph = projectGenealogy(input, { userId: 'sm', roleSlug: 'sales_manager' });
    const elapsed = performance.now() - started;
    const heapGrowth = process.memoryUsage().heapUsed - heapBefore;
    const sm = graph.nodes.find((node) => node.staffId === 'sm')!;
    expect(sm.directDownlineCount).toBe(150_000);
    // descendants() and the count both keep the established 10,000 cap.
    expect(sm.totalDescendantCount).toBe(10_000);
    expect(graph.descendants('sm')).toHaveLength(10_000);
    expect(graph.nodes.find((node) => node.staffId === 'vd')!.totalDescendantCount).toBe(10_000);
    // The caller sees itself, its upline and the capped descendant list.
    expect(graph.visible.size).toBe(10_002);
    expect(elapsed).toBeLessThan(5_000);
    expect(heapGrowth).toBeLessThan(400 * 1024 * 1024);
  });

  it('walks a 20,000-level chain of inactive heads without recursion limits', () => {
    const depth = 20_000;
    const ids = Array.from({ length: depth }, (_, i) => `n${i}`);
    const input: GenealogyInput = {
      staff: ids.map((id, i) => ({
        id,
        full_name: id,
        status: i === 0 || i === depth - 1 ? 'active' : 'inactive',
      })),
      assign: ids.map((id, i) => ({ staff_id: id, role_id: i === 0 ? 'r-vd' : 'r-ost' })),
      roles: ROLES,
      rels: ids.slice(1).map((id, i) => ({
        subject_staff_id: id,
        upline_staff_id: ids[i]!,
        is_active: true,
      })),
      ost: [],
    };
    const graph = projectGenealogy(input, { userId: 'n0', roleSlug: 'super_admin' });
    // Every member's display head is the nearest ACTIVE ancestor: n0, through all inactive heads.
    expect(graph.nodes.find((node) => node.staffId === `n${depth - 1}`)!.uplineStaffId).toBe('n0');
    const head = graph.nodes.find((node) => node.staffId === 'n0')!;
    expect(head.directDownlineCount).toBe(depth - 1);
    expect(head.totalDescendantCount).toBe(10_000);
  });
});
