import { useQuery } from '@tanstack/react-query';
import { getAudit } from '../services/audit';

export function useAudit() {
  return useQuery({ queryKey: ['admin', 'audit'], queryFn: getAudit });
}
