import { useQuery } from '@tanstack/react-query';

import { getMembers } from '../repositories/memberRepository';

export function useMembers() {
  return useQuery({ queryKey: ['admin', 'members'], queryFn: getMembers });
}
