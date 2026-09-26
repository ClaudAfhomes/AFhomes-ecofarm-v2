import { useQuery } from '@tanstack/react-query';

import { getCategories } from '../services/catalog';
import type { PropertyCategory } from '../services/catalog';

export function useCategories() {
  return useQuery({
    queryKey: ['admin', 'property-categories'],
    queryFn: () => getCategories() as Promise<PropertyCategory[]>,
  });
}
