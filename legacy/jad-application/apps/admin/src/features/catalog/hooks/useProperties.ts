import { useQuery } from '@tanstack/react-query';

import type { CatalogProperty } from '@jad/contracts';

import { getProperties } from '../services/catalog';

export function useProperties() {
  return useQuery({
    queryKey: ['admin', 'properties'],
    queryFn: () => getProperties() as Promise<CatalogProperty[]>,
  });
}
