import { useQuery } from '@tanstack/react-query';
import { getPayouts } from '../services/payouts';

export function usePayouts() {
  return useQuery({ queryKey: ['admin', 'payouts'], queryFn: getPayouts });
}
