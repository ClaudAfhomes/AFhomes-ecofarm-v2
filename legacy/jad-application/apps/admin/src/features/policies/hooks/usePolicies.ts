import { useQuery } from '@tanstack/react-query';
import { getPolicies } from '../services/policies';

export function usePolicies() {
  return useQuery({ queryKey: ['admin', 'policies'], queryFn: getPolicies });
}
