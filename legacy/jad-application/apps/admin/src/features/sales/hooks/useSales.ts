import { useQuery } from '@tanstack/react-query';

import { getSales } from '../services/sales';

export function useSales() {
  return useQuery({ queryKey: ['admin', 'sales'], queryFn: getSales });
}
