import { useQuery } from '@tanstack/react-query';

import { getMemberById } from '../repositories/memberRepository';

export function useMember(id: string) {
  return useQuery({
    queryKey: ['admin', 'member', id],
    queryFn: () => getMemberById(id),
    enabled: Boolean(id),
  });
}
