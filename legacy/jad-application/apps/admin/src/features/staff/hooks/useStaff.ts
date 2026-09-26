import { useQuery } from '@tanstack/react-query';
import { getStaff } from '../services/staff';

export function useStaff() {
  return useQuery({ queryKey: ['admin', 'staff'], queryFn: getStaff });
}
