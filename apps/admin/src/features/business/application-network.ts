import type { GenealogyNode } from '@afhomes/contracts';
import type { ReferralChainIds } from './official-forms-fields';

export const EMPTY_APPLICATION_CHAIN: ReferralChainIds = {
  svdStaffId: '',
  ssmStaffId: '',
  smStaffId: '',
  referrerStaffId: '',
};

const roleKeys = {
  vice_director: 'svdStaffId',
  senior_sales_manager: 'ssmStaffId',
  sales_manager: 'smStaffId',
  ost: 'referrerStaffId',
} as const;

export function resolveApplicationNetwork(nodes: readonly GenealogyNode[], memberId: string) {
  const byId = new Map(nodes.map((node) => [node.staffId, node]));
  const chain = { ...EMPTY_APPLICATION_CHAIN };
  const seen = new Set<string>();
  let currentId: string | null = memberId;
  while (currentId) {
    const node = byId.get(currentId);
    if (
      !node ||
      node.status !== 'active' ||
      (node.ostStatus && node.ostStatus !== 'active') ||
      seen.has(currentId) ||
      seen.size >= 8 ||
      !(node.role in roleKeys)
    )
      throw new Error(
        'This member’s Direct Head relationship is unavailable. Refresh the network list or choose another member.',
      );
    const key = roleKeys[node.role as keyof typeof roleKeys];
    if (chain[key]) throw new Error('The network relationship needs review before it can be used.');
    chain[key] = node.staffId;
    seen.add(currentId);
    currentId = node.uplineStaffId;
  }
  const member = byId.get(memberId);
  if (!member) throw new Error('Choose an available referring member.');
  return { member, chain, head: member.uplineStaffId ? byId.get(member.uplineStaffId)! : null };
}
