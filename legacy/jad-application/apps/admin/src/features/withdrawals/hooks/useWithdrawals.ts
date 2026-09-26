import { useQuery } from '@tanstack/react-query';
import { getWithdrawals } from '../services/withdrawals';

export function useWithdrawals() {
  return useQuery({ queryKey: ['admin', 'withdrawals'], queryFn: getWithdrawals });
}
