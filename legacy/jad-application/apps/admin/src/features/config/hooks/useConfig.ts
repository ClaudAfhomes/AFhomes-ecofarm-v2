import { useQuery } from '@tanstack/react-query';
import { getConfig } from '../services/config';

export function useConfig() {
  return useQuery({ queryKey: ['admin', 'config'], queryFn: getConfig });
}
