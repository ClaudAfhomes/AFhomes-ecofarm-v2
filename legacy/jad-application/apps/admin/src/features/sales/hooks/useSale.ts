import { useQuery } from '@tanstack/react-query';

import { getSale } from '../services/sales';

export function useSale(id: string) {
  return useQuery({
    queryKey: ['admin', 'sale', id],
    queryFn: () => getSale(id),
  });
}
