import { useQuery } from '@tanstack/react-query';
import { getRoles } from '../services/roles';

export function useRoles(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: getRoles,
    enabled: options?.enabled ?? true,
  });
}
