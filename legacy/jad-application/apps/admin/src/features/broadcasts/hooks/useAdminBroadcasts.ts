import { useQuery } from '@tanstack/react-query';
import { getAdminBroadcasts } from '../services/broadcasts';

export function useAdminBroadcasts() {
  return useQuery({ queryKey: ['admin', 'broadcasts'], queryFn: getAdminBroadcasts });
}
