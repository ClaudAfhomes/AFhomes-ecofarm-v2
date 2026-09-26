import { useQuery } from '@tanstack/react-query';
import { getStaffMember } from '../services/staff';

export function useStaffMember(id: string) {
  return useQuery({
    queryKey: ['admin', 'staff', id],
    queryFn: () => getStaffMember(id),
  });
}
