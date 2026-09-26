import { useQuery } from '@tanstack/react-query';
import { getRole } from '../services/roles';

export function useRole(id: string) {
  return useQuery({
    queryKey: ['admin', 'role', id],
    queryFn: () => getRole(id),
  });
}
