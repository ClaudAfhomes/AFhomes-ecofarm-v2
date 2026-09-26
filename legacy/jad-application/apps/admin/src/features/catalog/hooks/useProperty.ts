import { useQuery } from '@tanstack/react-query';

import type { CatalogProperty } from '@jad/contracts';

import { getProperty } from '../services/catalog';

export function useProperty(id: string) {
  return useQuery({
    queryKey: ['admin', 'property', id],
    queryFn: () => getProperty(id) as Promise<CatalogProperty | undefined>,
  });
}
